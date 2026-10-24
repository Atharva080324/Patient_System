import mongoose, { Schema, Document, Model } from 'mongoose';
import { TenantActor } from '../lib/tenancy';

export interface IClinic extends Document {
  name: string;
  address: string;
  phone: string;
  email: string;
  registrationNo: string;
  logoUrl?: string;
  workingHours?: string;
  timezone: string;
  paperSize: 'A5' | 'A4';
  kioskPinHash: string;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const ClinicSchema = new Schema<IClinic>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    registrationNo: { type: String, required: true },
    logoUrl: { type: String },
    workingHours: { type: String, default: '09:00 - 20:00' },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    paperSize: { type: String, enum: ['A5', 'A4'], default: 'A5' },
    kioskPinHash: { type: String, required: true },
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

export const Clinic: Model<IClinic> =
  mongoose.models.Clinic || mongoose.model<IClinic>('Clinic', ClinicSchema);
