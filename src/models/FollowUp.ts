import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type FollowUpStatus = 'PENDING' | 'DONE' | 'MISSED' | 'CANCELLED';

export interface IFollowUp extends Document {
  clinicId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  visitId: mongoose.Types.ObjectId;
  dueDate: string; // YYYY-MM-DD
  reason: string;
  status: FollowUpStatus;
  contactedAt?: Date;
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
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true, index: true },
    dueDate: { type: String, required: true }, // "YYYY-MM-DD"
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'DONE', 'MISSED', 'CANCELLED'],
      default: 'PENDING',
      required: true,
    },
    contactedAt: { type: Date },
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

// Index:
// followUps {clinicId, dueDate, status};
FollowUpSchema.index({ clinicId: 1, dueDate: 1, status: 1 });

FollowUpSchema.plugin(tenancyPlugin);

export const FollowUp: Model<IFollowUp> =
  mongoose.models.FollowUp || mongoose.model<IFollowUp>('FollowUp', FollowUpSchema);
