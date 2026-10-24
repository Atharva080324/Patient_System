import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export interface IDoctorMedicine extends Document {
  clinicId: mongoose.Types.ObjectId;
  medicineId: mongoose.Types.ObjectId;
  useCount: number;
  lastUsedAt: Date;
  defaultFrequency?: string;
  defaultDuration?: string;
  defaultTiming?: string;
  defaultInstructions?: string;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const DoctorMedicineSchema = new Schema<IDoctorMedicine>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    useCount: { type: Number, default: 0, required: true },
    lastUsedAt: { type: Date, required: true },
    defaultFrequency: { type: String },
    defaultDuration: { type: String },
    defaultTiming: { type: String },
    defaultInstructions: { type: String },
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

DoctorMedicineSchema.index({ clinicId: 1, medicineId: 1 }, { unique: true });
DoctorMedicineSchema.index({ clinicId: 1, useCount: -1 });

DoctorMedicineSchema.plugin(tenancyPlugin);

export const DoctorMedicine: Model<IDoctorMedicine> =
  mongoose.models.DoctorMedicine ||
  mongoose.model<IDoctorMedicine>('DoctorMedicine', DoctorMedicineSchema);
