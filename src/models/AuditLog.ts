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
  KIOSK_REGISTER = 'KIOSK_REGISTER',
  VISIT_STATUS_CHANGE = 'VISIT_STATUS_CHANGE',
  QUEUE_VIEW = 'QUEUE_VIEW',
  CLOSING_REPORT_VIEW = 'CLOSING_REPORT_VIEW',
  HONEYPOT_TRIGGERED = 'HONEYPOT_TRIGGERED',
  CASE_SHEET_VIEW = 'CASE_SHEET_VIEW',
  CASE_SHEET_UPDATE = 'CASE_SHEET_UPDATE',
  PRESCRIPTION_CREATE = 'PRESCRIPTION_CREATE',
  PRESCRIPTION_ISSUE = 'PRESCRIPTION_ISSUE',
  PRESCRIPTION_VOID = 'PRESCRIPTION_VOID',
  PRESCRIPTION_VIEW = 'PRESCRIPTION_VIEW',
  PRESCRIPTION_PRINT = 'PRESCRIPTION_PRINT',
  MEDICINE_CUSTOM_CREATE = 'MEDICINE_CUSTOM_CREATE',
  SET_CREATE = 'SET_CREATE',
  SET_UPDATE = 'SET_UPDATE',
  SET_DELETE = 'SET_DELETE',
  ESTIMATE_CREATE = 'ESTIMATE_CREATE',
  ESTIMATE_ISSUE = 'ESTIMATE_ISSUE',
  ESTIMATE_CANCEL = 'ESTIMATE_CANCEL',
  ESTIMATE_VIEW = 'ESTIMATE_VIEW',
  ESTIMATE_PRINT = 'ESTIMATE_PRINT',
  BILL_CREATE = 'BILL_CREATE',
  BILL_UPDATE = 'BILL_UPDATE',
  BILL_CANCEL = 'BILL_CANCEL',
  BILL_VIEW = 'BILL_VIEW',
  BILL_PRINT = 'BILL_PRINT',
  PAYMENT_CREATE = 'PAYMENT_CREATE',
  PAYMENT_REVERSE = 'PAYMENT_REVERSE',
  RECEIPT_PRINT = 'RECEIPT_PRINT',
  PRICE_OVERRIDE = 'PRICE_OVERRIDE',
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
