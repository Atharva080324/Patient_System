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
