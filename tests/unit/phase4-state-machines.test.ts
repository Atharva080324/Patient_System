import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { asPaise, Paise, amountInWordsINR, formatINR, applyPercentDiscount } from '@/lib/money';
import { recomputeBill } from '@/lib/billing';
import {
  canTransitionEstimate,
  transitionEstimate,
  isEstimateExpired,
  EstimateStatus,
} from '@/lib/estimate-state-machine';
import {
  canTransitionBill,
  canEditBill,
  canCancelBill,
  BillStatus,
} from '@/lib/bill-state-machine';
import { convertEstimateItemsToBillItems } from '@/lib/estimate-to-bill';

describe('Phase 4: State Machines, Financial Invariants & Transitions (Test-First)', () => {
  describe('D11: Estimate State Machine & Transition Matrix', () => {
    it('allows valid estimate transitions: DRAFT -> ISSUED, DRAFT -> CANCELLED, ISSUED -> CONVERTED, ISSUED -> CANCELLED', () => {
      expect(canTransitionEstimate('DRAFT', 'ISSUE')).toBe(true);
      expect(canTransitionEstimate('DRAFT', 'CANCEL')).toBe(true);
      expect(canTransitionEstimate('ISSUED', 'CONVERT')).toBe(true);
      expect(canTransitionEstimate('ISSUED', 'CANCEL')).toBe(true);
    });

    it('rejects illegal estimate transitions with descriptive error / returns false', () => {
      // Cannot convert a draft directly without issuing
      expect(canTransitionEstimate('DRAFT', 'CONVERT')).toBe(false);
      // Cannot issue an already issued estimate
      expect(canTransitionEstimate('ISSUED', 'ISSUE')).toBe(false);
      // Cannot transition from terminal CONVERTED state
      expect(canTransitionEstimate('CONVERTED', 'CANCEL')).toBe(false);
      expect(canTransitionEstimate('CONVERTED', 'ISSUE')).toBe(false);
      expect(canTransitionEstimate('CONVERTED', 'CONVERT')).toBe(false);
      // Cannot transition from terminal CANCELLED state
      expect(canTransitionEstimate('CANCELLED', 'ISSUE')).toBe(false);
      expect(canTransitionEstimate('CANCELLED', 'CONVERT')).toBe(false);
      expect(canTransitionEstimate('CANCELLED', 'CANCEL')).toBe(false);
    });

    it('transitionEstimate produces expected state or throws 409 Conflict', () => {
      expect(transitionEstimate('DRAFT', 'ISSUE')).toBe('ISSUED');
      expect(transitionEstimate('ISSUED', 'CONVERT')).toBe('CONVERTED');
      expect(transitionEstimate('ISSUED', 'CANCEL')).toBe('CANCELLED');

      expect(() => transitionEstimate('CONVERTED', 'CANCEL')).toThrowError(
        /Cannot perform action CANCEL on estimate with status CONVERTED/
      );
      expect(() => transitionEstimate('DRAFT', 'CONVERT')).toThrowError(
        /Cannot perform action CONVERT on estimate with status DRAFT/
      );
    });
  });

  describe('D12: Expired Estimates in Asia/Kolkata Timezone', () => {
    it('computes expired dynamically based on validUntil at 23:59:59.999 Asia/Kolkata boundary', () => {
      const validUntilDateStr = '2026-10-25'; // Expires at end of day 2026-10-25 in IST

      // 2026-10-25 23:59:59 IST = 2026-10-25 18:29:59 UTC
      const beforeMidnight = new Date('2026-10-25T18:29:59.000Z');
      expect(isEstimateExpired(validUntilDateStr, beforeMidnight)).toBe(false);

      // 2026-10-26 00:00:01 IST = 2026-10-25 18:30:01 UTC
      const afterMidnight = new Date('2026-10-25T18:30:01.000Z');
      expect(isEstimateExpired(validUntilDateStr, afterMidnight)).toBe(true);
    });

    it('returns false if estimate has no validUntil date', () => {
      expect(isEstimateExpired(undefined, new Date())).toBe(false);
      expect(isEstimateExpired(null as any, new Date())).toBe(false);
    });
  });

  describe('D10 & D11: Bill State Machine & Editing / Cancellation Lock Rules', () => {
    it('allows editing bill lines only when bill is not cancelled and has zero net payments', () => {
      expect(canEditBill({ status: 'UNPAID', paid: asPaise(0) })).toBe(true);
      // Locked once any payment exists
      expect(canEditBill({ status: 'PARTIAL', paid: asPaise(50000) })).toBe(false);
      expect(canEditBill({ status: 'PAID', paid: asPaise(100000) })).toBe(false);
      // Locked if cancelled
      expect(canEditBill({ status: 'CANCELLED', paid: asPaise(0) })).toBe(false);
    });

    it('allows cancelling a bill only when net paid is 0', () => {
      expect(canCancelBill({ status: 'UNPAID', paid: asPaise(0) })).toBe(true);
      expect(canCancelBill({ status: 'PARTIAL', paid: asPaise(10000) })).toBe(false);
      expect(canCancelBill({ status: 'PAID', paid: asPaise(50000) })).toBe(false);
      expect(canCancelBill({ status: 'CANCELLED', paid: asPaise(0) })).toBe(false);
    });

    it('recomputeBill transitions bill status reversibly on payments and reversals', () => {
      const total = asPaise(100000); // 1,000 INR

      // Initial: UNPAID
      const initial = recomputeBill(total, []);
      expect(initial.status).toBe('UNPAID');
      expect(initial.paid).toBe(0);
      expect(initial.balance).toBe(100000);

      // Partial payment 400 INR: PARTIAL
      const partial = recomputeBill(total, [{ amount: asPaise(40000) }]);
      expect(partial.status).toBe('PARTIAL');
      expect(partial.paid).toBe(40000);
      expect(partial.balance).toBe(60000);

      // Full payment +600 INR: PAID
      const full = recomputeBill(total, [{ amount: asPaise(40000) }, { amount: asPaise(60000) }]);
      expect(full.status).toBe('PAID');
      expect(full.paid).toBe(100000);
      expect(full.balance).toBe(0);

      // Partial reversal of 600 INR payment: back to PARTIAL
      const reversedPartial = recomputeBill(total, [
        { amount: asPaise(40000) },
        { amount: asPaise(60000) },
        { amount: asPaise(-60000), isReversal: true },
      ]);
      expect(reversedPartial.status).toBe('PARTIAL');
      expect(reversedPartial.paid).toBe(40000);
      expect(reversedPartial.balance).toBe(60000);

      // Complete reversal of all payments: back to UNPAID
      const reversedAll = recomputeBill(total, [
        { amount: asPaise(40000) },
        { amount: asPaise(60000) },
        { amount: asPaise(-60000), isReversal: true },
        { amount: asPaise(-40000), isReversal: true },
      ]);
      expect(reversedAll.status).toBe('UNPAID');
      expect(reversedAll.paid).toBe(0);
      expect(reversedAll.balance).toBe(100000);
    });
  });

  describe('D8: Estimate to Bill Conversion Fidelity', () => {
    it('carries over every line item, description, tooth array, quantity, unit price, and discount exactly', () => {
      const estimate = {
        _id: 'est_123',
        patientId: 'pat_456',
        visitId: 'vis_789',
        items: [
          {
            treatmentId: 'treat_01',
            description: 'Composite Restoration (Single Surface)',
            teeth: [11, 21],
            qty: 2,
            unitPrice: 150000, // 1,500 INR
            amount: 300000,
          },
          {
            treatmentId: 'treat_02',
            description: 'Root Canal Treatment (Molar)',
            teeth: [46],
            qty: 1,
            unitPrice: 450000, // 4,500 INR
            amount: 450000,
          },
        ],
        subtotal: 750000,
        discount: 50000,
        total: 700000,
        notes: 'Estimate valid for 14 days',
      };

      const billInput = convertEstimateItemsToBillItems(estimate);
      expect(billInput.items).toHaveLength(2);
      expect(billInput.items[0]).toEqual({
        treatmentId: 'treat_01',
        description: 'Composite Restoration (Single Surface)',
        teeth: [11, 21],
        qty: 2,
        unitPrice: 150000,
        amount: 300000,
      });
      expect(billInput.items[1]).toEqual({
        treatmentId: 'treat_02',
        description: 'Root Canal Treatment (Molar)',
        teeth: [46],
        qty: 1,
        unitPrice: 450000,
        amount: 450000,
      });
      expect(billInput.discount).toBe(50000);
      expect(billInput.total).toBe(700000);
    });
  });

  describe('D13 & D20: Amount in Words Table (>= 20 cases including paise) & Formatting', () => {
    const testCases: Array<[number, string]> = [
      [0, 'Rupees Zero Only'],
      [50, 'Rupees Zero and Fifty Paise Only'],
      [100, 'Rupees One Only'],
      [150, 'Rupees One and Fifty Paise Only'],
      [2500, 'Rupees Twenty-Five Only'],
      [9999, 'Rupees Ninety-Nine and Ninety-Nine Paise Only'],
      [10000, 'Rupees One Hundred Only'],
      [10525, 'Rupees One Hundred Five and Twenty-Five Paise Only'],
      [100000, 'Rupees One Thousand Only'],
      [150050, 'Rupees One Thousand Five Hundred and Fifty Paise Only'],
      [1000000, 'Rupees Ten Thousand Only'],
      [10000000, 'Rupees One Lakh Only'],
      [12345600, 'Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six Only'],
      [12345650, 'Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only'],
      [100000000, 'Rupees Ten Lakhs Only'],
      [1000000000, 'Rupees One Crore Only'],
      [1234567890, 'Rupees Twelve Crores Thirty-Four Lakhs Fifty-Six Thousand Seven Hundred Eighty-Nine Only'],
      [5000000000, 'Rupees Fifty Crores Only'],
      [75, 'Rupees Zero and Seventy-Five Paise Only'],
      [420000, 'Rupees Four Thousand Two Hundred Only'],
      [3500000, 'Rupees Thirty-Five Thousand Only'],
      [890005, 'Rupees Eight Thousand Nine Hundred and Five Paise Only'],
    ];

    it.each(testCases)('converts %i paise to "%s"', (paise, expectedWords) => {
      expect(amountInWordsINR(asPaise(paise))).toBe(expectedWords);
    });

    it('formats currency correctly with lakh and crore grouping (formatINR)', () => {
      // 1,23,456.50
      expect(formatINR(asPaise(12345650))).toContain('1,23,456.50');
      // 12,34,567.89
      expect(formatINR(asPaise(123456789))).toContain('12,34,567.89');
    });
  });

  describe('D2: Financial Property Invariants (fast-check)', () => {
    it('always satisfies paid + balance === total, balance >= 0, and paid <= total for non-cancelled bills', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100_000_000 }), // total up to 10 Lakh INR
          fc.array(fc.integer({ min: 0, max: 50_000_000 }), { minLength: 0, maxLength: 8 }), // payments
          (totalVal, paymentVals) => {
            const total = asPaise(totalVal);
            const payments = paymentVals.map((p) => ({ amount: asPaise(p) }));
            const result = recomputeBill(total, payments);

            const invariant1 = result.paid + result.balance === total;
            const invariant2 = result.balance >= 0;
            const invariant3 = result.paid <= total;
            const invariant4 = result.paid >= 0;

            return invariant1 && invariant2 && invariant3 && invariant4;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('recomputeBill is strictly deterministic and idempotent', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10_000_000 }),
          fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 0, maxLength: 5 }),
          (totalVal, paymentVals) => {
            const total = asPaise(totalVal);
            const payments = paymentVals.map((p) => ({ amount: asPaise(p) }));
            const run1 = recomputeBill(total, payments);
            const run2 = recomputeBill(total, payments);

            return (
              run1.paid === run2.paid &&
              run1.balance === run2.balance &&
              run1.status === run2.status
            );
          }
        )
      );
    });

    it('deterministic percentage discount rounding (round half away from zero at paise level)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100_000_000 }),
          fc.integer({ min: 0, max: 100 }),
          (totalVal, percent) => {
            const total = asPaise(totalVal);
            const { discount, finalAmount } = applyPercentDiscount(total, percent);
            return (
              discount >= 0 &&
              discount <= total &&
              finalAmount >= 0 &&
              discount + finalAmount === total
            );
          }
        )
      );
    });
  });
});
