import { Types } from 'mongoose';
import { Estimate, IEstimate } from '../models/Estimate';
import { IBill } from '../models/Bill';
import { IPayment } from '../models/Payment';
import { TenantActor } from './tenancy';
import { createBill, CreateBillInput } from './bill-service';

export interface EstimateItemLike {
  treatmentId?: any;
  description: string;
  teeth?: number[];
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface EstimateLike {
  items: EstimateItemLike[];
  discount?: number;
  total: number;
  patientId?: any;
  visitId?: any;
  notes?: string;
}

export interface ConvertedBillPayload {
  items: Array<{
    treatmentId?: any;
    description: string;
    teeth: number[];
    qty: number;
    unitPrice: number;
    amount: number;
  }>;
  discount: number;
  total: number;
}

/**
 * Converts an ISSUED Estimate into Bill items and financial parameters.
 * Guarantees exact carryover of every line, teeth array, quantity, unit price, and discount.
 */
export function convertEstimateItemsToBillItems(estimate: EstimateLike): ConvertedBillPayload {
  const items = (estimate.items || []).map((item) => ({
    treatmentId: item.treatmentId,
    description: item.description,
    teeth: item.teeth ? [...item.teeth] : [],
    qty: item.qty,
    unitPrice: item.unitPrice,
    amount: item.amount,
  }));

  const discount = estimate.discount || 0;
  const total = estimate.total;

  return {
    items,
    discount,
    total,
  };
}

/**
 * End-to-end converter executing atomic conversion of an ISSUED estimate to a Bill.
 */
export async function convertEstimateToBill(
  clinicId: Types.ObjectId | string,
  estimateId: Types.ObjectId | string,
  actor: TenantActor,
  initialPayment?: CreateBillInput['initialPayment']
): Promise<{ bill: IBill; payment?: IPayment }> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const estimateObjectId = new Types.ObjectId(estimateId);

  const estimate = await Estimate.findOne({
    clinicId: clinicObjectId,
    _id: estimateObjectId,
  });

  if (!estimate) {
    throw new Error(`Estimate not found: ${estimateId}`);
  }

  if (estimate.status !== 'ISSUED') {
    const err: any = new Error(
      `Cannot convert estimate with status ${estimate.status}. Only ISSUED estimates can be converted.`
    );
    err.statusCode = 409;
    throw err;
  }

  const converted = convertEstimateItemsToBillItems(estimate);

  return createBill(
    clinicId,
    {
      patientId: estimate.patientId.toString(),
      visitId: estimate.visitId?.toString(),
      estimateId: estimate._id.toString(),
      items: converted.items.map((it) => ({
        treatmentId: it.treatmentId?.toString(),
        description: it.description,
        teeth: it.teeth,
        qty: it.qty,
        unitPrice: it.unitPrice,
        amount: it.amount,
      })),
      discount: converted.discount,
      initialPayment,
    },
    actor
  );
}
