import mongoose, { Schema, Model } from 'mongoose';

export interface ICounter {
  _id: string; // `${clinicId}:${key}`
  clinicId: mongoose.Types.ObjectId;
  key: string;
  seq: number;
  updatedAt: Date;
}

const CounterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
  }
);

CounterSchema.index({ clinicId: 1, key: 1 }, { unique: true });

export const Counter: Model<ICounter> =
  mongoose.models.Counter || mongoose.model<ICounter>('Counter', CounterSchema);
