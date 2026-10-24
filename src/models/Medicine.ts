import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';

export type MedicineForm =
  | 'tablet'
  | 'capsule'
  | 'gel'
  | 'ointment'
  | 'mouthwash'
  | 'injection'
  | 'drops'
  | 'other';

export type MedicineSource = 'NLEM2022' | 'FORMULARY' | 'CUSTOM' | 'SAMPLE';

export interface IMedicine extends Document {
  clinicId: mongoose.Types.ObjectId;
  genericName: string;
  brandName?: string;
  form: MedicineForm;
  strength: string;
  route: string;
  category: string;
  source: MedicineSource;
  verified: boolean;
  active: boolean;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const MedicineSchema = new Schema<IMedicine>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    genericName: { type: String, required: true, trim: true },
    brandName: { type: String, trim: true },
    form: {
      type: String,
      enum: ['tablet', 'capsule', 'gel', 'ointment', 'mouthwash', 'injection', 'drops', 'other'],
      required: true,
    },
    strength: { type: String, required: true },
    route: { type: String, default: 'Oral' },
    category: { type: String, required: true },
    source: {
      type: String,
      enum: ['NLEM2022', 'FORMULARY', 'CUSTOM', 'SAMPLE'],
      required: true,
    },
    verified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
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
// medicines text index on genericName and brandName, plus {clinicId, active};
MedicineSchema.index(
  { genericName: 'text', brandName: 'text' },
  { name: 'medicine_text_search' }
);
MedicineSchema.index({ clinicId: 1, active: 1 });

MedicineSchema.plugin(tenancyPlugin);

export const Medicine: Model<IMedicine> =
  mongoose.models.Medicine || mongoose.model<IMedicine>('Medicine', MedicineSchema);
