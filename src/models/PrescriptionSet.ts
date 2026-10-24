import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export interface IPrescriptionItemSnapshot {
  name: string;
  form: string;
  strength: string;
}

export interface IPrescriptionSetItem {
  medicineSnapshot: IPrescriptionItemSnapshot;
  dose?: string;
  frequency: string;
  duration: string;
  timing?: string;
  instructions?: string;
}

export interface IPrescriptionSet extends Document {
  clinicId: mongoose.Types.ObjectId;
  name: string;
  items: IPrescriptionSetItem[];
  deletedAt?: Date;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const PrescriptionSetSchema = new Schema<IPrescriptionSet>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    name: { type: String, required: true, trim: true },
    items: [
      {
        medicineSnapshot: {
          name: { type: String, required: true },
          form: { type: String, required: true },
          strength: { type: String, required: true },
        },
        dose: { type: String },
        frequency: { type: String, required: true },
        duration: { type: String, required: true },
        timing: { type: String },
        instructions: { type: String },
      },
    ],
    deletedAt: { type: Date },
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

PrescriptionSetSchema.index({ clinicId: 1, name: 1 });

PrescriptionSetSchema.plugin(tenancyPlugin);

export const PrescriptionSet: Model<IPrescriptionSet> =
  mongoose.models.PrescriptionSet ||
  mongoose.model<IPrescriptionSet>('PrescriptionSet', PrescriptionSetSchema);
