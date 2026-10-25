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
  searchName: string;
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
  generalNotes?: string;
  possibleDuplicateOf?: mongoose.Types.ObjectId;
  duplicateDismissed?: boolean;
  deletedAt?: Date;
  version: number;
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
    searchName: { type: String, required: true, trim: true, lowercase: true, index: true },
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
    generalNotes: { type: String },
    possibleDuplicateOf: { type: Schema.Types.ObjectId, ref: 'Patient' },
    duplicateDismissed: { type: Boolean, default: false },
    deletedAt: { type: Date },
    version: { type: Number, default: 1 },
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

// Pre-validate hook: sync searchName and enforce ageYears/dob exclusivity
PatientSchema.pre('validate', function () {
  if (this.name) {
    this.searchName = this.name.toLowerCase().trim().replace(/\s+/g, ' ');
  }

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
// patients {clinicId, deletedAt, searchName} for fast prefix search;
PatientSchema.index({ clinicId: 1, patientCode: 1 }, { unique: true });
PatientSchema.index({ clinicId: 1, phone: 1 });
PatientSchema.index({ clinicId: 1, deletedAt: 1, searchName: 1 });
PatientSchema.index(
  { name: 'text', phone: 'text', patientCode: 'text' },
  { name: 'patient_text_search' }
);

PatientSchema.plugin(tenancyPlugin);

export const Patient: Model<IPatient> =
  mongoose.models.Patient || mongoose.model<IPatient>('Patient', PatientSchema);
