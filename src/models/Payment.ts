import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';
import { appendOnlyPlugin } from '../lib/append-only';

export type PaymentMethod = 'CASH' | 'UPI';

export interface IPayment extends Document {
  clinicId: mongoose.Types.ObjectId;
  billId: mongoose.Types.ObjectId;
  receiptNo: string; // REC/2026-27/0001
  amount: number; // paise (can be negative for REVERSAL)
  method: PaymentMethod;
  upiRef?: string;
  isReversal: boolean;
  reversalOf?: mongoose.Types.ObjectId;
  receivedAt: Date;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true, index: true },
    receiptNo: { type: String, required: true },
    amount: { type: Number, required: true }, // integer paise
    method: { type: String, enum: ['CASH', 'UPI'], required: true },
    upiRef: { type: String },
    isReversal: { type: Boolean, default: false, required: true },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'Payment' },
    receivedAt: { type: Date, required: true },
    schemaVersion: { type: Number, default: 1 },
    createdBy: {
      type: {
        type: String,
        enum: ['USER', 'KIOSK', 'INTEGRATION', 'SYSTEM'],
        required: true,
      },
      id: { type: String, required: true },
    },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Indexes:
// payments {clinicId, receiptNo} unique;
// payments {clinicId, billId};
PaymentSchema.index({ clinicId: 1, receiptNo: 1 }, { unique: true });
PaymentSchema.index({ clinicId: 1, billId: 1 });

PaymentSchema.plugin(tenancyPlugin);
PaymentSchema.plugin(appendOnlyPlugin);

export const Payment: Model<IPayment> =
  mongoose.models.Payment || mongoose.model<IPayment>('Payment', PaymentSchema);
