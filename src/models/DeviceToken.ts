import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export interface IDeviceToken extends Document {
  clinicId: mongoose.Types.ObjectId;
  tokenHash: string; // SHA-256 of 256-bit token
  name: string;
  role: 'KIOSK';
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt?: Date;
  userAgent?: string;
  ipPrefix?: string;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceTokenSchema = new Schema<IDeviceToken>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    tokenHash: { type: String, required: true },
    name: { type: String, default: 'Registration Kiosk' },
    role: { type: String, enum: ['KIOSK'], default: 'KIOSK', required: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
    revokedAt: { type: Date },
    userAgent: { type: String },
    ipPrefix: { type: String },
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

// Indexes:
// deviceTokens {tokenHash} unique with a TTL on expiresAt;
DeviceTokenSchema.index({ tokenHash: 1 }, { unique: true });
DeviceTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

DeviceTokenSchema.plugin(tenancyPlugin);

export const DeviceToken: Model<IDeviceToken> =
  mongoose.models.DeviceToken ||
  mongoose.model<IDeviceToken>('DeviceToken', DeviceTokenSchema);
