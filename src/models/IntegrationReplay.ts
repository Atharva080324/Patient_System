import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IIntegrationReplay extends Document {
  sigHash: string;
  createdAt: Date;
}

const IntegrationReplaySchema = new Schema<IIntegrationReplay>(
  {
    sigHash: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

IntegrationReplaySchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 }); // 10 minutes TTL

export const IntegrationReplay: Model<IIntegrationReplay> =
  mongoose.models.IntegrationReplay ||
  mongoose.model<IIntegrationReplay>('IntegrationReplay', IntegrationReplaySchema);
