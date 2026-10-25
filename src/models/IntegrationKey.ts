import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export interface IIntegrationKey extends Document {
  clinicId: mongoose.Types.ObjectId;
  keyId: string;
  encryptedSecret: string;
  name: string;
  active: boolean;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const IntegrationKeySchema = new Schema<IIntegrationKey>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    keyId: { type: String, required: true, unique: true },
    encryptedSecret: { type: String, required: true },
    name: { type: String, required: true, default: 'Default Integration Key' },
    active: { type: Boolean, default: true, required: true },
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

IntegrationKeySchema.index({ clinicId: 1, active: 1 });

IntegrationKeySchema.plugin(tenancyPlugin);

export const IntegrationKey: Model<IIntegrationKey> =
  mongoose.models.IntegrationKey || mongoose.model<IIntegrationKey>('IntegrationKey', IntegrationKeySchema);
