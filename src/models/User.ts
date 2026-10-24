import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export interface IRecoveryCode {
  hash: string;
  usedAt?: Date;
}

export interface IUser extends Document {
  clinicId: mongoose.Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  totpSecret?: string;
  totpEnabled: boolean;
  lastTotpCode?: string;
  recoveryCodes: IRecoveryCode[];
  role: 'DOCTOR';
  lastPasswordChangeAt?: Date;
  lastLoginAt?: Date;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    totpSecret: { type: String },
    totpEnabled: { type: Boolean, default: false },
    lastTotpCode: { type: String },
    recoveryCodes: [
      {
        hash: { type: String, required: true },
        usedAt: { type: Date },
      },
    ],
    role: { type: String, enum: ['DOCTOR'], default: 'DOCTOR', required: true },
    lastPasswordChangeAt: { type: Date },
    lastLoginAt: { type: Date },
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

UserSchema.index({ clinicId: 1, email: 1 }, { unique: true });

UserSchema.plugin(tenancyPlugin);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
