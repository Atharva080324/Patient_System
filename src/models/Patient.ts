import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export interface IMedicalHistory {
  conditions: string[];
  allergies: string[];
  currentMedications: string[];
  pregnancy?: boolean;
  habits: string[];
}

export interface IPatient extends Document {
  clinicId: mongoose.Types.ObjectId;
  patientCode: string;
  name: string;
  ageYears?: number;
  dob?: string; // YYYY-MM-DD
  sex: 'Male' | 'Female' | 'Other';
  phone: string;
  address?: string;
  source: 'WALK_IN' | 'WEBSITE' | 'WHATSAPP' | 'MANUAL';
  medicalHistory: IMedicalHistory;
  consentAt: Date;
  consentTextVersion: string;
  notes?: string;
  possibleDuplicateOf?: mongoose.Types.ObjectId;
  deletedAt?: Date;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const PatientSchema = new Schema<IPatient>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    patientCode: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    ageYears: { type: Number, min: 0, max: 120 },
    dob: { type: String },
    sex: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
    phone: { type: String, required: true },
    address: { type: String },
    source: {
      type: String,
      enum: ['WALK_IN', 'WEBSITE', 'WHATSAPP', 'MANUAL'],
      default: 'WALK_IN',
      required: true,
    },
    medicalHistory: {
      conditions: { type: [String], default: [] },
      allergies: { type: [String], default: [] },
      currentMedications: { type: [String], default: [] },
      pregnancy: { type: Boolean },
      habits: { type: [String], default: [] },
    },
    consentAt: { type: Date, required: true },
    consentTextVersion: { type: String, required: true },
    notes: { type: String },
    possibleDuplicateOf: { type: Schema.Types.ObjectId, ref: 'Patient' },
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

// Enforce rule: exactly one of ageYears or dob is required
PatientSchema.pre('validate', function () {
  const hasAge = this.ageYears !== undefined && this.ageYears !== null;
  const hasDob = !!this.dob;

  if (!hasAge && !hasDob) {
    this.invalidate('ageYears', 'Either ageYears or dob must be provided');
  }
  if (hasAge && hasDob) {
    this.invalidate('ageYears', 'Provide either ageYears or dob, but not both');
  }
});

// Indexes per requirements:
// patients {clinicId, patientCode} unique;
// patients {clinicId, phone};
// patients text index on name, phone, patientCode;
PatientSchema.index({ clinicId: 1, patientCode: 1 }, { unique: true });
PatientSchema.index({ clinicId: 1, phone: 1 });
PatientSchema.index(
  { name: 'text', phone: 'text', patientCode: 'text' },
  { name: 'patient_text_search' }
);

PatientSchema.plugin(tenancyPlugin);

export const Patient: Model<IPatient> =
  mongoose.models.Patient || mongoose.model<IPatient>('Patient', PatientSchema);
