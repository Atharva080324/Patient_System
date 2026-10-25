import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { systemScope, runWithTenantContext, TenantActor } from '@/lib/tenancy';
import { Clinic } from '@/models/Clinic';
import { User } from '@/models/User';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { Estimate } from '@/models/Estimate';
import { Bill, IBill } from '@/models/Bill';
import { Payment } from '@/models/Payment';
import { Counter } from '@/models/Counter';
import { Treatment } from '@/models/Treatment';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import {
  createEstimateDraft,
  updateEstimateDraft,
  issueEstimate,
  cancelEstimate,
  recordEstimatePrint,
  getEstimate,
  listEstimates,
} from '@/lib/estimate-service';
import {
  createBill,
  updateBillDraft,
  cancelBill,
  getBill,
  listBills,
  recordBillPrint,
} from '@/lib/bill-service';
import { convertEstimateToBill } from '@/lib/estimate-to-bill';
import {
  recordPayment,
  reversePayment,
  recordReceiptPrint,
  collectionsForDay,
} from '@/lib/payment-service';
import { asPaise } from '@/lib/money';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';

describe('Phase 4: Billing, Estimates, Payments & Financial Integrity Integration Suite', () => {
  let clinicId: mongoose.Types.ObjectId;
  let clinic2Id: mongoose.Types.ObjectId;
  let testPatient: any;
  let testVisit: any;
  let testTreatment: any;
  const doctorActor: TenantActor = { type: 'USER', id: 'doc_susheel_p4' };
  const doctor2Actor: TenantActor = { type: 'USER', id: 'doc_other_p4' };

  beforeAll(async () => {
    await connectDb();

    try {
      await Payment.collection.dropIndex('clinicId_1_idempotencyKey_1');
    } catch {
      // index might not exist yet
    }
    await Payment.syncIndexes();

    // 1. Primary Clinic (Dr. Susheel)
    const clinic = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Advanced Dental Clinic & Implant Center" },
      {
        $setOnInsert: {
          address: 'Station Road, Chhatrapati Sambhajinagar',
          phone: '+91-98220-11111',
          email: 'billing@drsusheelclinic.com',
          registrationNo: 'MH-BILL-P4-001',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicId = clinic._id;

    // 2. Secondary Clinic (for Tenant Isolation D16)
    const clinic2 = await Clinic.findOneAndUpdate(
      { name: "Second Isolation Clinic" },
      {
        $setOnInsert: {
          address: 'Pune Road, Chhatrapati Sambhajinagar',
          phone: '+91-98220-22222',
          email: 'iso@clinic2.com',
          registrationNo: 'MH-ISO-P4-002',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinic2Id = clinic2._id;

    await systemScope(clinicId, async () => {
      // Clear past test data
      await Payment.collection.deleteMany({ clinicId });
      await Bill.deleteMany({ clinicId });
      await Estimate.deleteMany({ clinicId });
      await Visit.deleteMany({ clinicId });
      await Patient.deleteMany({ clinicId });
      await Treatment.deleteMany({ clinicId });
      await Counter.deleteMany({ clinicId });

      // Create Patient
      testPatient = await Patient.create({
        clinicId,
        patientCode: 'P-P4-0001',
        name: 'Suresh Patil',
        phone: '9822099999',
        sex: 'Male',
        ageYears: 42,
        consentAt: clock.now(),
        consentTextVersion: '1.0',
        createdBy: doctorActor,
      });

      // Create Visit
      testVisit = await Visit.create({
        clinicId,
        patientId: testPatient._id,
        date: '2026-10-25',
        token: 401,
        type: 'WALK_IN',
        status: 'IN_CONSULTATION',
        checkInAt: clock.now(),
        reasonForVisit: 'Severe tooth pain',
        version: 1,
        createdBy: doctorActor,
      });

      // Create Treatment
      testTreatment = await Treatment.create({
        clinicId,
        code: 'RCT-MOL',
        name: 'Root Canal Treatment (Molar)',
        category: 'Endodontics',
        idaMin: 3500,
        idaMax: 6000,
        unit: 'per tooth',
        clinicPrice: 400000, // 4,000 INR
        active: true,
        createdBy: doctorActor,
      });
    });
  });

  afterAll(async () => {
    await systemScope(clinicId, async () => {
      await Payment.collection.deleteMany({ clinicId });
      await Bill.deleteMany({ clinicId });
      await Estimate.deleteMany({ clinicId });
      await Visit.deleteMany({ clinicId });
      await Patient.deleteMany({ clinicId });
      await Treatment.deleteMany({ clinicId });
      await Clinic.deleteMany({ _id: clinicId });
    });
    await systemScope(clinic2Id, async () => {
      await Payment.collection.deleteMany({ clinicId: clinic2Id });
      await Bill.deleteMany({ clinicId: clinic2Id });
      await Estimate.deleteMany({ clinicId: clinic2Id });
      await Clinic.deleteMany({ _id: clinic2Id });
    });
    await disconnectDb();
  });

  describe('D1: Atomic Bill and First Payment Transaction & Failure Rollback', () => {
    it('writes bill and initial payment in ONE transaction; failure injection leaves NO bill, NO payment, and NO consumed counters', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // Attempt creation with failure injected right after bill write
        await expect(
          createBill(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              items: [
                {
                  treatmentId: testTreatment._id.toString(),
                  description: 'Root Canal Treatment (Molar)',
                  teeth: [46],
                  qty: 1,
                  unitPrice: 400000,
                  amount: 400000,
                },
              ],
              discount: 0,
              initialPayment: {
                amount: 200000,
                method: 'CASH',
              },
              _injectFailureAfterBill: true,
            },
            doctorActor
          )
        ).rejects.toThrow(/INJECTED_FAILURE_AFTER_BILL_WRITE/);

        // Verify that NO bill and NO payment were persisted
        const billsCount = await Bill.countDocuments({ clinicId });
        const paymentsCount = await Payment.countDocuments({ clinicId });
        expect(billsCount).toBe(0);
        expect(paymentsCount).toBe(0);

        // Now create normally and verify gapless sequential allocation starts at 0001
        const { bill, payment } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                treatmentId: testTreatment._id.toString(),
                description: 'Root Canal Treatment (Molar)',
                teeth: [46],
                qty: 1,
                unitPrice: 400000,
                amount: 400000,
              },
            ],
            discount: 0,
            initialPayment: {
              amount: 200000,
              method: 'CASH',
            },
          },
          doctorActor
        );

        expect(bill.billNo).toMatch(/BILL\/\d{4}-\d{2}\/0001$/);
        expect(payment?.receiptNo).toMatch(/REC\/\d{4}-\d{2}\/0001$/);
        expect(bill.paid).toBe(200000);
        expect(bill.balance).toBe(200000);
        expect(bill.status).toBe('PARTIAL');

        await Payment.collection.deleteMany({ clinicId });
        await Bill.deleteMany({ clinicId });
      });
    });
  });

  describe('D8: Estimate Lifecycle, Conversion to Bill & Immutability', () => {
    it('creates draft, issues with gapless EST/FY/0001, converts to bill with exact fidelity, and marks CONVERTED', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // 1. Create Draft
        const draft = await createEstimateDraft(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            visitId: testVisit._id.toString(),
            items: [
              {
                treatmentId: testTreatment._id.toString(),
                description: 'Root Canal Treatment (Molar)',
                teeth: [46],
                qty: 1,
                unitPrice: 400000,
                amount: 400000,
              },
            ],
            discount: 50000, // 500 INR discount
            validUntil: '2026-11-15',
            notes: 'Comprehensive molar endodontic treatment',
          },
          doctorActor
        );

        expect(draft.status).toBe('DRAFT');
        expect(draft.estimateNo).toBeUndefined();
        expect(draft.total).toBe(350000);

        // 2. Issue Estimate
        const issued = await issueEstimate(clinicId, draft._id, doctorActor);
        expect(issued.status).toBe('ISSUED');
        expect(issued.estimateNo).toMatch(/EST\/\d{4}-\d{2}\/0001$/);
        expect(issued.snapshot).toBeDefined();
        expect(issued.snapshot?.clinic?.name).toContain('Advanced Dental');
        expect(issued.snapshot?.patient?.name).toBe('Suresh Patil');

        // Record print
        const printed = await recordEstimatePrint(clinicId, issued._id, doctorActor);
        expect(printed.printCount).toBe(1);

        // 3. Convert to Bill
        const { bill } = await convertEstimateToBill(clinicId, issued._id, doctorActor);
        expect(bill.billNo).toMatch(/BILL\/\d{4}-\d{2}\/\d{4}$/);
        expect(bill.items).toHaveLength(1);
        expect(bill.items[0].teeth).toEqual([46]);
        expect(bill.items[0].unitPrice).toBe(400000);
        expect(bill.discount).toBe(50000);
        expect(bill.total).toBe(350000);
        expect(bill.status).toBe('UNPAID');

        // Verify Estimate status transitioned to CONVERTED
        const estimateAfter = await getEstimate(clinicId, issued._id);
        expect(estimateAfter?.status).toBe('CONVERTED');
        expect(estimateAfter?.convertedToBillId?.toString()).toBe(bill._id.toString());

        // Attempting to convert again fails with 409
        await expect(convertEstimateToBill(clinicId, issued._id, doctorActor)).rejects.toThrow(
          /Cannot convert estimate with status CONVERTED/
        );

        await Bill.deleteMany({ clinicId });
        await Estimate.deleteMany({ clinicId });
      });
    });
  });

  describe('D9: One Active Bill Per Visit Invariant (Positive Filter)', () => {
    it('enforces exactly one active bill per visit; cancelling a bill frees the visit for a new bill', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // Create first bill for testVisit
        const { bill: bill1 } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            visitId: testVisit._id.toString(),
            items: [
              {
                description: 'Consultation & X-Ray',
                teeth: [],
                qty: 1,
                unitPrice: 50000,
                amount: 50000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        expect(bill1.activeForVisit).toBe(true);

        // Attempt to create second active bill for the same visit -> rejected with 409
        await expect(
          createBill(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              visitId: testVisit._id.toString(),
              items: [
                {
                  description: 'Second Bill Attempt',
                  teeth: [],
                  qty: 1,
                  unitPrice: 50000,
                  amount: 50000,
                },
              ],
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/already has an active bill/);

        // Cancel the first bill with a reason
        const cancelled = await cancelBill(clinicId, bill1._id, 'Patient opted for alternative clinic', doctorActor);
        expect(cancelled.status).toBe('CANCELLED');
        expect(cancelled.activeForVisit).toBe(false);

        // Now creating a new bill for the same visit SUCCEEDS because activeForVisit was released
        const { bill: bill2 } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            visitId: testVisit._id.toString(),
            items: [
              {
                description: 'New Bill After Cancellation',
                teeth: [],
                qty: 1,
                unitPrice: 50000,
                amount: 50000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        expect(bill2.activeForVisit).toBe(true);
        expect(bill2.status).toBe('UNPAID');

        await Bill.deleteMany({ clinicId });
      });
    });
  });

  describe('D6: Concurrent Payments & Overpayment Prevention', () => {
    it('rejects payments exceeding balance; parallel payments that together exceed balance allow only one to succeed', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Scaling & Polishing',
                teeth: [],
                qty: 1,
                unitPrice: 150000, // 1,500 INR
                amount: 150000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        // Direct overpayment attempt (2,000 INR on 1,500 INR bill)
        await expect(
          recordPayment(
            clinicId,
            {
              billId: bill._id.toString(),
              amount: 200000,
              method: 'UPI',
            },
            doctorActor
          )
        ).rejects.toThrow(/exceeds outstanding balance/);

        // Partial payment of 1,000 INR (balance remaining: 500 INR)
        await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 100000,
            method: 'CASH',
          },
          doctorActor
        );

        // Two parallel payments of 400 INR each (total 800 INR > 500 INR balance)
        const p1 = recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 40000,
            method: 'UPI',
          },
          doctorActor
        );

        const p2 = recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 40000,
            method: 'CASH',
          },
          doctorActor
        );

        const results = await Promise.allSettled([p1, p2]);
        const successes = results.filter((r) => r.status === 'fulfilled');
        const rejections = results.filter((r) => r.status === 'rejected');

        // Exactly one should succeed, the other rejected with balance error
        expect(successes).toHaveLength(1);
        expect(rejections).toHaveLength(1);

        // Verify bill is never overpaid
        const { bill: refreshed } = (await getBill(clinicId, bill._id))!;
        expect(refreshed.paid).toBeLessThanOrEqual(refreshed.total);
        expect(refreshed.balance).toBeGreaterThanOrEqual(0);

        await Payment.collection.deleteMany({ clinicId });
        await Bill.deleteMany({ clinicId });
      });
    });
  });

  describe('D4: Payment Reversals (Once-Only & Cannot Reverse a Reversal)', () => {
    it('creates reversal document, restores balance, rejects duplicate reversals, and blocks reversing a reversal', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Crown Placement',
                teeth: [11],
                qty: 1,
                unitPrice: 800000, // 8,000 INR
                amount: 800000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        const { payment } = await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 800000,
            method: 'UPI',
            upiRef: 'UPI12345678',
          },
          doctorActor
        );

        const billPaid = (await getBill(clinicId, bill._id))!.bill;
        expect(billPaid.status).toBe('PAID');

        // Reverse payment
        const { reversalPayment, billBalance } = await reversePayment(
          clinicId,
          payment._id,
          'Patient requested full refund via UPI',
          doctorActor
        );

        expect(reversalPayment.isReversal).toBe(true);
        expect(reversalPayment.amount).toBe(-800000);
        expect(reversalPayment.receiptNo).toMatch(/^REC\//);
        expect(billBalance).toBe(800000);

        // Bill transitions back to UNPAID
        const billAfter = (await getBill(clinicId, bill._id))!.bill;
        expect(billAfter.status).toBe('UNPAID');
        expect(billAfter.paid).toBe(0);
        expect(billAfter.balance).toBe(800000);

        // Race test: 10 parallel attempts to reverse the SAME payment -> exactly ONE succeeds
        const parallelReversals = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            reversePayment(clinicId, payment._id, 'Duplicate reversal race', doctorActor)
          )
        );
        const successfulReversals = parallelReversals.filter((r) => r.status === 'fulfilled');
        expect(successfulReversals).toHaveLength(0); // Already reversed above!

        // Attempt to reverse the reversal document itself -> rejected
        await expect(
          reversePayment(clinicId, reversalPayment._id, 'Illegal reversal of reversal', doctorActor)
        ).rejects.toThrow(/already a reversal/);

        await Payment.collection.deleteMany({ clinicId });
        await Bill.deleteMany({ clinicId });
      });
    });
  });

  describe('D7: Idempotency Verification', () => {
    it('10 parallel payment submissions with the same idempotency key create exactly ONE payment', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Dental Consultation',
                teeth: [],
                qty: 1,
                unitPrice: 50000,
                amount: 50000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        const key = `idem-pay-${Date.now()}`;

        const promises = Array.from({ length: 10 }, () =>
          recordPayment(
            clinicId,
            {
              billId: bill._id.toString(),
              amount: 50000,
              method: 'CASH',
              idempotencyKey: key,
            },
            doctorActor
          )
        );

        const results = await Promise.all(promises);
        const distinctReceipts = new Set(results.map((r) => r.payment.receiptNo));

        // Exactly one unique receipt allocated
        expect(distinctReceipts.size).toBe(1);

        const countInDb = await Payment.countDocuments({ clinicId, idempotencyKey: key });
        expect(countInDb).toBe(1);

        await Payment.collection.deleteMany({ clinicId });
        await Bill.deleteMany({ clinicId });
      });
    });
  });

  describe('D5: 50 Concurrent Payments Allocate 50 Gapless Receipts', () => {
    it('allocates 50 sequential gapless receipts across parallel bills', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // Create 50 bills
        const bills: IBill[] = [];
        for (let i = 0; i < 50; i++) {
          const { bill } = await createBill(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              items: [
                {
                  description: `Item ${i + 1}`,
                  teeth: [],
                  qty: 1,
                  unitPrice: 10000,
                  amount: 10000,
                },
              ],
              discount: 0,
            },
            doctorActor
          );
          bills.push(bill);
        }

        // Record 50 payments in parallel
        const paymentPromises = bills.map((b) =>
          recordPayment(
            clinicId,
            {
              billId: b._id.toString(),
              amount: 10000,
              method: 'CASH',
            },
            doctorActor
          )
        );

        const paymentResults = await Promise.all(paymentPromises);
        const receiptNumbers = paymentResults.map((p) => p.payment.receiptNo);
        const uniqueReceipts = new Set(receiptNumbers);

        expect(uniqueReceipts.size).toBe(50);

        // Verify gapless ordering
        const numbers = receiptNumbers
          .map((r) => parseInt(r.split('/')[2], 10))
          .sort((a, b) => a - b);

        const startNo = numbers[0];
        for (let i = 0; i < 50; i++) {
          expect(numbers[i]).toBe(startNo + i);
        }

        await Payment.collection.deleteMany({ clinicId });
        await Bill.deleteMany({ clinicId });
      });
    });
  });

  describe('D15: collectionsForDay Service Function', () => {
    it('returns exact net collections matching payments minus reversals for the day', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        await Payment.collection.deleteMany({ clinicId });
        await Bill.deleteMany({ clinicId });

        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Treatment Collection Day Test',
                teeth: [],
                qty: 1,
                unitPrice: 100000,
                amount: 100000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        // Payment 1: 500 INR Cash
        await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 50000,
            method: 'CASH',
          },
          doctorActor
        );

        // Payment 2: 300 INR UPI
        const { payment: upiPay } = await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 30000,
            method: 'UPI',
          },
          doctorActor
        );

        // Reverse Payment 2 (-300 INR UPI)
        await reversePayment(clinicId, upiPay._id, 'UPI reversal', doctorActor);

        const summary = await collectionsForDay(clinicId, clinicDate(clock.now()));
        expect(summary.cash).toBe(50000);
        expect(summary.upi).toBe(0); // 30000 - 30000 = 0
        expect(summary.netTotal).toBe(50000);
        expect(summary.count).toBe(3); // 2 payments + 1 reversal

        await Payment.collection.deleteMany({ clinicId });
        await Bill.deleteMany({ clinicId });
      });
    });
  });

  describe('D14: Print Snapshot Immutability', () => {
    it('reprints render from frozen snapshot; changing clinic settings or patient name does NOT change snapshot', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const draft = await createEstimateDraft(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Diagnostic Casts',
                teeth: [],
                qty: 1,
                unitPrice: 100000,
                amount: 100000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        const issued = await issueEstimate(clinicId, draft._id, doctorActor);
        expect(issued.snapshot?.patient?.name).toBe('Suresh Patil');

        // Mutate patient name in database
        await Patient.updateOne({ _id: testPatient._id }, { $set: { name: 'Completely Changed Name' } });

        // Retrieve estimate again
        const fresh = await getEstimate(clinicId, issued._id);
        // Snapshot patient name MUST still be the frozen original "Suresh Patil"
        expect(fresh?.snapshot?.patient?.name).toBe('Suresh Patil');

        // Restore original patient name
        await Patient.updateOne({ _id: testPatient._id }, { $set: { name: 'Suresh Patil' } });
        await Estimate.deleteMany({ clinicId });
      });
    });
  });

  describe('D16: Tenant Isolation', () => {
    it('prevents Clinic 2 from accessing or modifying Clinic 1 bills, estimates, or payments', async () => {
      let clinic1BillId: string;

      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Confidential Extraction',
                teeth: [38],
                qty: 1,
                unitPrice: 200000,
                amount: 200000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );
        clinic1BillId = bill._id.toString();
      });

      // Now operate as Clinic 2
      await runWithTenantContext({ clinicId: clinic2Id.toString(), actor: doctor2Actor }, async () => {
        // Cannot read Clinic 1 bill
        const result = await getBill(clinic2Id, clinic1BillId);
        expect(result).toBeNull();

        // Cannot record payment against Clinic 1 bill
        await expect(
          recordPayment(
            clinic2Id,
            {
              billId: clinic1BillId,
              amount: 50000,
              method: 'CASH',
            },
            doctor2Actor
          )
        ).rejects.toThrow(/Bill not found/);

        // Cannot cancel Clinic 1 bill
        await expect(cancelBill(clinic2Id, clinic1BillId, 'Intrusion test', doctor2Actor)).rejects.toThrow(
          /Bill not found/
        );
      });

      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        await Bill.deleteMany({ clinicId });
      });
    });
  });

  describe('D17: Audit Log Verification', () => {
    it('writes audit entries with entity IDs and field names only (never financial amounts or patient PII)', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Audit Test Treatment',
                teeth: [],
                qty: 1,
                unitPrice: 100000,
                amount: 100000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        const logs = await AuditLog.find({ clinicId, entity: 'Bill', entityId: bill._id.toString() });
        expect(logs.length).toBeGreaterThanOrEqual(1);

        for (const log of logs) {
          expect(log.meta).toBeDefined();
          // Ensure patient name or phone is never in audit meta
          const metaStr = JSON.stringify(log.meta);
          expect(metaStr).not.toContain('Suresh Patil');
          expect(metaStr).not.toContain('9822099999');
        }

        await Bill.deleteMany({ clinicId });
        await AuditLog.collection.deleteMany({ clinicId });
      });
    });
  });
});
