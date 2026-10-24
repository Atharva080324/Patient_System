import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';
import { appendOnlyPlugin } from '../lib/append-only';

export enum AuditAction {
  AUTH_LOGIN = 'AUTH_LOGIN',
  AUTH_FAIL = 'AUTH_FAIL',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_2FA_ENABLED = 'AUTH_2FA_ENABLED',
  AUTH_2FA_DISABLED = 'AUTH_2FA_DISABLED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  KIOSK_UNLOCK = 'KIOSK_UNLOCK',
  KIOSK_FAIL = 'KIOSK_FAIL',
  PIN_ROTATED = 'PIN_ROTATED',
  RECORD_VIEW = 'RECORD_VIEW',
  RECORD_CREATE = 'RECORD_CREATE',
  RECORD_UPDATE = 'RECORD_UPDATE',
  RECORD_PRINT = 'RECORD_PRINT',
  RECORD_EXPORT = 'RECORD_EXPORT',
  RECORD_DELETE = 'RECORD_DELETE',
  SETTINGS_UPDATE = 'SETTINGS_UPDATE',
}

export interface IAuditLog extends Document {
  clinicId: mongoose.Types.ObjectId;
  schemaVersion: number;
  createdBy: TenantActor;
  action: AuditAction;
  entity: string;
  entityId: string;
  actor: TenantActor;
  meta?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    schemaVersion: { type: Number, default: 1 },
    createdBy: {
      type: {
        type: String,
        enum: ['USER', 'KIOSK', 'INTEGRATION', 'SYSTEM'],
        required: true,
      },
      id: { type: String, required: true },
    },
    action: { type: String, enum: Object.values(AuditAction), required: true },
    entity: { type: String, required: true },
    entityId: { type: String, required: true },
    actor: {
      type: {
        type: String,
        enum: ['USER', 'KIOSK', 'INTEGRATION', 'SYSTEM'],
        required: true,
      },
      id: { type: String, required: true },
    },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
    at: { type: Date, required: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Indexes per requirements:
// auditLogs {clinicId, at} and {clinicId, entity, entityId, at}
AuditLogSchema.index({ clinicId: 1, at: -1 });
AuditLogSchema.index({ clinicId: 1, entity: 1, entityId: 1, at: -1 });

// Apply Tenancy and Append-only plugins
AuditLogSchema.plugin(tenancyPlugin);
AuditLogSchema.plugin(appendOnlyPlugin);

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
