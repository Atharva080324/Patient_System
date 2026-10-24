import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type TreatmentUnit = 'per tooth' | 'per quadrant' | 'per case' | 'per visit';

export interface ITreatment extends Document {
  clinicId: mongoose.Types.ObjectId;
  code: string;
  name: string;
  category: string;
  idaMin: number; // in Rupees (as published by IDA)
  idaMax: number | null; // in Rupees, null for open-ended
  unit: TreatmentUnit;
  clinicPrice?: number; // Integer Paise set by doctor
  active: boolean;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const TreatmentSchema = new Schema<ITreatment>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    idaMin: { type: Number, required: true },
    idaMax: { type: Number, default: null },
    unit: {
      type: String,
      enum: ['per tooth', 'per quadrant', 'per case', 'per visit'],
      required: true,
    },
    clinicPrice: { type: Number }, // integer paise
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

TreatmentSchema.index({ clinicId: 1, code: 1 }, { unique: true });
TreatmentSchema.index({ clinicId: 1, category: 1 });

TreatmentSchema.plugin(tenancyPlugin);

export const Treatment: Model<ITreatment> =
  mongoose.models.Treatment || mongoose.model<ITreatment>('Treatment', TreatmentSchema);
