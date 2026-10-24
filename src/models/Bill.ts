import mongoose, { Schema, Document, Model } from 'mongoose';
import { tenancyPlugin, TenantActor } from '../lib/tenancy';
import { BillStatus, recomputeBill } from '../lib/billing';

export interface IBillItem {
  treatmentId?: mongoose.Types.ObjectId;
  description: string;
  teeth?: number[];
  qty: number;
  unitPrice: number; // paise
  amount: number; // paise
}

export interface IBill extends Document {
  clinicId: mongoose.Types.ObjectId;
  billNo: string; // BILL/2026-27/0001
  patientId: mongoose.Types.ObjectId;
  visitId?: mongoose.Types.ObjectId;
  items: IBillItem[];
  discount: number; // paise
  total: number; // paise
  paid: number; // paise
  balance: number; // paise
  status: BillStatus;
  cancelReason?: string;
  schemaVersion: number;
  createdBy: TenantActor;
  createdAt: Date;
  updatedAt: Date;
}

const BillSchema = new Schema<IBill>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    billNo: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
    items: [
      {
        treatmentId: { type: Schema.Types.ObjectId, ref: 'Treatment' },
        description: { type: String, required: true },
        teeth: { type: [Number], default: [] },
        qty: { type: Number, required: true, default: 1 },
        unitPrice: { type: Number, required: true }, // integer paise
        amount: { type: Number, required: true }, // integer paise
      },
    ],
    discount: { type: Number, required: true, default: 0 }, // integer paise
    total: { type: Number, required: true }, // integer paise
    paid: { type: Number, required: true, default: 0 }, // integer paise
    balance: { type: Number, required: true }, // integer paise
    status: {
      type: String,
      enum: ['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'],
      default: 'UNPAID',
      required: true,
    },
    cancelReason: { type: String },
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
// bills {clinicId, billNo} unique;
// bills {clinicId, patientId};
BillSchema.index({ clinicId: 1, billNo: 1 }, { unique: true });
BillSchema.index({ clinicId: 1, patientId: 1 });

BillSchema.plugin(tenancyPlugin);

// Model-level invariant guard: paid and balance can only be set or modified via recomputeBill
BillSchema.pre('validate', function () {
  const isAllowed = Boolean((this as any).$locals?.allowBillFinancialUpdate);

  if (this.isNew) {
    if (!isAllowed) {
      const computed = recomputeBill(this.total as any, [], this.status === 'CANCELLED');
      if (this.paid !== computed.paid || this.balance !== computed.balance) {
        throw new Error(
          'Invariant violation: bill.paid and bill.balance can only be set via recomputeBill'
        );
      }
    }
  } else {
    if (this.isModified('paid') || this.isModified('balance')) {
      if (!isAllowed) {
        throw new Error(
          'Invariant violation: direct modification of bill.paid or bill.balance is strictly prohibited; must use recomputeBill'
        );
      }
    }
  }
});

const billUpdateOps = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
] as const;

for (const op of billUpdateOps) {
  BillSchema.pre(op as any, function (this: any) {
    const update = this.getUpdate?.();
    const options = this.getOptions?.() || {};

    if (update) {
      const hasPaid =
        update.paid !== undefined ||
        update.$set?.paid !== undefined ||
        update.$inc?.paid !== undefined;
      const hasBalance =
        update.balance !== undefined ||
        update.$set?.balance !== undefined ||
        update.$inc?.balance !== undefined;

      if (hasPaid || hasBalance) {
        if (!options.allowBillFinancialUpdate) {
          throw new Error(
            'Invariant violation: direct query update of bill.paid or bill.balance is prohibited; must use recomputeBill'
          );
        }
      }
    }
  });
}

export const Bill: Model<IBill> =
  mongoose.models.Bill || mongoose.model<IBill>('Bill', BillSchema);
