import { AsyncLocalStorage } from 'async_hooks';
import mongoose, { Schema } from 'mongoose';

export class TenantContextMissingError extends Error {
  constructor(message = 'Tenant context is missing. Operations must run within an active clinic context.') {
    super(message);
    this.name = 'TenantContextMissingError';
  }
}

export class TenantIsolationViolationError extends Error {
  constructor(message = 'Tenant isolation violation: illegal modification or cross-tenant operation attempted.') {
    super(message);
    this.name = 'TenantIsolationViolationError';
  }
}

export type ActorType = 'USER' | 'KIOSK' | 'INTEGRATION' | 'SYSTEM';

export interface TenantActor {
  type: ActorType;
  id: string;
}

export interface TenantContext {
  clinicId: mongoose.Types.ObjectId;
  actor: TenantActor;
  isSystem?: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function requireTenantContext(): TenantContext {
  const ctx = getTenantContext();
  if (!ctx || !ctx.clinicId) {
    throw new TenantContextMissingError();
  }
  return ctx;
}

export function runWithTenantContext<T>(context: TenantContext, fn: () => Promise<T> | T): Promise<T> {
  return storage.run(context, async () => await fn());
}

export const SYSTEM_ADMIN_CLINIC_ID = new mongoose.Types.ObjectId('000000000000000000000000');

export function systemAdminScope<T>(fn: () => Promise<T> | T): Promise<T> {
  return storage.run(
    {
      clinicId: SYSTEM_ADMIN_CLINIC_ID,
      actor: { type: 'SYSTEM', id: 'system_admin' },
      isSystem: true,
    },
    async () => await fn()
  );
}

/**
 * System scope helper for background jobs and scripts to run under a specific clinic.
 */
export function systemScope<T>(
  clinicId: mongoose.Types.ObjectId | string,
  fn: () => Promise<T> | T,
  actorId = 'system'
): Promise<T> {
  const objectId = typeof clinicId === 'string' ? new mongoose.Types.ObjectId(clinicId) : clinicId;
  return storage.run(
    {
      clinicId: objectId,
      actor: { type: 'SYSTEM', id: actorId },
      isSystem: true,
    },
    async () => await fn()
  );
}

/**
 * Mongoose Plugin to enforce strict multi-tenant isolation on all models.
 */
export function tenancyPlugin(schema: Schema): void {
  // Ensure schema has clinicId, schemaVersion, createdBy
  if (!schema.path('clinicId')) {
    schema.add({
      clinicId: {
        type: Schema.Types.ObjectId,
        ref: 'Clinic',
        required: true,
        index: true,
      },
    });
  }

  if (!schema.path('schemaVersion')) {
    schema.add({
      schemaVersion: {
        type: Number,
        default: 1,
      },
    });
  }

  if (!schema.path('createdBy')) {
    schema.add({
      createdBy: {
        type: {
          type: String,
          enum: ['USER', 'KIOSK', 'INTEGRATION', 'SYSTEM'],
          required: true,
        },
        id: {
          type: String,
          required: true,
        },
      },
    });
  }

  // Pre-validate hook for documents
  schema.pre('validate', function () {
    const ctx = getTenantContext();

    if (this.isNew) {
      if (!ctx && !this.clinicId) {
        throw new TenantContextMissingError();
      }
      if (ctx && !this.clinicId) {
        this.clinicId = ctx.clinicId;
      }
      if (ctx && (!this.createdBy || !(this.createdBy as any).type || !(this.createdBy as any).id)) {
        this.createdBy = {
          type: ctx.actor.type,
          id: ctx.actor.id,
        };
      }
    } else {
      if (this.isModified('clinicId')) {
        throw new TenantIsolationViolationError('clinicId is immutable and cannot be changed on an existing record');
      }
    }
  });

  // Query middleware: find, findOne, findOneAndUpdate, count, update, delete
  const queryOps = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'countDocuments',
    'estimatedDocumentCount',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'replaceOne',
  ] as const;

  for (const op of queryOps) {
    schema.pre(op as any, function (this: any) {
      const ctx = getTenantContext();
      if (!ctx) {
        throw new TenantContextMissingError(
          `Tenant context missing while executing query operation "${op}".`
        );
      }

      // If running under systemAdminScope, bypass clinicId filtering
      if (ctx.isSystem && ctx.clinicId.equals(SYSTEM_ADMIN_CLINIC_ID)) {
        return;
      }

      // Check if update payload tries to modify clinicId
      const update = this.getUpdate?.();
      if (update) {
        if (
          update.clinicId ||
          update.$set?.clinicId ||
          update.$setOnInsert?.clinicId
        ) {
          const targetClinicId = update.clinicId || update.$set?.clinicId;
          if (targetClinicId && !ctx.clinicId.equals(targetClinicId)) {
            throw new TenantIsolationViolationError(
              'Cannot update or change clinicId on a document.'
            );
          }
        }
      }

      // Enforce clinicId filter on query
      this.where({ clinicId: ctx.clinicId });
    });
  }

  // Aggregate middleware: inject leading $match
  schema.pre('aggregate', function (this: any) {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new TenantContextMissingError(
        'Tenant context missing while executing aggregation pipeline.'
      );
    }

    if (ctx.isSystem && ctx.clinicId.equals(SYSTEM_ADMIN_CLINIC_ID)) {
      return;
    }

    const pipeline = this.pipeline();
    pipeline.unshift({
      $match: { clinicId: ctx.clinicId },
    });
  });

  // insertMany middleware
  schema.pre('insertMany', function (docs: any) {
    const ctx = getTenantContext();
    if (!ctx) {
      throw new TenantContextMissingError('Tenant context missing for insertMany.');
    }
    const list = Array.isArray(docs) ? docs : [docs];
    for (const doc of list) {
      if (doc.clinicId && !ctx.clinicId.equals(doc.clinicId)) {
        throw new TenantIsolationViolationError('Cannot insert document with mismatched clinicId.');
      }
      doc.clinicId = ctx.clinicId;
      if (!doc.createdBy) {
        doc.createdBy = ctx.actor;
      }
    }
  });
}
