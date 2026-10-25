import mongoose, { Types, ClientSession } from 'mongoose';
import { z } from 'zod';
import { Bill, IBill, IBillItem } from '../models/Bill';
import { Payment, IPayment } from '../models/Payment';
import { Estimate } from '../models/Estimate';
import { Visit } from '../models/Visit';
import { Clinic } from '../models/Clinic';
import { Patient } from '../models/Patient';
import { User } from '../models/User';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { withTransaction, nextBillNo, nextReceiptNo } from './counters';
import { isValidFdiTooth } from './fdi-tooth';
import { clock } from './clock';
import { clinicDate } from './date';
import { TenantActor } from './tenancy';
import { asPaise, applyPercentDiscount, amountInWordsINR } from './money';
import { applyBillRecompute } from './billing';
import { canEditBill, canCancelBill } from './bill-state-machine';
import { isEstimateExpired } from './estimate-state-machine';

export const BillLineInputSchema = z.object({
  treatmentId: z.union([z.string(), z.instanceof(Types.ObjectId)]).optional(),
  description: z.string().trim().min(1, 'Description is required').max(500),
  teeth: z
    .array(z.number().int())
    .refine((arr) => !arr || arr.every(isValidFdiTooth), {
      message: 'All tooth numbers must be valid FDI two-digit teeth (11-48, 51-85)',
    })
    .optional()
    .default([]),
  qty: z.number().int().min(1).max(99),
  listPrice: z.number().int().nonnegative().optional(),
  unitPrice: z.number().int().nonnegative(),
  amount: z.number().int().nonnegative(),
});

export const CreateBillInputSchema = z.object({
  patientId: z.string().min(1, 'Patient ID is required'),
  visitId: z.string().optional(),
  estimateId: z.string().optional(),
  items: z.array(BillLineInputSchema).min(1, 'Bill must have at least one line item'),
  discount: z.number().int().nonnegative().default(0),
  discountPercent: z.number().min(0).max(100).optional(),
  initialPayment: z
    .object({
      amount: z.number().int().positive('Payment amount must be greater than 0'),
      method: z.enum(['CASH', 'UPI']),
      upiRef: z.string().max(100).optional(),
      idempotencyKey: z.string().optional(),
    })
    .optional(),
  // For failure injection testing (D1)
  _injectFailureAfterBill: z.boolean().optional(),
});

export type CreateBillInput = z.input<typeof CreateBillInputSchema>;

export const UpdateBillInputSchema = z.object({
  version: z.number().int().min(1, 'Version is required for optimistic concurrency check'),
  items: z.array(BillLineInputSchema).min(1, 'Bill must have at least one line item'),
  discount: z.number().int().nonnegative().default(0),
  discountPercent: z.number().min(0).max(100).optional(),
});

export type UpdateBillInput = z.input<typeof UpdateBillInputSchema>;

export async function createBill(
  clinicId: Types.ObjectId | string,
  input: CreateBillInput,
  actor: TenantActor
): Promise<{ bill: IBill; payment?: IPayment }> {
  const validated = CreateBillInputSchema.parse(input);
  const clinicObjectId = new Types.ObjectId(clinicId);
  const patientObjectId = new Types.ObjectId(validated.patientId);
  const visitObjectId = validated.visitId ? new Types.ObjectId(validated.visitId) : undefined;
  const estimateObjectId = validated.estimateId ? new Types.ObjectId(validated.estimateId) : undefined;

  return withTransaction(async (session) => {
    // 1. If estimateId provided, atomically verify and convert estimate
    if (estimateObjectId) {
      const estimate = await Estimate.findOne({
        clinicId: clinicObjectId,
        _id: estimateObjectId,
      }).session(session);

      if (!estimate) {
        throw new Error(`Estimate not found: ${validated.estimateId}`);
      }

      if (estimate.status !== 'ISSUED') {
        const err: any = new Error(
          `Cannot convert estimate with status ${estimate.status}. Only ISSUED estimates can be converted.`
        );
        err.statusCode = 409;
        throw err;
      }

      if (isEstimateExpired(estimate.validUntil, clock.now())) {
        const err: any = new Error(
          `Cannot convert estimate: estimate expired on ${estimate.validUntil}.`
        );
        err.statusCode = 409;
        throw err;
      }
    }

    // 2. If visitId provided, check if active bill already exists
    if (visitObjectId) {
      const existingActiveBill = await Bill.findOne({
        clinicId: clinicObjectId,
        visitId: visitObjectId,
        activeForVisit: true,
      }).session(session);

      if (existingActiveBill) {
        const err: any = new Error(
          `Conflict: Visit ${validated.visitId} already has an active bill (${existingActiveBill.billNo}). Only one active bill per visit is permitted.`
        );
        err.statusCode = 409;
        throw err;
      }
    }

    // 3. Compute items and totals
    const priceOverrides: Array<{ lineIndex: number; listPrice: number; unitPrice: number }> = [];
    const items: IBillItem[] = validated.items.map((it, idx) => {
      const calcAmount = it.qty * it.unitPrice;
      if (it.listPrice !== undefined && it.listPrice !== it.unitPrice) {
        priceOverrides.push({ lineIndex: idx, listPrice: it.listPrice, unitPrice: it.unitPrice });
      }
      return {
        treatmentId: it.treatmentId ? new Types.ObjectId(it.treatmentId) : undefined,
        description: it.description,
        teeth: it.teeth,
        qty: it.qty,
        listPrice: it.listPrice ?? it.unitPrice,
        unitPrice: it.unitPrice,
        amount: calcAmount,
      };
    });

    const subtotal = items.reduce((sum, it) => sum + it.amount, 0);

    let discount = validated.discount;
    if (validated.discountPercent !== undefined && validated.discountPercent > 0) {
      const computed = applyPercentDiscount(asPaise(subtotal), validated.discountPercent);
      discount = computed.discount;
    }

    if (discount > subtotal) {
      throw new Error('Discount cannot exceed the subtotal');
    }

    const total = subtotal - discount;

    // 4. Allocate gapless bill number
    const billNo = await nextBillNo(clinicObjectId, session, clock.now());

    // 5. Build Bill document
    const bill = new Bill({
      clinicId: clinicObjectId,
      billNo,
      patientId: patientObjectId,
      visitId: visitObjectId,
      estimateId: estimateObjectId,
      items,
      subtotal,
      discount,
      total,
      paid: 0,
      balance: total,
      status: 'UNPAID',
      activeForVisit: Boolean(visitObjectId),
      version: 1,
      printCount: 0,
      createdBy: actor,
    });

    applyBillRecompute(bill, [], false);
    await bill.save({ session });

    // Mark estimate as CONVERTED inside same transaction
    if (estimateObjectId) {
      const convertedEstimate = await Estimate.findOneAndUpdate(
        { clinicId: clinicObjectId, _id: estimateObjectId, status: 'ISSUED' },
        { $set: { status: 'CONVERTED', convertedToBillId: bill._id }, $inc: { version: 1 } },
        { session, returnDocument: 'after' }
      );

      if (!convertedEstimate) {
        const err: any = new Error(
          'Conflict: Estimate was already converted or modified by another session.'
        );
        err.statusCode = 409;
        throw err;
      }
    }

    // 6. Optional Failure Injection for D1 verification
    if (validated._injectFailureAfterBill) {
      throw new Error('INJECTED_FAILURE_AFTER_BILL_WRITE: verifying atomic rollback of Bill and Counter');
    }

    // 7. Initial payment if provided
    let paymentDoc: IPayment | undefined;
    if (validated.initialPayment) {
      const pInput = validated.initialPayment;
      if (pInput.amount > total) {
        const err: any = new Error('Payment amount cannot exceed total bill balance');
        err.statusCode = 422;
        throw err;
      }

      const receiptNo = await nextReceiptNo(clinicObjectId, session, clock.now());

      // Fetch snapshot data
      const clinic = await Clinic.findById(clinicObjectId).session(session);
      if (!clinic) throw new Error(`Clinic not found: ${clinicObjectId}`);
      const patient = await Patient.findById(patientObjectId).session(session);
      if (!patient) throw new Error(`Patient not found: ${patientObjectId}`);

      const snapshot = {
        clinic: {
          name: clinic.name,
          address: clinic.address,
          phone: clinic.phone,
          email: clinic.email,
          registrationNo: clinic.registrationNo,
        },
        patient: {
          name: patient.name,
          patientCode: patient.patientCode,
          ageYears: patient.ageYears,
          sex: patient.sex,
          phone: patient.phone,
        },
        billNo: bill.billNo,
        receiptNo,
        date: clinicDate(clock.now()),
        method: pInput.method,
        upiRef: pInput.upiRef,
        amount: pInput.amount,
        amountInWords: amountInWordsINR(asPaise(pInput.amount)),
        balanceAfterPayment: total - pInput.amount,
      };

      const [newPayment] = await Payment.create(
        [
          {
            clinicId: clinicObjectId,
            billId: bill._id,
            receiptNo,
            amount: pInput.amount,
            method: pInput.method,
            upiRef: pInput.upiRef,
            isReversal: false,
            idempotencyKey: pInput.idempotencyKey,
            snapshot,
            printCount: 0,
            receivedAt: clock.now(),
            createdBy: actor,
          },
        ],
        { session }
      );
      paymentDoc = newPayment;

      applyBillRecompute(bill, [{ amount: asPaise(pInput.amount), method: pInput.method }], false);
      await bill.save({ session });

      await AuditLog.create(
        [
          {
            clinicId: clinicObjectId,
            action: AuditAction.PAYMENT_CREATE,
            entity: 'Payment',
            entityId: paymentDoc._id.toString(),
            actor,
            meta: {
              billId: bill._id.toString(),
              receiptNo,
              method: pInput.method,
            },
            at: clock.now(),
            createdBy: actor,
          },
        ],
        { session }
      );
    }

    // Audit Log for BILL_CREATE
    await AuditLog.create(
      [
        {
          clinicId: clinicObjectId,
          action: AuditAction.BILL_CREATE,
          entity: 'Bill',
          entityId: bill._id.toString(),
          actor,
          meta: {
            billNo,
            patientId: patientObjectId.toString(),
            visitId: visitObjectId?.toString(),
            estimateId: estimateObjectId?.toString(),
            hasInitialPayment: Boolean(validated.initialPayment),
          },
          at: clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    // Audit Log for PRICE_OVERRIDE if any
    for (const po of priceOverrides) {
      await AuditLog.create(
        [
          {
            clinicId: clinicObjectId,
            action: AuditAction.PRICE_OVERRIDE,
            entity: 'Bill',
            entityId: bill._id.toString(),
            actor,
            meta: {
              lineIndex: po.lineIndex,
              fieldsChanged: ['unitPrice'],
            },
            at: clock.now(),
            createdBy: actor,
          },
        ],
        { session }
      );
    }

    return { bill, payment: paymentDoc };
  });
}

export async function updateBillDraft(
  clinicId: Types.ObjectId | string,
  billId: Types.ObjectId | string,
  input: UpdateBillInput,
  actor: TenantActor
): Promise<IBill> {
  const validated = UpdateBillInputSchema.parse(input);
  const clinicObjectId = new Types.ObjectId(clinicId);
  const billObjectId = new Types.ObjectId(billId);

  const existing = await Bill.findOne({ clinicId: clinicObjectId, _id: billObjectId });
  if (!existing) {
    throw new Error(`Bill not found: ${billId}`);
  }

  // Edit lock: allowed ONLY if net paid is 0 and bill is not cancelled
  if (!canEditBill(existing)) {
    const err: any = new Error(
      'Conflict: Bill cannot be edited once payments have been received or after cancellation.'
    );
    err.statusCode = 409;
    throw err;
  }

  // Version check
  if (existing.version !== validated.version) {
    const err: any = new Error(
      `Conflict: The bill was modified by another session (v${existing.version}). Your edit was based on v${validated.version}.`
    );
    err.statusCode = 409;
    throw err;
  }

  const items: IBillItem[] = validated.items.map((it) => {
    const calcAmount = it.qty * it.unitPrice;
    return {
      treatmentId: it.treatmentId ? new Types.ObjectId(it.treatmentId) : undefined,
      description: it.description,
      teeth: it.teeth,
      qty: it.qty,
      listPrice: it.listPrice ?? it.unitPrice,
      unitPrice: it.unitPrice,
      amount: calcAmount,
    };
  });

  const subtotal = items.reduce((sum, it) => sum + it.amount, 0);

  let discount = validated.discount;
  if (validated.discountPercent !== undefined && validated.discountPercent > 0) {
    const computed = applyPercentDiscount(asPaise(subtotal), validated.discountPercent);
    discount = computed.discount;
  }

  if (discount > subtotal) {
    throw new Error('Discount cannot exceed the subtotal');
  }

  const total = subtotal - discount;

  // Recompute with 0 payments
  existing.items = items;
  existing.subtotal = subtotal;
  existing.discount = discount;
  existing.total = total;
  applyBillRecompute(existing, [], false);
  existing.version += 1;
  await existing.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.BILL_UPDATE,
    entity: 'Bill',
    entityId: existing._id.toString(),
    actor,
    meta: {
      billNo: existing.billNo,
      changedFields: ['items', 'subtotal', 'discount', 'total'],
    },
    at: clock.now(),
    createdBy: actor,
  });

  return existing;
}

export async function cancelBill(
  clinicId: Types.ObjectId | string,
  billId: Types.ObjectId | string,
  reason: string,
  actor: TenantActor
): Promise<IBill> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const billObjectId = new Types.ObjectId(billId);

  if (!reason || !reason.trim()) {
    throw new Error('A reason is required to cancel a bill');
  }

  const bill = await Bill.findOne({ clinicId: clinicObjectId, _id: billObjectId });
  if (!bill) {
    throw new Error(`Bill not found: ${billId}`);
  }

  if (!canCancelBill(bill)) {
    const err: any = new Error(
      'Cannot cancel bill with recorded payments. Reverse all payments first.'
    );
    err.statusCode = 409;
    throw err;
  }

  // Cancel bill, set activeForVisit = false to free visit for another bill
  applyBillRecompute(bill, [], true);
  bill.cancelReason = reason.trim();
  bill.activeForVisit = false;
  bill.version += 1;
  await bill.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.BILL_CANCEL,
    entity: 'Bill',
    entityId: bill._id.toString(),
    actor,
    meta: {
      billNo: bill.billNo,
      cancelReason: reason.trim(),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return bill;
}

export async function recordBillPrint(
  clinicId: Types.ObjectId | string,
  billId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IBill> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const billObjectId = new Types.ObjectId(billId);

  const updated = await Bill.findOneAndUpdate(
    { clinicId: clinicObjectId, _id: billObjectId },
    { $inc: { printCount: 1 } },
    { returnDocument: 'after' }
  );

  if (!updated) {
    throw new Error(`Bill not found: ${billId}`);
  }

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.BILL_PRINT,
    entity: 'Bill',
    entityId: updated._id.toString(),
    actor,
    meta: {
      billNo: updated.billNo,
      reprintCount: updated.printCount,
    },
    at: clock.now(),
    createdBy: actor,
  });

  return updated;
}

export async function getBill(
  clinicId: Types.ObjectId | string,
  billId: Types.ObjectId | string
): Promise<{ bill: IBill; payments: IPayment[] } | null> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const billObjectId = new Types.ObjectId(billId);

  const bill = await Bill.findOne({ clinicId: clinicObjectId, _id: billObjectId });
  if (!bill) return null;

  const payments = await Payment.find({ clinicId: clinicObjectId, billId: billObjectId }).sort({
    receivedAt: 1,
  });

  return { bill, payments };
}

export async function listBills(
  clinicId: Types.ObjectId | string,
  filter: { patientId?: string; status?: string; visitId?: string } = {}
): Promise<IBill[]> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const query: Record<string, unknown> = { clinicId: clinicObjectId };

  if (filter.patientId) {
    query.patientId = new Types.ObjectId(filter.patientId);
  }
  if (filter.visitId) {
    query.visitId = new Types.ObjectId(filter.visitId);
  }
  if (filter.status) {
    query.status = filter.status;
  }

  return Bill.find(query).sort({ createdAt: -1 });
}
