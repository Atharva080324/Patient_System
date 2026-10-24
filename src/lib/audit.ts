import mongoose from 'mongoose';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { TenantActor, getTenantContext } from './tenancy';
import { clock } from './clock';

export interface AuditRecordParams {
  clinicId?: mongoose.Types.ObjectId | string;
  action: AuditAction;
  entity: string;
  entityId: string;
  actor: TenantActor;
  meta?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Sanitizes metadata so it contains only IDs, status codes, and changed FIELD NAMES (no patient/clinical values).
 */
export function sanitizeAuditMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    // Retain IDs, field lists, counts, or booleans
    if (
      key.endsWith('Id') ||
      key === 'id' ||
      key === 'changedFields' ||
      key === 'fields' ||
      key === 'count' ||
      key === 'success' ||
      key === 'reasonCode'
    ) {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      // If array of strings representing field names
      if (value.every((v) => typeof v === 'string')) {
        sanitized[key] = value;
      }
    } else {
      // Only keep the key presence or type, never raw clinical or PII values
      sanitized[key] = '[FIELD_MODIFIED]';
    }
  }

  return sanitized;
}

export const audit = {
  async record(params: AuditRecordParams): Promise<void> {
    const ctx = getTenantContext();
    const clinicId = params.clinicId
      ? typeof params.clinicId === 'string'
        ? new mongoose.Types.ObjectId(params.clinicId)
        : params.clinicId
      : ctx?.clinicId;

    if (!clinicId) {
      throw new Error('ClinicId is required to record an audit log.');
    }

    const cleanMeta = sanitizeAuditMeta(params.meta);

    // Save new AuditLog record
    const entry = new AuditLog({
      clinicId,
      createdBy: params.actor,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      actor: params.actor,
      meta: cleanMeta,
      ip: params.ip,
      userAgent: params.userAgent,
      at: clock.now(),
    });

    await entry.save();
  },
};
