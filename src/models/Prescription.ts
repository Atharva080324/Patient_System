import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';
import { IPrescriptionSetItem } from './PrescriptionSet';

export interface IPrescription extends Document {
  clinicId: mongoose.Types.ObjectId;
  rxNumber: string; // RX/2026-27/0001
  visitId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  date: Date;
  items: IPrescriptionSetItem[];
  advice?: string;
  followUpDate?: string; // YYYY-MM-DD
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const PrescriptionSchema = new Schema<IPrescription>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    rxNumber: { type: String, required: true },
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    date: { type: Date, required: true },
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
    advice: { type: String },
    followUpDate: { type: String },
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
// prescriptions {clinicId, rxNumber} unique;
PrescriptionSchema.index({ clinicId: 1, rxNumber: 1 }, { unique: true });

PrescriptionSchema.plugin(tenancyPlugin);

export const Prescription: Model<IPrescription> =
  mongoose.models.Prescription ||
  mongoose.model<IPrescription>('Prescription', PrescriptionSchema);
