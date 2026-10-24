import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { Payment } from '@/models/Payment';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { Bill } from '@/models/Bill';
import { Patient } from '@/models/Patient';
import { runWithTenantContext } from '@/lib/tenancy';
import { AppendOnlyViolationError } from '@/lib/append-only';
import { clock } from '@/lib/clock';

describe('A10: Append-Only Model Enforcement (Payment & AuditLog)', () => {
  const clinicId = new Types.ObjectId();
  const actor = { type: 'USER' as const, id: 'doctor_1' };

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('Payment: permits document creation but strictly rejects all update and delete attempts', async () => {
    await runWithTenantContext({ clinicId, actor }, async () => {
      // Create required parent patient and bill
      const patient = await Patient.create({
        name: 'Billing Patient',
        patientCode: 'P-000001',
        ageYears: 30,
        sex: 'Male',
        phone: '9822000001',
        source: 'WALK_IN',
        consentAt: clock.now(),
        consentTextVersion: '1.0',
      });

      const bill = await Bill.create({
        billNo: 'BILL/2026-27/0001',
        patientId: patient._id,
        items: [{ description: 'Scaling', qty: 1, unitPrice: 300000, amount: 300000 }],
        discount: 0,
        total: 300000,
        paid: 300000,
        balance: 0,
        status: 'PAID',
      });

      // 1. Creation succeeds
      const payment = await Payment.create({
        billId: bill._id,
        receiptNo: 'REC/2026-27/0001',
        amount: 300000,
        method: 'CASH',
        isReversal: false,
        receivedAt: clock.now(),
      });

      expect(payment._id).toBeDefined();

      // 2. Reject save() on existing payment
      payment.amount = 200000;
      await expect(payment.save()).rejects.toThrow(AppendOnlyViolationError);

      // 3. Reject updateOne
      await expect(
        Payment.updateOne({ _id: payment._id }, { $set: { amount: 200000 } })
      ).rejects.toThrow(AppendOnlyViolationError);

      // 4. Reject updateMany
      await expect(
        Payment.updateMany({ _id: payment._id }, { $set: { method: 'UPI' } })
      ).rejects.toThrow(AppendOnlyViolationError);

      // 5. Reject findOneAndUpdate
      await expect(
        Payment.findOneAndUpdate({ _id: payment._id }, { $set: { amount: 100 } })
      ).rejects.toThrow(AppendOnlyViolationError);

      // 6. Reject replaceOne
      await expect(
        Payment.replaceOne({ _id: payment._id }, { amount: 500 })
      ).rejects.toThrow(AppendOnlyViolationError);

      // 7. Reject deleteOne
      await expect(Payment.deleteOne({ _id: payment._id })).rejects.toThrow(
        AppendOnlyViolationError
      );

      // 8. Reject deleteMany
      await expect(Payment.deleteMany({ _id: payment._id })).rejects.toThrow(
        AppendOnlyViolationError
      );
    });
  });

  it('AuditLog: permits document creation but strictly rejects all update and delete attempts', async () => {
    await runWithTenantContext({ clinicId, actor }, async () => {
      // 1. Creation succeeds
      const auditLog = await AuditLog.create({
        action: AuditAction.AUTH_LOGIN,
        entity: 'User',
        entityId: 'user_123',
        actor,
        at: clock.now(),
      });

      expect(auditLog._id).toBeDefined();

      // 2. Reject save() on existing audit log
      auditLog.action = AuditAction.AUTH_FAIL;
      await expect(auditLog.save()).rejects.toThrow(AppendOnlyViolationError);

      // 3. Reject updateOne
      await expect(
        AuditLog.updateOne({ _id: auditLog._id }, { $set: { action: AuditAction.AUTH_FAIL } })
      ).rejects.toThrow(AppendOnlyViolationError);

      // 4. Reject deleteOne
      await expect(AuditLog.deleteOne({ _id: auditLog._id })).rejects.toThrow(
        AppendOnlyViolationError
      );
    });
  });
});
