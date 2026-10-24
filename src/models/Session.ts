import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export interface ISession extends Document {
  clinicId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date; // Absolute timeout (e.g. 12 hours)
  lastActivityAt: Date; // Idle timeout tracking (e.g. 4 hours)
  recentPasswordConfirmAt?: Date; // 5-minute freshness for sensitive actions
  revokedAt?: Date;
  ip?: string;
  userAgent?: string;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    lastActivityAt: { type: Date, required: true },
    recentPasswordConfirmAt: { type: Date },
    revokedAt: { type: Date },
    ip: { type: String },
    userAgent: { type: String },
    schemaVersion: { type: Number, default: 1 },
    createdBy: {
      type: {
        type: String,
        enum: ['USER', 'KIOSK', 'INTEGRATION', 'SYSTEM'],
        required: true,
      },
      id: { type: String, required: true },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
SessionSchema.index({ tokenHash: 1 }, { unique: true });
SessionSchema.index({ userId: 1, revokedAt: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

SessionSchema.plugin(tenancyPlugin);

export const Session: Model<ISession> =
  mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema);
