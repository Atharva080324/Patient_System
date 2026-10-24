import { Paise, asPaise, addPaise, subtractPaise } from './money';

export type BillStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';

export interface PaymentRecord {
  amount: Paise;
  method?: string;
  isReversal?: boolean;
}

/**
 * Pure function to calculate paid, balance, and bill status.
 * Invariant: paid + balance === total (for non-cancelled, non-overpaid bills).
 */
export function recomputeBill(
  total: Paise,
  payments: PaymentRecord[] = [],
  isCancelled = false
): { paid: Paise; balance: Paise; status: BillStatus } {
  if (isCancelled) {
    const paidSum = payments.reduce((acc, p) => addPaise(acc, p.amount), asPaise(0));
    return {
      paid: paidSum,
      balance: asPaise(0),
      status: 'CANCELLED',
    };
  }

  const paidSum = payments.reduce((acc, p) => addPaise(acc, p.amount), asPaise(0));
  const paid = asPaise(Math.max(0, Number(paidSum)));

  if (paid >= total) {
    return {
      paid: total,
      balance: asPaise(0),
      status: 'PAID',
    };
  }

  if (paid === 0) {
    return {
      paid: asPaise(0),
      balance: total,
      status: 'UNPAID',
    };
  }

  const balance = subtractPaise(total, paid);
  return {
    paid,
    balance,
    status: 'PARTIAL',
  };
}
