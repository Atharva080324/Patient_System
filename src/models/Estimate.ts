import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';
import { EstimateStatus } from '../lib/estimate-state-machine';

export type { EstimateStatus };

export interface IEstimateItem {
  treatmentId?: mongoose.Types.ObjectId;
  description: string;
  teeth: number[];
  qty: number;
  listPrice?: number; // paise
  unitPrice: number; // paise
  amount: number; // paise
}

export interface IEstimate extends Document {
  clinicId: mongoose.Types.ObjectId;
  estimateNo?: string; // EST/2026-27/0001 (assigned on ISSUE)
  patientId: mongoose.Types.ObjectId;
  visitId?: mongoose.Types.ObjectId;
  items: IEstimateItem[];
  subtotal: number; // paise
  discount: number; // paise
  total: number; // paise
  validUntil?: string; // YYYY-MM-DD
  notes?: string;
  status: EstimateStatus;
  convertedToBillId?: mongoose.Types.ObjectId;
  replacesEstimateId?: mongoose.Types.ObjectId;
  cancelReason?: string;
  issuedAt?: Date;
  snapshot?: Record<string, unknown>;
  printCount: number;
  version: number;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const EstimateSchema = new Schema<IEstimate>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    estimateNo: { type: String, sparse: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit', index: true },
    items: [
      {
        treatmentId: { type: Schema.Types.ObjectId, ref: 'Treatment' },
        description: { type: String, required: true },
        teeth: { type: [Number], default: [] },
        qty: { type: Number, required: true, default: 1 },
        listPrice: { type: Number },
        unitPrice: { type: Number, required: true }, // integer paise
        amount: { type: Number, required: true }, // integer paise
      },
    ],
    subtotal: { type: Number, required: true }, // integer paise
    discount: { type: Number, required: true, default: 0 }, // integer paise
    total: { type: Number, required: true }, // integer paise
    validUntil: { type: String }, // YYYY-MM-DD
    notes: { type: String },
    status: {
      type: String,
      enum: ['DRAFT', 'ISSUED', 'CONVERTED', 'CANCELLED'],
      default: 'DRAFT',
      required: true,
      index: true,
    },
    convertedToBillId: { type: Schema.Types.ObjectId, ref: 'Bill' },
    replacesEstimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
    cancelReason: { type: String },
    issuedAt: { type: Date },
    snapshot: { type: Schema.Types.Mixed },
    printCount: { type: Number, default: 0, required: true },
    version: { type: Number, default: 1, required: true },
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

// Unique index for issued estimate numbers per clinic
EstimateSchema.index({ clinicId: 1, estimateNo: 1 }, { unique: true, sparse: true });
EstimateSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });

EstimateSchema.plugin(tenancyPlugin);

export const Estimate: Model<IEstimate> =
  mongoose.models.Estimate || mongoose.model<IEstimate>('Estimate', EstimateSchema);
