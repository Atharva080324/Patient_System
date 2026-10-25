import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type PrescriptionStatus = 'DRAFT' | 'ISSUED' | 'VOID';

export interface IPrescriptionItem {
  medicineId?: mongoose.Types.ObjectId;
  name: string;
  form: string;
  strength: string;
  dose?: string;
  frequency: string;
  duration: string;
  instruction?: string;
  note?: string;
}

export interface IPrescriptionClinicSnapshot {
  name: string;
  address: string;
  phone: string;
  email: string;
  registrationNo: string;
  logoUrl?: string;
  workingHours?: string;
}

export interface IPrescriptionDoctorSnapshot {
  name: string;
  qualification: string;
  registrationNumber: string;
}

export interface IPrescriptionPatientSnapshot {
  name: string;
  patientCode: string;
  ageYears?: number;
  sex: string;
  phone: string;
  address?: string;
}

export interface IPrescriptionSnapshot {
  clinic: IPrescriptionClinicSnapshot;
  doctor: IPrescriptionDoctorSnapshot;
  patient: IPrescriptionPatientSnapshot;
  rxNumber: string;
  date: string;
  items: IPrescriptionItem[];
  advice?: string;
  followUpDate?: string;
  language: 'en' | 'hi' | 'mr';
  issuedAt: Date;
}

export interface IPrescription extends Document {
  clinicId: mongoose.Types.ObjectId;
  visitId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  status: PrescriptionStatus;
  rxNumber?: string; // RX/2026-27/0001 (allocated upon ISSUED)
  date: Date;
  items: IPrescriptionItem[];
  advice?: string;
  followUpDate?: string; // YYYY-MM-DD
  language: 'en' | 'hi' | 'mr';
  replacesPrescriptionId?: mongoose.Types.ObjectId;
  voidReason?: string;
  voidedAt?: Date;
  voidedBy?: TenantActor;
  snapshot?: IPrescriptionSnapshot;
  printCount: number;
  lastPrintedAt?: Date;
  version: number;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const PrescriptionSchema = new Schema<IPrescription>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    status: {
      type: String,
      enum: ['DRAFT', 'ISSUED', 'VOID'],
      default: 'DRAFT',
      required: true,
      index: true,
    },
    rxNumber: { type: String, trim: true },
    date: { type: Date, required: true },
    items: [
      {
        medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine' },
        medicineSnapshot: {
          name: { type: String },
          form: { type: String },
          strength: { type: String },
        },
        name: { type: String, trim: true },
        form: { type: String, trim: true },
        strength: { type: String, trim: true },
        dose: { type: String, default: '', trim: true },
        frequency: { type: String, required: true, trim: true },
        duration: { type: String, required: true, trim: true },
        instruction: { type: String, default: '', trim: true },
        note: { type: String, default: '', trim: true },
      },
    ],
    advice: { type: String, default: '', maxlength: 2000 },
    followUpDate: { type: String, trim: true },
    language: { type: String, enum: ['en', 'hi', 'mr'], default: 'en' },
    replacesPrescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription' },
    voidReason: { type: String, trim: true },
    voidedAt: { type: Date },
    voidedBy: {
      type: {
        type: String,
        enum: ['USER', 'KIOSK', 'INTEGRATION', 'SYSTEM'],
      },
      id: { type: String },
    },
    snapshot: {
      clinic: {
        name: { type: String },
        address: { type: String },
        phone: { type: String },
        email: { type: String },
        registrationNo: { type: String },
        logoUrl: { type: String },
        workingHours: { type: String },
      },
      doctor: {
        name: { type: String },
        qualification: { type: String },
        registrationNumber: { type: String },
      },
      patient: {
        name: { type: String },
        patientCode: { type: String },
        ageYears: { type: Number },
        sex: { type: String },
        phone: { type: String },
        address: { type: String },
      },
      rxNumber: { type: String },
      date: { type: String },
      items: [
        {
          name: { type: String },
          form: { type: String },
          strength: { type: String },
          dose: { type: String },
          frequency: { type: String },
          duration: { type: String },
          instruction: { type: String },
          note: { type: String },
        },
      ],
      advice: { type: String },
      followUpDate: { type: String },
      language: { type: String },
      issuedAt: { type: Date },
    },
    printCount: { type: Number, default: 0 },
    lastPrintedAt: { type: Date },
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

PrescriptionSchema.pre('validate', function () {
  if (this.items && Array.isArray(this.items)) {
    for (const item of this.items as any) {
      if (item && item.medicineSnapshot) {
        if (!item.name && item.medicineSnapshot.name) item.name = item.medicineSnapshot.name;
        if (!item.form && item.medicineSnapshot.form) item.form = item.medicineSnapshot.form;
        if (!item.strength && item.medicineSnapshot.strength) item.strength = item.medicineSnapshot.strength;
      }
    }
  }
});

// Unique gapless rxNumber per clinic when present
PrescriptionSchema.index(
  { clinicId: 1, rxNumber: 1 },
  { unique: true, partialFilterExpression: { rxNumber: { $type: 'string' } } }
);

PrescriptionSchema.index({ clinicId: 1, visitId: 1, createdAt: -1 });
PrescriptionSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });

PrescriptionSchema.plugin(tenancyPlugin);

export const Prescription: Model<IPrescription> =
  mongoose.models.Prescription ||
  mongoose.model<IPrescription>('Prescription', PrescriptionSchema);
