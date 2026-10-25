import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type VisitStatus =
  | 'WAITING'
  | 'IN_CONSULTATION'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'NO_SHOW'
  | 'CANCELLED';
export type VisitType = 'WALK_IN' | 'APPOINTMENT';

export interface IToothFinding {
  tooth: number;
  finding: string;
}

export interface ITreatmentPlanItem {
  tooth?: number;
  treatmentId: mongoose.Types.ObjectId;
  status: string;
}

export interface IVisitCaseSheet {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  extraOral: string;
  intraOral: string;
  findings: IToothFinding[];
  investigations: string[];
  diagnosis: string;
  treatmentPlan: ITreatmentPlanItem[];
  procedureNotes: string;
  advice: string;
}

export interface IVisit extends Document {
  clinicId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  appointmentId?: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  token: number;
  type: VisitType;
  status: VisitStatus;
  checkInAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  skippedAt?: Date;
  noShowAt?: Date;
  cancelledAt?: Date;
  reasonForVisit: string;
  caseSheet: IVisitCaseSheet;
  prescriptionId?: mongoose.Types.ObjectId;
  billId?: mongoose.Types.ObjectId;
  estimateId?: mongoose.Types.ObjectId;
  version: number;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const VisitSchema = new Schema<IVisit>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    token: { type: Number, required: true },
    type: { type: String, enum: ['WALK_IN', 'APPOINTMENT'], required: true },
    status: {
      type: String,
      enum: ['WAITING', 'IN_CONSULTATION', 'COMPLETED', 'SKIPPED', 'NO_SHOW', 'CANCELLED'],
      default: 'WAITING',
      required: true,
    },
    checkInAt: { type: Date, required: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    skippedAt: { type: Date },
    noShowAt: { type: Date },
    cancelledAt: { type: Date },
    reasonForVisit: { type: String, required: true },
    caseSheet: {
      chiefComplaint: { type: String, default: '' },
      historyOfPresentIllness: { type: String, default: '' },
      extraOral: { type: String, default: '' },
      intraOral: { type: String, default: '' },
      findings: [
        {
          tooth: { type: Number, required: true },
          finding: { type: String, required: true },
        },
      ],
      investigations: { type: [String], default: [] },
      diagnosis: { type: String, default: '' },
      treatmentPlan: [
        {
          tooth: { type: Number },
          treatmentId: { type: Schema.Types.ObjectId, ref: 'Treatment', required: true },
          status: { type: String, default: 'PLANNED' },
        },
      ],
      procedureNotes: { type: String, default: '' },
      advice: { type: String, default: '' },
    },
    prescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription' },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill' },
    estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
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

// Indexes:
// visits {clinicId, date, token} unique;
// visits {clinicId, patientId, date};
VisitSchema.index({ clinicId: 1, date: 1, token: 1 }, { unique: true });
VisitSchema.index({ clinicId: 1, patientId: 1, date: 1 });
// Single active consultation per clinic invariant:
VisitSchema.index(
  { clinicId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'IN_CONSULTATION' } }
);

VisitSchema.plugin(tenancyPlugin);

export const Visit: Model<IVisit> =
  mongoose.models.Visit || mongoose.model<IVisit>('Visit', VisitSchema);
