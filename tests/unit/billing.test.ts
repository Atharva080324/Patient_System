import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { recomputeBill } from '@/lib/billing';
import { asPaise } from '@/lib/money';

describe('Billing Primitives (recomputeBill)', () => {
  it('correctly computes status UNPAID when zero payments received', () => {
    const total = asPaise(500000); // 5000 INR
    const result = recomputeBill(total, []);

    expect(result.paid).toBe(0);
    expect(result.balance).toBe(500000);
    expect(result.status).toBe('UNPAID');
    expect(result.paid + result.balance).toBe(total);
  });

  it('correctly computes status PARTIAL when partial payment received', () => {
    const total = asPaise(500000); // 5000 INR
    const result = recomputeBill(total, [
      { amount: asPaise(200000), method: 'CASH' },
    ]);

    expect(result.paid).toBe(200000);
    expect(result.balance).toBe(300000);
    expect(result.status).toBe('PARTIAL');
    expect(result.paid + result.balance).toBe(total);
  });

  it('correctly computes status PAID when full payment received', () => {
    const total = asPaise(500000); // 5000 INR
    const result = recomputeBill(total, [
      { amount: asPaise(200000), method: 'CASH' },
      { amount: asPaise(300000), method: 'UPI' },
    ]);

    expect(result.paid).toBe(500000);
    expect(result.balance).toBe(0);
    expect(result.status).toBe('PAID');
    expect(result.paid + result.balance).toBe(total);
  });

  it('caps paid at total and balance at 0 when overpaid', () => {
    const total = asPaise(500000);
    const result = recomputeBill(total, [
      { amount: asPaise(600000), method: 'UPI' },
    ]);

    expect(result.paid).toBe(500000);
    expect(result.balance).toBe(0);
    expect(result.status).toBe('PAID');
    expect(result.paid + result.balance).toBe(total);
  });

  it('handles cancelled status', () => {
    const total = asPaise(500000);
    const result = recomputeBill(total, [], true);
    expect(result.status).toBe('CANCELLED');
    expect(result.balance).toBe(0);
  });

  describe('Property Tests (fast-check): paid + balance === total invariant', () => {
    it('always satisfies paid + balance === total for non-cancelled bills', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10000000 }), // total
          fc.array(fc.integer({ min: 0, max: 2000000 }), { minLength: 0, maxLength: 5 }), // payments
          (totalVal, paymentVals) => {
            const total = asPaise(totalVal);
            const payments = paymentVals.map((p) => ({ amount: asPaise(p) }));
            const result = recomputeBill(total, payments);
            return result.paid + result.balance === total;
          }
        )
      );
    });
  });
});
