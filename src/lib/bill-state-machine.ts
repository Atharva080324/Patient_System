import { Paise } from './money';
import { BillStatus } from './billing';

export type { BillStatus };

export class BillStateTransitionError extends Error {
  public statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'BillStateTransitionError';
  }
}

/**
 * Bill editing rule:
 * Lines and discount may be edited only while the bill has NO payments (net paid = 0)
 * and is not cancelled. Once any payment exists, the bill is locked.
 */
export function canEditBill(bill: { status: BillStatus; paid: Paise | number }): boolean {
  if (bill.status === 'CANCELLED') return false;
  return Number(bill.paid) === 0;
}

/**
 * Bill cancellation rule:
 * Allowed only when net paid is 0. A bill with payments cannot be cancelled
 * directly (payments must be reversed first).
 */
export function canCancelBill(bill: { status: BillStatus; paid: Paise | number }): boolean {
  if (bill.status === 'CANCELLED') return false;
  return Number(bill.paid) === 0;
}

export function canTransitionBill(
  current: BillStatus,
  action: 'CANCEL',
  paid: Paise | number = 0
): boolean {
  if (action === 'CANCEL') {
    return canCancelBill({ status: current, paid });
  }
  return false;
}
