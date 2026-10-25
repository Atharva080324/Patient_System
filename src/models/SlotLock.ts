import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin } from '../lib/tenancy';

export interface ISlotLock extends Document {
  clinicId: mongoose.Types.ObjectId;
  clinicDate: string; // YYYY-MM-DD
  version: number;
  updatedAt: Date;
}

const SlotLockSchema = new Schema<ISlotLock>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    clinicDate: { type: String, required: true },
    version: { type: Number, default: 0, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

SlotLockSchema.index({ clinicId: 1, clinicDate: 1 }, { unique: true });

SlotLockSchema.plugin(tenancyPlugin);

export const SlotLock: Model<ISlotLock> =
  mongoose.models.SlotLock || mongoose.model<ISlotLock>('SlotLock', SlotLockSchema);
