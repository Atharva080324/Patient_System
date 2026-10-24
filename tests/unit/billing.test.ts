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

  describe('Model-Level Guard: Bill paid and balance protection', () => {
    it('rejects new Bill if paid/balance are directly set to arbitrary values without recomputeBill', async () => {
      const { Bill } = await import('@/models/Bill');
      const mongoose = (await import('mongoose')).default;
      const clinicId = new mongoose.Types.ObjectId();
      const patientId = new mongoose.Types.ObjectId();

      const invalidBill = new Bill({
        clinicId,
        billNo: 'BILL/2026-27/9991',
        patientId,
        items: [{ description: 'Scaling', qty: 1, unitPrice: 100000, amount: 100000 }],
        discount: 0,
        total: 100000,
        paid: 50000, // illegally set arbitrary paid
        balance: 50000,
        status: 'UNPAID',
        createdBy: { type: 'USER', id: 'doc_1' },
      });

      await expect(invalidBill.validate()).rejects.toThrow(
        /Invariant violation: bill\.paid and bill\.balance can only be set via recomputeBill/
      );
    });

    it('rejects direct modification of bill.paid on existing document without applyBillRecompute', async () => {
      const { Bill } = await import('@/models/Bill');
      const mongoose = (await import('mongoose')).default;
      const clinicId = new mongoose.Types.ObjectId();
      const patientId = new mongoose.Types.ObjectId();

      const validBill = new Bill();
      validBill.init({
        _id: new mongoose.Types.ObjectId(),
        clinicId,
        billNo: 'BILL/2026-27/9992',
        patientId,
        items: [{ description: 'Root Canal', qty: 1, unitPrice: 400000, amount: 400000 }],
        discount: 0,
        total: 400000,
        paid: 0,
        balance: 400000,
        status: 'UNPAID',
        createdBy: { type: 'USER', id: 'doc_1' },
      });

      validBill.paid = 200000; // Directly mutated without applyBillRecompute

      await expect(validBill.validate()).rejects.toThrow(
        /Invariant violation: direct modification of bill\.paid or bill\.balance is strictly prohibited/
      );
    });

    it('rejects direct modification of bill.balance on existing document without applyBillRecompute', async () => {
      const { Bill } = await import('@/models/Bill');
      const mongoose = (await import('mongoose')).default;
      const clinicId = new mongoose.Types.ObjectId();
      const patientId = new mongoose.Types.ObjectId();

      const bill = new Bill();
      bill.init({
        _id: new mongoose.Types.ObjectId(),
        clinicId,
        billNo: 'BILL/2026-27/9993',
        patientId,
        items: [{ description: 'Extraction', qty: 1, unitPrice: 150000, amount: 150000 }],
        discount: 0,
        total: 150000,
        paid: 0,
        balance: 150000,
        status: 'UNPAID',
        createdBy: { type: 'USER', id: 'doc_1' },
      });

      bill.balance = 0; // Illegally wiped balance without payment

      await expect(bill.validate()).rejects.toThrow(
        /Invariant violation: direct modification of bill\.paid or bill\.balance is strictly prohibited/
      );
    });

    it('permits update when applyBillRecompute is used', async () => {
      const { Bill } = await import('@/models/Bill');
      const { applyBillRecompute } = await import('@/lib/billing');
      const mongoose = (await import('mongoose')).default;
      const clinicId = new mongoose.Types.ObjectId();
      const patientId = new mongoose.Types.ObjectId();

      const bill = new Bill();
      bill.init({
        _id: new mongoose.Types.ObjectId(),
        clinicId,
        billNo: 'BILL/2026-27/9994',
        patientId,
        items: [{ description: 'Crown', qty: 1, unitPrice: 500000, amount: 500000 }],
        discount: 0,
        total: 500000,
        paid: 0,
        balance: 500000,
        status: 'UNPAID',
        createdBy: { type: 'USER', id: 'doc_1' },
      });

      applyBillRecompute(bill, [{ amount: asPaise(300000), method: 'UPI' }]);

      expect(bill.paid).toBe(300000);
      expect(bill.balance).toBe(200000);
      expect(bill.status).toBe('PARTIAL');

      // Validates successfully without throwing
      await expect(bill.validate()).resolves.toBeUndefined();
    });
  });
});
