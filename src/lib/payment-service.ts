import mongoose, { Types, ClientSession } from 'mongoose';
import { z } from 'zod';
import { Payment, IPayment, PaymentMethod } from '../models/Payment';
import { Bill } from '../models/Bill';
import { Clinic } from '../models/Clinic';
import { Patient } from '../models/Patient';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { withTransaction, nextReceiptNo } from './counters';
import { clock } from './clock';
import { clinicDate, startOfClinicDay, endOfClinicDay } from './date';
import { TenantActor } from './tenancy';
import { asPaise, Paise, addPaise, subtractPaise, amountInWordsINR } from './money';
import { applyBillRecompute, recomputeBill } from './billing';

export const RecordPaymentInputSchema = z.object({
  billId: z.string().min(1, 'Bill ID is required'),
  amount: z.number().int().positive('Payment amount must be greater than 0'),
  method: z.enum(['CASH', 'UPI']),
  upiRef: z.string().max(100).optional(),
  idempotencyKey: z.string().optional(),
  receivedAt: z.date().optional(),
  // For failure injection testing (D5)
  _injectFailureMidPayment: z.boolean().optional(),
});

export type RecordPaymentInput = z.infer<typeof RecordPaymentInputSchema>;

export async function recordPayment(
  clinicId: Types.ObjectId | string,
  input: RecordPaymentInput,
  actor: TenantActor
): Promise<{ payment: IPayment; billBalance: Paise }> {
  const validated = RecordPaymentInputSchema.parse(input);
  const clinicObjectId = new Types.ObjectId(clinicId);
  const billObjectId = new Types.ObjectId(validated.billId);

  return withTransaction(async (session) => {
    // 1. Idempotency check: if key already processed, return existing payment
    if (validated.idempotencyKey) {
      const existing = await Payment.findOne({
        clinicId: clinicObjectId,
        idempotencyKey: validated.idempotencyKey,
      }).session(session);

      if (existing) {
        const bill = (await Bill.findById(billObjectId).session(session))!;
        return { payment: existing, billBalance: asPaise(bill.balance) };
      }
    }

    // 2. Fetch bill and enforce state invariants
    const bill = await Bill.findOne({
      clinicId: clinicObjectId,
      _id: billObjectId,
    }).session(session);

    if (!bill) {
      throw new Error(`Bill not found: ${validated.billId}`);
    }

    if (bill.status === 'CANCELLED') {
      const err: any = new Error('Cannot record payment for a cancelled bill');
      err.statusCode = 409;
      throw err;
    }

    // 3. Query all existing payments for this bill to accurately check remaining balance
    const existingPayments = await Payment.find({
      clinicId: clinicObjectId,
      billId: billObjectId,
    }).session(session);

    const paymentRecords = existingPayments.map((p) => ({
      amount: asPaise(p.amount),
      method: p.method,
      isReversal: p.isReversal,
    }));

    const currentFinancials = recomputeBill(asPaise(bill.total), paymentRecords, false);

    // Overpayment check (D6)
    if (validated.amount > currentFinancials.balance) {
      const err: any = new Error(
        `Payment amount of ₹${validated.amount / 100} exceeds outstanding balance of ₹${currentFinancials.balance / 100}`
      );
      err.statusCode = 422;
      throw err;
    }

    // 4. Allocate gapless receipt number
    const receiptNo = await nextReceiptNo(clinicObjectId, session, clock.now());

    // 5. Build frozen receipt snapshot
    const clinic = (await Clinic.findById(clinicObjectId).session(session))!;
    const patient = (await Patient.findById(bill.patientId).session(session))!;

    const balanceAfter = currentFinancials.balance - validated.amount;

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
      method: validated.method,
      upiRef: validated.upiRef,
      amount: validated.amount,
      amountInWords: amountInWordsINR(asPaise(validated.amount)),
      balanceAfterPayment: balanceAfter,
    };

    // 6. Optional Failure Injection for D5 verification
    if (validated._injectFailureMidPayment) {
      throw new Error('INJECTED_FAILURE_MID_PAYMENT: verifying transaction abort leaves no receipt counter gap');
    }

    // 7. Write append-only Payment
    const [payment] = await Payment.create(
      [
        {
          clinicId: clinicObjectId,
          billId: billObjectId,
          receiptNo,
          amount: validated.amount,
          method: validated.method,
          upiRef: validated.upiRef,
          isReversal: false,
          idempotencyKey: validated.idempotencyKey,
          snapshot,
          printCount: 0,
          receivedAt: validated.receivedAt ? validated.receivedAt : clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    // 8. Recompute bill financial status and increment version
    const updatedPaymentRecords = [
      ...paymentRecords,
      { amount: asPaise(validated.amount), method: validated.method },
    ];
    applyBillRecompute(bill, updatedPaymentRecords, false);
    bill.version += 1;
    await bill.save({ session });

    // 9. Audit Log
    await AuditLog.create(
      [
        {
          clinicId: clinicObjectId,
          action: AuditAction.PAYMENT_CREATE,
          entity: 'Payment',
          entityId: payment._id.toString(),
          actor,
          meta: {
            billId: billObjectId.toString(),
            receiptNo,
            method: validated.method,
          },
          at: clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    return { payment, billBalance: asPaise(bill.balance) };
  });
}

export async function reversePayment(
  clinicId: Types.ObjectId | string,
  paymentId: Types.ObjectId | string,
  reason: string,
  actor: TenantActor
): Promise<{ reversalPayment: IPayment; billBalance: Paise }> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const paymentObjectId = new Types.ObjectId(paymentId);

  if (!reason || !reason.trim()) {
    throw new Error('A reason is required to reverse a payment');
  }

  return withTransaction(async (session) => {
    // 1. Fetch original payment
    const originalPayment = await Payment.findOne({
      clinicId: clinicObjectId,
      _id: paymentObjectId,
    }).session(session);

    if (!originalPayment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    // Invariant: a reversal cannot be reversed
    if (originalPayment.isReversal) {
      const err: any = new Error('Cannot reverse a payment that is already a reversal');
      err.statusCode = 409;
      throw err;
    }

    // Invariant: payment can only be reversed once (enforced at code and DB unique index level)
    const existingReversal = await Payment.findOne({
      clinicId: clinicObjectId,
      reversalOf: paymentObjectId,
    }).session(session);

    if (existingReversal) {
      const err: any = new Error(
        `Conflict: Payment ${originalPayment.receiptNo} has already been reversed by receipt ${existingReversal.receiptNo}`
      );
      err.statusCode = 409;
      throw err;
    }

    // 2. Fetch bill
    const bill = await Bill.findOne({
      clinicId: clinicObjectId,
      _id: originalPayment.billId,
    }).session(session);

    if (!bill) {
      throw new Error(`Bill not found for payment: ${originalPayment.billId}`);
    }

    if (bill.status === 'CANCELLED') {
      const err: any = new Error('Cannot reverse payment on a cancelled bill');
      err.statusCode = 409;
      throw err;
    }

    // 3. Allocate new gapless receipt number for the reversal entry
    const reversalReceiptNo = await nextReceiptNo(clinicObjectId, session, clock.now());

    // 4. Build reversal snapshot
    const clinic = (await Clinic.findById(clinicObjectId).session(session))!;
    const patient = (await Patient.findById(bill.patientId).session(session))!;

    const reversalAmount = -Math.abs(originalPayment.amount);

    // Calculate updated balance
    const existingPayments = await Payment.find({
      clinicId: clinicObjectId,
      billId: bill._id,
    }).session(session);

    const paymentRecords = existingPayments.map((p) => ({
      amount: asPaise(p.amount),
      method: p.method,
      isReversal: p.isReversal,
    }));

    const updatedPaymentRecords = [
      ...paymentRecords,
      { amount: asPaise(reversalAmount), isReversal: true },
    ];

    const newFinancials = recomputeBill(asPaise(bill.total), updatedPaymentRecords, false);

    const snapshot = {
      isReversal: true,
      title: 'Receipt Reversal',
      originalReceiptNo: originalPayment.receiptNo,
      reversalReason: reason.trim(),
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
      receiptNo: reversalReceiptNo,
      date: clinicDate(clock.now()),
      method: originalPayment.method,
      amount: reversalAmount,
      amountInWords: `Minus ${amountInWordsINR(asPaise(Math.abs(reversalAmount)))}`,
      balanceAfterPayment: newFinancials.balance,
    };

    // 5. Create append-only reversal Payment
    const [reversalPayment] = await Payment.create(
      [
        {
          clinicId: clinicObjectId,
          billId: bill._id,
          receiptNo: reversalReceiptNo,
          amount: reversalAmount,
          method: originalPayment.method,
          isReversal: true,
          reversalOf: originalPayment._id,
          reversalReason: reason.trim(),
          snapshot,
          printCount: 0,
          receivedAt: clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    // 6. Recompute bill status (transitions back from PAID -> PARTIAL or UNPAID)
    applyBillRecompute(bill, updatedPaymentRecords, false);
    bill.version += 1;
    await bill.save({ session });

    // 7. Audit Log
    await AuditLog.create(
      [
        {
          clinicId: clinicObjectId,
          action: AuditAction.PAYMENT_REVERSE,
          entity: 'Payment',
          entityId: reversalPayment._id.toString(),
          actor,
          meta: {
            originalReceiptNo: originalPayment.receiptNo,
            reversalReceiptNo,
            billId: bill._id.toString(),
            cancelReason: reason.trim(),
          },
          at: clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    return { reversalPayment, billBalance: asPaise(bill.balance) };
  });
}

export async function recordReceiptPrint(
  clinicId: Types.ObjectId | string,
  paymentId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IPayment> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const paymentObjectId = new Types.ObjectId(paymentId);

  const payment = await Payment.findOne({ clinicId: clinicObjectId, _id: paymentObjectId });
  if (!payment) {
    throw new Error(`Payment not found: ${paymentId}`);
  }

  const reprintCount = await AuditLog.countDocuments({
    clinicId: clinicObjectId,
    action: AuditAction.RECEIPT_PRINT,
    entityId: payment._id.toString(),
  });

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.RECEIPT_PRINT,
    entity: 'Payment',
    entityId: payment._id.toString(),
    actor,
    meta: {
      receiptNo: payment.receiptNo,
      reprintCount: reprintCount + 1,
    },
    at: clock.now(),
    createdBy: actor,
  });

  return payment;
}

export async function collectionsForDay(
  clinicId: Types.ObjectId | string,
  dateStr = clinicDate(clock.now())
): Promise<{ cash: Paise; upi: Paise; netTotal: Paise; count: number }> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const start = startOfClinicDay(dateStr);
  const end = endOfClinicDay(dateStr);

  const payments = await Payment.find({
    clinicId: clinicObjectId,
    receivedAt: { $gte: start, $lte: end },
  });

  let cashTotal = 0;
  let upiTotal = 0;

  for (const p of payments) {
    if (p.method === 'CASH') {
      cashTotal += p.amount;
    } else {
      upiTotal += p.amount;
    }
  }

  const netTotal = cashTotal + upiTotal;

  return {
    cash: asPaise(cashTotal),
    upi: asPaise(upiTotal),
    netTotal: asPaise(netTotal),
    count: payments.length,
  };
}
