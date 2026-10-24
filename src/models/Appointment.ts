import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type AppointmentStatus =
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface IAppointmentContact {
  name: string;
  phone: string;
}

export interface IAppointment extends Document {
  clinicId: mongoose.Types.ObjectId;
  patientId?: mongoose.Types.ObjectId;
  contact: IAppointmentContact;
  start: Date;
  end: Date;
  status: AppointmentStatus;
  reason: string;
  source: string;
  externalId?: string;
  deletedAt?: Date;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
    contact: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
    },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    status: {
      type: String,
      enum: ['REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
      default: 'REQUESTED',
      required: true,
    },
    reason: { type: String, required: true },
    source: { type: String, required: true, default: 'MANUAL' },
    externalId: { type: String },
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

// Indexes:
// appointments {clinicId, start};
// appointments {clinicId, source, externalId} unique sparse;
AppointmentSchema.index({ clinicId: 1, start: 1 });
AppointmentSchema.index(
  { clinicId: 1, source: 1, externalId: 1 },
  { unique: true, sparse: true }
);

AppointmentSchema.plugin(tenancyPlugin);

export const Appointment: Model<IAppointment> =
  mongoose.models.Appointment || mongoose.model<IAppointment>('Appointment', AppointmentSchema);
