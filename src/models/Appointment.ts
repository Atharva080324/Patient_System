import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type AppointmentStatus = 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW';
export type AppointmentSource = 'MANUAL' | 'WEBSITE' | 'WHATSAPP';
export type { AppointmentAction } from '../lib/appointment-state-machine';

export interface IAppointment extends Document {
  clinicId: mongoose.Types.ObjectId;
  patientId?: mongoose.Types.ObjectId;
  contactName: string;
  contactPhone: string;
  start: Date;
  end: Date;
  clinicDate: string; // YYYY-MM-DD in Asia/Kolkata
  status: AppointmentStatus;
  reason: string;
  treatmentCode?: string;
  source: AppointmentSource;
  externalId?: string;
  notes?: string;
  version: number;
  checkedInVisitId?: mongoose.Types.ObjectId;
  cancelReason?: string;
  deletedAt?: Date;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', index: true },
    contactName: { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
    start: { type: Date, required: true, index: true },
    end: { type: Date, required: true },
    clinicDate: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['BOOKED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
      default: 'BOOKED',
      required: true,
      index: true,
    },
    reason: { type: String, required: true, trim: true },
    treatmentCode: { type: String, trim: true },
    source: {
      type: String,
      enum: ['MANUAL', 'WEBSITE', 'WHATSAPP'],
      required: true,
      default: 'MANUAL',
    },
    externalId: { type: String, trim: true },
    notes: { type: String, trim: true },
    version: { type: Number, default: 1, required: true },
    checkedInVisitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
    cancelReason: { type: String, trim: true },
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

AppointmentSchema.index({ clinicId: 1, start: 1, end: 1 });
AppointmentSchema.index({ clinicId: 1, clinicDate: 1, status: 1 });
AppointmentSchema.index(
  { clinicId: 1, source: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } }
);

AppointmentSchema.plugin(tenancyPlugin);

export const Appointment: Model<IAppointment> =
  mongoose.models.Appointment || mongoose.model<IAppointment>('Appointment', AppointmentSchema);
