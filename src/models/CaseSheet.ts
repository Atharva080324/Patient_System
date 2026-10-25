import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';
import { isValidFdiTooth } from '../lib/fdi-tooth';

export interface ITeethEntry {
  tooth: number;
  condition: string;
  notes?: string;
}

export interface ICaseSheet extends Document {
  clinicId: mongoose.Types.ObjectId;
  visitId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  version: number;
  chiefComplaint: string;
  history: string;
  medicalHistoryNotes: string;
  allergies: string[];
  examinationFindings: string;
  diagnosis: string;
  treatmentDoneOrAdvised: string;
  notes: string;
  teethEntries: ITeethEntry[];
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const CaseSheetSchema = new Schema<ICaseSheet>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    version: { type: Number, default: 1, required: true },
    chiefComplaint: { type: String, default: '', maxlength: 2000 },
    history: { type: String, default: '', maxlength: 5000 },
    medicalHistoryNotes: { type: String, default: '', maxlength: 5000 },
    allergies: { type: [String], default: [] },
    examinationFindings: { type: String, default: '', maxlength: 5000 },
    diagnosis: { type: String, default: '', maxlength: 2000 },
    treatmentDoneOrAdvised: { type: String, default: '', maxlength: 5000 },
    notes: { type: String, default: '', maxlength: 5000 },
    teethEntries: [
      {
        tooth: {
          type: Number,
          required: true,
          validate: {
            validator: (v: number) => isValidFdiTooth(v),
            message: (props: { value: number }) => `${props.value} is not a valid FDI tooth number`,
          },
        },
        condition: { type: String, required: true, maxlength: 200 },
        notes: { type: String, default: '', maxlength: 500 },
      },
    ],
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

// Indexes: exactly one case sheet per visit within a clinic
CaseSheetSchema.index({ clinicId: 1, visitId: 1 }, { unique: true });
CaseSheetSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });

CaseSheetSchema.plugin(tenancyPlugin);

export const CaseSheet: Model<ICaseSheet> =
  mongoose.models.CaseSheet || mongoose.model<ICaseSheet>('CaseSheet', CaseSheetSchema);
