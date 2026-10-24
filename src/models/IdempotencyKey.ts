import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin } from '../lib/tenancy';

export type IdempotencyStatus = 'PROCESSING' | 'COMPLETED';

export interface IIdempotencyKey extends Document {
  clinicId: mongoose.Types.ObjectId;
  key: string;
  status: IdempotencyStatus;
  response?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    key: { type: String, required: true },
    status: {
      type: String,
      enum: ['PROCESSING', 'COMPLETED'],
      default: 'PROCESSING',
      required: true,
    },
    response: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

IdempotencyKeySchema.index({ clinicId: 1, key: 1 }, { unique: true });
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

IdempotencyKeySchema.plugin(tenancyPlugin);

export const IdempotencyKey: Model<IIdempotencyKey> =
  mongoose.models.IdempotencyKey ||
  mongoose.model<IIdempotencyKey>('IdempotencyKey', IdempotencyKeySchema);
