import mongoose, { Schema, Model } from 'mongoose';

export interface IRateLimit {
  _id: string; // `${key}:${windowStartMs}`
  key: string;
  windowStart: Date;
  count: number;
  expireAt: Date;
}

const RateLimitSchema = new Schema<IRateLimit>(
  {
    _id: { type: String, required: true },
    key: { type: String, required: true, index: true },
    windowStart: { type: Date, required: true },
    count: { type: Number, required: true, default: 1 },
    expireAt: { type: Date, required: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// TTL index to automatically purge expired rate limit windows
RateLimitSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit: Model<IRateLimit> =
  mongoose.models.RateLimit || mongoose.model<IRateLimit>('RateLimit', RateLimitSchema);
