import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type EstimateStatus = 'DRAFT' | 'GIVEN' | 'ACCEPTED' | 'DECLINED';

export interface IEstimateItem {
  treatmentId: mongoose.Types.ObjectId;
  teeth: number[];
  qty: number;
  unitPrice: number; // paise
  amount: number; // paise
}

export interface IEstimate extends Document {
  clinicId: mongoose.Types.ObjectId;
  estimateNo: string; // EST/2026-27/0001
  patientId: mongoose.Types.ObjectId;
  visitId?: mongoose.Types.ObjectId;
  items: IEstimateItem[];
  total: number; // paise
  notes?: string;
  status: EstimateStatus;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const EstimateSchema = new Schema<IEstimate>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    estimateNo: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
    items: [
      {
        treatmentId: { type: Schema.Types.ObjectId, ref: 'Treatment', required: true },
        teeth: { type: [Number], default: [] },
        qty: { type: Number, required: true, default: 1 },
        unitPrice: { type: Number, required: true }, // integer paise
        amount: { type: Number, required: true }, // integer paise
      },
    ],
    total: { type: Number, required: true }, // integer paise
    notes: { type: String },
    status: {
      type: String,
      enum: ['DRAFT', 'GIVEN', 'ACCEPTED', 'DECLINED'],
      default: 'DRAFT',
      required: true,
    },
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
// estimates {clinicId, estimateNo} unique;
EstimateSchema.index({ clinicId: 1, estimateNo: 1 }, { unique: true });

EstimateSchema.plugin(tenancyPlugin);

export const Estimate: Model<IEstimate> =
  mongoose.models.Estimate || mongoose.model<IEstimate>('Estimate', EstimateSchema);
