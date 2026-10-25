import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type FollowUpStatus = 'PENDING' | 'DONE' | 'CANCELLED';

export interface IFollowUp extends Document {
  clinicId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  sourceVisitId?: mongoose.Types.ObjectId;
  dueDate: string; // YYYY-MM-DD
  reason: string;
  status: FollowUpStatus;
  doneAt?: Date;
  note?: string;
  deletedAt?: Date;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const FollowUpSchema = new Schema<IFollowUp>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    sourceVisitId: { type: Schema.Types.ObjectId, ref: 'Visit', index: true },
    dueDate: { type: String, required: true, index: true }, // "YYYY-MM-DD"
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['PENDING', 'DONE', 'CANCELLED'],
      default: 'PENDING',
      required: true,
      index: true,
    },
    doneAt: { type: Date },
    note: { type: String, trim: true },
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

FollowUpSchema.index({ clinicId: 1, dueDate: 1, status: 1 });
FollowUpSchema.index({ clinicId: 1, patientId: 1, status: 1 });

FollowUpSchema.plugin(tenancyPlugin);

export const FollowUp: Model<IFollowUp> =
  mongoose.models.FollowUp || mongoose.model<IFollowUp>('FollowUp', FollowUpSchema);
