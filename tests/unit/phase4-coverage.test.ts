import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { systemScope, runWithTenantContext, TenantActor } from '../../src/lib/tenancy';
import { clock } from '../../src/lib/clock';
import { clinicDate } from '../../src/lib/date';
import { Clinic } from '../../src/models/Clinic';
import { Patient } from '../../src/models/Patient';
import { Visit } from '../../src/models/Visit';
import { Treatment } from '../../src/models/Treatment';
import { Bill } from '../../src/models/Bill';
import { Estimate } from '../../src/models/Estimate';
import { Payment } from '../../src/models/Payment';
import {
  createEstimateDraft,
  updateEstimateDraft,
  issueEstimate,
  cancelEstimate,
  recordEstimatePrint,
  getEstimate,
  listEstimates,
} from '../../src/lib/estimate-service';
import {
  createBill,
  updateBillDraft,
  cancelBill,
  recordBillPrint,
  getBill,
  listBills,
} from '../../src/lib/bill-service';
import {
  recordPayment,
  reversePayment,
  recordReceiptPrint,
  collectionsForDay,
} from '../../src/lib/payment-service';
import { convertEstimateToBill, convertEstimateItemsToBillItems } from '../../src/lib/estimate-to-bill';
import { BillStateTransitionError, canTransitionBill } from '../../src/lib/bill-state-machine';
import { applyBillRecompute } from '../../src/lib/billing';

describe('Phase 4: Comprehensive Coverage & Edge-Cases Suite', () => {
  let clinicId: Types.ObjectId;
  let testPatient: any;
  let testVisit: any;

  const doctorActor: TenantActor = {
    type: 'USER',
    id: 'dr_susheel_coverage',
  };

  beforeAll(async () => {
    await connectDb();

    try {
      await Estimate.collection.dropIndex('clinicId_1_estimateNo_1');
    } catch {
      // ignore
    }
    await Estimate.syncIndexes();

    const clinic = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Coverage Clinic" },
      {
        $setOnInsert: {
          address: 'Station Road, Chhatrapati Sambhajinagar',
          phone: '+91-98220-33333',
          email: 'cov@drsusheelclinic.com',
          registrationNo: 'MH-COV-P4-001',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicId = clinic._id;

    await systemScope(clinicId, async () => {
      await Payment.collection.deleteMany({ clinicId });
      await Bill.deleteMany({ clinicId });
      await Estimate.deleteMany({ clinicId });

      testPatient = await Patient.create({
        clinicId,
        patientCode: 'P-COV-001',
        name: 'Anita Deshmukh',
        phone: '9822088888',
        sex: 'Female',
        ageYears: 34,
        consentAt: clock.now(),
        consentTextVersion: '1.0',
        createdBy: doctorActor,
      });

      testVisit = await Visit.create({
        clinicId,
        patientId: testPatient._id,
        date: clinicDate(clock.now()),
        token: 501,
        type: 'WALK_IN',
        status: 'IN_CONSULTATION',
        checkInAt: clock.now(),
        reasonForVisit: 'Cleaning',
        version: 1,
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
      await Clinic.deleteMany({ _id: clinicId });
    });
    await disconnectDb();
  });

  describe('Estimate Service Edge Cases', () => {
    it('creates draft with discountPercent and updates draft successfully', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const draft = await createEstimateDraft(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Composite Restoration',
                teeth: [16],
                qty: 1,
                unitPrice: 200000,
                amount: 200000,
              },
            ],
            discountPercent: 10, // 10% of 200000 = 20000
            validUntil: '2026-12-31',
            notes: 'Estimate note',
          },
          doctorActor
        );

        expect(draft.discount).toBe(20000);
        expect(draft.total).toBe(180000);

        // Update draft with fixed discount
        const updated = await updateEstimateDraft(
          clinicId,
          draft._id,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                treatmentId: new Types.ObjectId().toString(),
                description: 'Composite Restoration',
                teeth: [16],
                qty: 2,
                unitPrice: 200000,
                amount: 400000,
              },
            ],
            discount: 50000,
            version: 1,
          },
          doctorActor
        );

        expect(updated.subtotal).toBe(400000);
        expect(updated.discount).toBe(50000);
        expect(updated.total).toBe(350000);
        expect(updated.version).toBe(2);

        // Update with discountPercent
        const updatedWithPercent = await updateEstimateDraft(
          clinicId,
          draft._id,
          {
            patientId: testPatient._id.toString(),
            items: updated.items,
            discountPercent: 20, // 20% of 400000 = 80000
            version: 2,
          },
          doctorActor
        );
        expect(updatedWithPercent.discount).toBe(80000);
        expect(updatedWithPercent.total).toBe(320000);

        // Version conflict check
        await expect(
          updateEstimateDraft(
            clinicId,
            draft._id,
            {
              patientId: testPatient._id.toString(),
              items: updated.items,
              discount: 0,
              version: 1, // Stale!
            },
            doctorActor
          )
        ).rejects.toThrow(/Conflict: Estimate was modified/);

        // Discount exceeds subtotal error
        await expect(
          updateEstimateDraft(
            clinicId,
            draft._id,
            {
              patientId: testPatient._id.toString(),
              items: updated.items,
              discount: 500000, // > 400000
              version: 3,
            },
            doctorActor
          )
        ).rejects.toThrow(/Discount cannot exceed the subtotal/);

        // Estimate not found error
        await expect(
          updateEstimateDraft(
            clinicId,
            new Types.ObjectId(),
            {
              patientId: testPatient._id.toString(),
              items: updated.items,
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Estimate not found/);

        // List estimates with filters
        const allEstimates = await listEstimates(clinicId);
        expect(allEstimates.length).toBeGreaterThan(0);

        const patientEstimates = await listEstimates(clinicId, {
          patientId: testPatient._id.toString(),
          status: 'DRAFT',
        });
        expect(patientEstimates.length).toBeGreaterThan(0);

        // Cancel estimate edge cases
        await expect(cancelEstimate(clinicId, draft._id, '', doctorActor)).rejects.toThrow(
          /A reason is required/
        );
        await expect(
          cancelEstimate(clinicId, new Types.ObjectId(), 'Reason', doctorActor)
        ).rejects.toThrow(/Estimate not found/);

        const cancelled = await cancelEstimate(clinicId, draft._id, 'Patient deferred', doctorActor);
        expect(cancelled.status).toBe('CANCELLED');
        expect(cancelled.cancelReason).toBe('Patient deferred');

        // Cannot cancel cancelled estimate
        await expect(
          cancelEstimate(clinicId, draft._id, 'Another reason', doctorActor)
        ).rejects.toThrow(/Cannot cancel estimate with status CANCELLED/);

        // Cannot update non-DRAFT estimate
        await expect(
          updateEstimateDraft(
            clinicId,
            draft._id,
            {
              patientId: testPatient._id.toString(),
              items: updated.items,
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Cannot edit estimate in status CANCELLED/);

        // Cannot issue cancelled estimate
        await expect(issueEstimate(clinicId, draft._id, doctorActor)).rejects.toThrow(
          /Cannot issue estimate with status CANCELLED/
        );

        // Record print not found
        await expect(
          recordEstimatePrint(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Estimate not found/);

        // createEstimateDraft with discount > subtotal throws
        await expect(
          createEstimateDraft(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              items: [{ description: 'Over discount', qty: 1, unitPrice: 1000, amount: 1000 }],
              discount: 5000,
            },
            doctorActor
          )
        ).rejects.toThrow(/Discount cannot exceed the subtotal/);

        // createEstimateDraft with all fields (treatmentId, visitId, replacesEstimateId, notes)
        const sampleTreatment: any = await Treatment.create({
          clinicId,
          code: 'COV-TRT-001',
          name: 'Composite Fill',
          category: 'RESTORATIVE',
          unit: 'per tooth',
          idaMin: 1000,
          clinicPrice: 150000,
          active: true,
          createdBy: doctorActor,
        });

        const draftWithAll = await createEstimateDraft(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            visitId: testVisit._id.toString(),
            replacesEstimateId: draft._id.toString(),
            items: [
              {
                treatmentId: sampleTreatment._id.toString(),
                description: 'Full spec line',
                teeth: [14],
                qty: 1,
                listPrice: 150000,
                unitPrice: 150000,
                amount: 150000,
              },
            ],
            discount: 0,
            notes: 'Detailed notes on treatment',
          },
          doctorActor
        );
        expect(draftWithAll.visitId).toBeDefined();
        expect(draftWithAll.replacesEstimateId).toBeDefined();
        expect(draftWithAll.notes).toBe('Detailed notes on treatment');

        // Concurrent race on updateEstimateDraft
        const freshDraft = await createEstimateDraft(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [{ description: 'Draft for race', qty: 1, unitPrice: 1000, amount: 1000 }],
            discount: 0,
          },
          doctorActor
        );
        // Interleaved modification simulation where findOneAndUpdate returns null
        const findOneAndUpdateSpy = vi.spyOn(Estimate, 'findOneAndUpdate').mockResolvedValueOnce(null as any);
        await expect(
          updateEstimateDraft(
            clinicId,
            freshDraft._id,
            {
              patientId: testPatient._id.toString(),
              items: [{ description: 'Draft for race modified', qty: 1, unitPrice: 1000, amount: 1000 }],
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Conflict: Another session modified this estimate simultaneously/);
        findOneAndUpdateSpy.mockRestore();

        // issueEstimate with non-existent estimate throws
        await expect(
          issueEstimate(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Estimate not found/);

        // getEstimate and listEstimates individual filters
        const fetchedEstimate = await getEstimate(clinicId, freshDraft._id);
        expect(fetchedEstimate?._id.toString()).toBe(freshDraft._id.toString());
        const nonExistentEstimate = await getEstimate(clinicId, new Types.ObjectId());
        expect(nonExistentEstimate).toBeNull();

        const onlyPatientEstimates = await listEstimates(clinicId, { patientId: testPatient._id.toString() });
        expect(onlyPatientEstimates.length).toBeGreaterThan(0);
        const onlyDraftEstimates = await listEstimates(clinicId, { status: 'DRAFT' });
        expect(onlyDraftEstimates.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Bill Service Edge Cases', () => {
    it('creates bill, updates draft, checks edit locks and cancellation rules', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Dental Checkup',
                teeth: [],
                qty: 1,
                unitPrice: 50000,
                amount: 50000,
              },
            ],
            discount: 5000,
          },
          doctorActor
        );

        expect(bill.status).toBe('UNPAID');
        expect(bill.total).toBe(45000);

        // Update bill draft
        const updatedBill = await updateBillDraft(
          clinicId,
          bill._id,
          {
            version: 1,
            items: [
              {
                description: 'Dental Checkup & Polish',
                teeth: [],
                qty: 1,
                unitPrice: 80000,
                amount: 80000,
              },
            ],
            discountPercent: 10, // 8000
          },
          doctorActor
        );

        expect(updatedBill.subtotal).toBe(80000);
        expect(updatedBill.discount).toBe(8000);
        expect(updatedBill.total).toBe(72000);
        expect(updatedBill.version).toBe(2);

        // Version conflict check
        await expect(
          updateBillDraft(
            clinicId,
            bill._id,
            {
              version: 1, // Stale!
              items: updatedBill.items,
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Conflict: The bill was modified by another session/);

        // Discount exceeds subtotal error
        await expect(
          updateBillDraft(
            clinicId,
            bill._id,
            {
              version: 2,
              items: updatedBill.items,
              discount: 90000, // > 80000
            },
            doctorActor
          )
        ).rejects.toThrow(/Discount cannot exceed the subtotal/);

        // Bill not found error
        await expect(
          updateBillDraft(
            clinicId,
            new Types.ObjectId(),
            {
              version: 1,
              items: updatedBill.items,
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Bill not found/);

        // Record print
        const printed = await recordBillPrint(clinicId, bill._id, doctorActor);
        expect(printed.printCount).toBe(1);

        await expect(
          recordBillPrint(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Bill not found/);

        // List bills with filters
        const allBills = await listBills(clinicId);
        expect(allBills.length).toBeGreaterThan(0);

        const filteredBills = await listBills(clinicId, {
          patientId: testPatient._id.toString(),
          status: 'UNPAID',
        });
        expect(filteredBills.length).toBeGreaterThan(0);

        // Get bill
        const billData = await getBill(clinicId, bill._id);
        expect(billData).not.toBeNull();
        expect(billData?.bill._id.toString()).toBe(bill._id.toString());
        expect(billData?.payments).toHaveLength(0);

        const nullBill = await getBill(clinicId, new Types.ObjectId());
        expect(nullBill).toBeNull();

        // Cancel bill edge cases
        await expect(cancelBill(clinicId, bill._id, '', doctorActor)).rejects.toThrow(
          /A reason is required to cancel a bill/
        );
        await expect(
          cancelBill(clinicId, new Types.ObjectId(), 'Reason', doctorActor)
        ).rejects.toThrow(/Bill not found/);

        // Successful cancel
        const cancelledBill = await cancelBill(clinicId, bill._id, 'Billing error corrected', doctorActor);
        expect(cancelledBill.status).toBe('CANCELLED');
        expect(cancelledBill.activeForVisit).toBe(false);

        // Cannot update cancelled bill
        await expect(
          updateBillDraft(
            clinicId,
            bill._id,
            {
              version: 3,
              items: updatedBill.items,
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Bill cannot be edited once payments have been received or after cancellation/);
      });
    });
  });

  describe('Payment Service Edge Cases', () => {
    it('exercises payment errors, reversal validations, and receipt reprint', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Root Canal Obturation',
                teeth: [36],
                qty: 1,
                unitPrice: 300000,
                amount: 300000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        // Bill not found
        await expect(
          recordPayment(
            clinicId,
            {
              billId: new Types.ObjectId().toString(),
              amount: 100000,
              method: 'CASH',
            },
            doctorActor
          )
        ).rejects.toThrow(/Bill not found/);

        // Record valid payment
        const { payment } = await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 150000,
            method: 'CASH',
          },
          doctorActor
        );
        expect(payment.receiptNo).toMatch(/REC\/\d{4}-\d{2}\/\d{4}$/);

        // Record receipt print
        const printedRec = await recordReceiptPrint(clinicId, payment._id, doctorActor);
        expect(printedRec._id.toString()).toBe(payment._id.toString());

        await expect(
          recordReceiptPrint(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Payment not found/);

        // Reverse payment validations
        await expect(
          reversePayment(clinicId, payment._id, '', doctorActor)
        ).rejects.toThrow(/A reason is required to reverse a payment/);

        await expect(
          reversePayment(clinicId, new Types.ObjectId(), 'Reason', doctorActor)
        ).rejects.toThrow(/Payment not found/);

        // Reversal success
        const { reversalPayment, billBalance } = await reversePayment(
          clinicId,
          payment._id,
          'Wrong patient charged',
          doctorActor
        );
        expect(reversalPayment.isReversal).toBe(true);
        expect(billBalance).toBe(300000);

        // Cannot reverse already reversed payment
        await expect(
          reversePayment(clinicId, payment._id, 'Duplicate reversal', doctorActor)
        ).rejects.toThrow(/has already been reversed/);

        // Cannot reverse the reversal payment itself
        await expect(
          reversePayment(clinicId, reversalPayment._id, 'Reverse reversal', doctorActor)
        ).rejects.toThrow(/already a reversal/);

        // Collections for day with explicit date string
        const dayCollections = await collectionsForDay(clinicId, '2026-10-25');
        expect(dayCollections).toBeDefined();
        expect(typeof dayCollections.netTotal).toBe('number');

        // Idempotency key replay test
        const { payment: idempPayment1, billBalance: bBal1 } = await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 50000,
            method: 'CASH',
            idempotencyKey: 'test-idemp-key-coverage',
            receivedAt: new Date('2026-10-24T12:00:00Z'),
          },
          doctorActor
        );
        expect(idempPayment1.idempotencyKey).toBe('test-idemp-key-coverage');
        expect(idempPayment1.receivedAt).toEqual(new Date('2026-10-24T12:00:00Z'));

        // Replay with exact same idempotency key returns existing payment
        const { payment: idempPayment2, billBalance: bBal2 } = await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 50000,
            method: 'CASH',
            idempotencyKey: 'test-idemp-key-coverage',
          },
          doctorActor
        );
        expect(idempPayment2._id.toString()).toBe(idempPayment1._id.toString());
        expect(bBal2).toBe(bBal1);

        // Record payment for cancelled bill throws
        const { bill: cancelledBill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [{ description: 'Item for cancelled bill', qty: 1, unitPrice: 1000, amount: 1000 }],
            discount: 0,
          },
          doctorActor
        );
        await cancelBill(clinicId, cancelledBill._id, 'Billing error cancellation', doctorActor);

        await expect(
          recordPayment(
            clinicId,
            {
              billId: cancelledBill._id.toString(),
              amount: 500,
              method: 'CASH',
            },
            doctorActor
          )
        ).rejects.toThrow(/Cannot record payment for a cancelled bill/);

        // Reverse payment when payment's bill cannot be found throws
        const orphanedPayment = await Payment.create({
          clinicId,
          billId: new Types.ObjectId(),
          receiptNo: 'REC/2026-27/9998',
          amount: 1000,
          method: 'CASH',
          isReversal: false,
          receivedAt: clock.now(),
          snapshot: {
            clinic: { name: 'C', address: 'A', phone: 'P', email: 'E', registrationNo: 'R' },
            patient: { name: 'P', patientCode: 'PC', ageYears: 20, sex: 'Male', phone: '123' },
            billNo: 'BILL/2026-27/9998',
            receiptNo: 'REC/2026-27/9998',
            date: '2026-10-25',
            method: 'CASH',
            amount: 1000,
            amountInWords: 'One Thousand Rupees',
            balanceAfterPayment: 0,
          },
          createdBy: doctorActor,
        });

        await expect(
          reversePayment(clinicId, orphanedPayment._id, 'Orphaned reversal test', doctorActor)
        ).rejects.toThrow(/Bill not found for payment/);

        // Reverse payment when bill status is CANCELLED throws
        const { payment: paymentOnBillToCancel } = await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 10000,
            method: 'CASH',
          },
          doctorActor
        );
        await Bill.updateOne({ _id: bill._id }, { $set: { status: 'CANCELLED' } });
        await expect(
          reversePayment(clinicId, paymentOnBillToCancel._id, 'Reversal on cancelled bill', doctorActor)
        ).rejects.toThrow(/Cannot reverse payment on a cancelled bill/);
        // Restore bill status
        await Bill.updateOne({ _id: bill._id }, { $set: { status: 'PARTIAL' } });
      });
    });
  });

  describe('EstimateToBill Edge Cases', () => {
    it('rejects non-existent or un-issued estimates and supports conversion with initialPayment', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // Non-existent estimate
        await expect(
          convertEstimateToBill(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Estimate not found/);

        // Draft estimate
        const draft = await createEstimateDraft(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Crown Prep',
                teeth: [11],
                qty: 1,
                unitPrice: 500000,
                amount: 500000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );

        await expect(
          convertEstimateToBill(clinicId, draft._id, doctorActor)
        ).rejects.toThrow(/Cannot convert estimate with status DRAFT/);

        // Issue estimate
        const issued = await issueEstimate(clinicId, draft._id, doctorActor);

        // Convert with initial payment
        const { bill, payment } = await convertEstimateToBill(
          clinicId,
          issued._id,
          doctorActor,
          {
            amount: 200000,
            method: 'UPI',
          }
        );

        expect(bill.status).toBe('PARTIAL');
        expect(bill.paid).toBe(200000);
        expect(bill.balance).toBe(300000);
        expect(payment?.receiptNo).toMatch(/REC\/\d{4}-\d{2}\/\d{4}$/);
      });
    });

    it('covers converter item defaults without teeth and without discount', () => {
      const converted = convertEstimateItemsToBillItems({
        items: [{ description: 'Basic Item', qty: 1, unitPrice: 500, amount: 500 }],
        total: 500,
      } as any);
      expect(converted.items[0].teeth).toEqual([]);
      expect(converted.discount).toBe(0);

      const empty = convertEstimateItemsToBillItems({
        items: undefined as any,
        total: 0,
      } as any);
      expect(empty.items).toEqual([]);
      expect(empty.discount).toBe(0);
    });
  });

  describe('Bill State Machine & Recompute Coverage', () => {
    it('exercises BillStateTransitionError and canTransitionBill branches', () => {
      const err = new BillStateTransitionError('Test bill transition error');
      expect(err.statusCode).toBe(409);
      expect(err.name).toBe('BillStateTransitionError');
      expect(err.message).toBe('Test bill transition error');

      expect(canTransitionBill('UNPAID', 'CANCEL', 0)).toBe(true);
      expect(canTransitionBill('UNPAID', 'CANCEL', 500)).toBe(false);
      expect(canTransitionBill('CANCELLED', 'CANCEL', 0)).toBe(false);
      expect(canTransitionBill('UNPAID', 'OTHER' as any, 0)).toBe(false);
    });

    it('exercises applyBillRecompute locals initialization and cancellation', () => {
      const doc: any = { total: 10000 };
      const res = applyBillRecompute(doc, [], true);
      expect(res.status).toBe('CANCELLED');
      expect(doc.$locals.allowBillFinancialUpdate).toBe(true);

      const docWithLocals: any = { total: 10000, $locals: {} };
      const res2 = applyBillRecompute(docWithLocals, [{ amount: 10000 as any }]);
      expect(res2.status).toBe('PAID');
    });
  });

  describe('Service Edge-Case Invariants & Error Branches', () => {
    it('exercises estimate service discount exceeding subtotal and version conflict', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // Discount exceeding subtotal
        await expect(
          createEstimateDraft(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              items: [{ description: 'Test', teeth: [], qty: 1, unitPrice: 1000, amount: 1000 }],
              discount: 5000,
            },
            doctorActor
          )
        ).rejects.toThrow(/Discount cannot exceed the subtotal/);

        // Issue non-existent estimate
        await expect(
          issueEstimate(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Estimate not found/);

        // Record print on non-existent estimate
        await expect(
          recordEstimatePrint(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Estimate not found/);

        // List estimates with both patientId and status filter
        const estimates = await listEstimates(clinicId, {
          patientId: testPatient._id.toString(),
          status: 'ISSUED',
        });
        expect(Array.isArray(estimates)).toBe(true);

        // Create draft and trigger version conflict on update
        const draft = await createEstimateDraft(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [{ description: 'Test Version Conflict', teeth: [], qty: 1, unitPrice: 2000, amount: 2000 }],
            discount: 0,
          },
          doctorActor
        );

        await expect(
          updateEstimateDraft(
            clinicId,
            draft._id,
            {
              patientId: testPatient._id.toString(),
              items: [{ description: 'Modified', teeth: [], qty: 1, unitPrice: 2000, amount: 2000 }],
              discount: 0,
              version: 999, // wrong version
            },
            doctorActor
          )
        ).rejects.toThrow(/Conflict: Estimate was modified/);
      });
    });

    it('exercises bill service cancellation rejection with payments, missing id, and filter by visitId', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // Create bill with initial payment
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            visitId: testVisit._id.toString(),
            items: [{ description: 'Bill with Payment', teeth: [], qty: 1, unitPrice: 5000, amount: 5000 }],
            discount: 0,
            initialPayment: { amount: 5000, method: 'CASH' },
          },
          doctorActor
        );

        // Attempt to cancel bill with recorded payment
        await expect(
          cancelBill(clinicId, bill._id, 'Attempt cancel paid bill', doctorActor)
        ).rejects.toThrow(/Cannot cancel bill with recorded payments/);

        // List bills with visitId filter
        const billsByVisit = await listBills(clinicId, { visitId: testVisit._id.toString() });
        expect(billsByVisit.length).toBeGreaterThan(0);

        // Print non-existent bill
        await expect(
          recordBillPrint(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Bill not found/);

        // Update non-existent bill
        await expect(
          updateBillDraft(
            clinicId,
            new Types.ObjectId(),
            {
              items: [{ description: 'Ghost', teeth: [], qty: 1, unitPrice: 100, amount: 100 }],
              discount: 0,
              version: 1,
            },
            doctorActor
          )
        ).rejects.toThrow(/Bill not found/);
      });
    });

    it('exercises payment service edge-cases: empty reason, cancelled bill, non-existent payment, print missing receipt', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // Reverse without reason
        await expect(
          reversePayment(clinicId, new Types.ObjectId(), '   ', doctorActor)
        ).rejects.toThrow(/A reason is required to reverse a payment/);

        // Reverse non-existent payment
        await expect(
          reversePayment(clinicId, new Types.ObjectId(), 'Valid Reason', doctorActor)
        ).rejects.toThrow(/Payment not found/);

        // Print non-existent receipt
        await expect(
          recordReceiptPrint(clinicId, new Types.ObjectId(), doctorActor)
        ).rejects.toThrow(/Payment not found/);

        // Create a bill, make a payment, cancel the bill in DB, then attempt reversal
        const { bill } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [{ description: 'Item for Cancelled Bill Test', teeth: [], qty: 1, unitPrice: 10000, amount: 10000 }],
            discount: 0,
          },
          doctorActor
        );

        const { payment } = await recordPayment(
          clinicId,
          {
            billId: bill._id.toString(),
            amount: 10000,
            method: 'CASH',
          },
          doctorActor
        );

        // Force bill to CANCELLED directly in DB to test reversal guard on cancelled bill
        await Bill.updateOne({ _id: bill._id }, { $set: { status: 'CANCELLED' } });

        await expect(
          reversePayment(clinicId, payment._id, 'Reversal on cancelled bill', doctorActor)
        ).rejects.toThrow(/Cannot reverse payment on a cancelled bill/);

        // Attempt to record payment on a cancelled bill
        await expect(
          recordPayment(
            clinicId,
            {
              billId: bill._id.toString(),
              amount: 5000,
              method: 'CASH',
            },
            doctorActor
          )
        ).rejects.toThrow(/Cannot record payment for a cancelled bill/);

        // Mid-payment failure injection
        const { bill: bill2 } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [{ description: 'Item for Mid-payment Injected Failure', teeth: [], qty: 1, unitPrice: 10000, amount: 10000 }],
            discount: 0,
          },
          doctorActor
        );

        await expect(
          recordPayment(
            clinicId,
            {
              billId: bill2._id.toString(),
              amount: 5000,
              method: 'CASH',
              _injectFailureMidPayment: true,
            },
            doctorActor
          )
        ).rejects.toThrow(/INJECTED_FAILURE_MID_PAYMENT/);

        // Cancel bill without reason throws
        await expect(
          cancelBill(clinicId, bill2._id, '  ', doctorActor)
        ).rejects.toThrow(/A reason is required to cancel a bill/);

        // Create bill with initialPayment exceeding total
        await expect(
          createBill(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              items: [{ description: 'Overpayment test', teeth: [], qty: 1, unitPrice: 1000, amount: 1000 }],
              discount: 0,
              initialPayment: { amount: 5000, method: 'CASH' },
            },
            doctorActor
          )
        ).rejects.toThrow(/Payment amount cannot exceed total bill balance/);

        // Create bill with price override (listPrice !== unitPrice) to exercise PRICE_OVERRIDE audit log
        const { bill: billWithOverride } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [
              {
                description: 'Procedure with Doctor Discount Override',
                teeth: [16],
                qty: 1,
                listPrice: 50000,
                unitPrice: 40000,
                amount: 40000,
              },
            ],
            discount: 0,
          },
          doctorActor
        );
        expect(billWithOverride.items[0].listPrice).toBe(50000);
        expect(billWithOverride.items[0].unitPrice).toBe(40000);

        // Create bill referencing non-existent estimate
        await expect(
          createBill(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              estimateId: new Types.ObjectId().toString(),
              items: [{ description: 'Estimate test', teeth: [], qty: 1, unitPrice: 1000, amount: 1000 }],
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Estimate not found/);

        // Create bill referencing unissued estimate
        const unissuedDraft = await createEstimateDraft(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [{ description: 'Draft only', teeth: [], qty: 1, unitPrice: 1000, amount: 1000 }],
            discount: 0,
          },
          doctorActor
        );
        await expect(
          createBill(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              estimateId: unissuedDraft._id.toString(),
              items: [{ description: 'Draft reference', teeth: [], qty: 1, unitPrice: 1000, amount: 1000 }],
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Cannot convert estimate with status DRAFT/);

        // Create bill with discountPercent
        const { bill: billWithPercent } = await createBill(
          clinicId,
          {
            patientId: testPatient._id.toString(),
            items: [{ description: 'Percent Discount Test', teeth: [], qty: 1, unitPrice: 10000, amount: 10000 }],
            discount: 0,
            discountPercent: 10,
          },
          doctorActor
        );
        expect(billWithPercent.subtotal).toBe(10000);
        expect(billWithPercent.discount).toBe(1000);
        expect(billWithPercent.total).toBe(9000);

        // Create bill with discount > subtotal throws
        await expect(
          createBill(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              items: [{ description: 'High Discount Test', teeth: [], qty: 1, unitPrice: 1000, amount: 1000 }],
              discount: 5000,
            },
            doctorActor
          )
        ).rejects.toThrow(/Discount cannot exceed the subtotal/);

        // collectionsForDay without date parameter defaults to today
        const defaultDayCollections = await collectionsForDay(clinicId);
        expect(defaultDayCollections).toHaveProperty('cash');
        expect(defaultDayCollections).toHaveProperty('upi');
        expect(defaultDayCollections).toHaveProperty('netTotal');

        // Converting expired estimate throws
        const expiredEstimate = await Estimate.create({
          clinicId,
          patientId: testPatient._id,
          estimateNo: 'EST/2026-27/9999',
          items: [{ description: 'Old Expired Estimate', teeth: [], qty: 1, unitPrice: 1000, amount: 1000 }],
          subtotal: 1000,
          discount: 0,
          total: 1000,
          validUntil: '2020-01-01',
          status: 'ISSUED',
          version: 1,
          createdBy: doctorActor,
        });

        await expect(
          createBill(
            clinicId,
            {
              patientId: testPatient._id.toString(),
              estimateId: expiredEstimate._id.toString(),
              items: [{ description: 'Old Expired Estimate', teeth: [], qty: 1, unitPrice: 1000, amount: 1000 }],
              discount: 0,
            },
            doctorActor
          )
        ).rejects.toThrow(/Cannot convert estimate: estimate expired/);
      });
    });
  });
});
