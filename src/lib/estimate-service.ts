import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { Estimate, IEstimate, IEstimateItem } from '../models/Estimate';
import { Clinic } from '../models/Clinic';
import { Patient } from '../models/Patient';
import { User } from '../models/User';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { withTransaction, nextEstimateNo } from './counters';
import { isValidFdiTooth } from './fdi-tooth';
import { clock } from './clock';
import { clinicDate } from './date';
import { TenantActor } from './tenancy';
import {
  canTransitionEstimate,
  transitionEstimate,
  isEstimateExpired,
  EstimateStatus,
} from './estimate-state-machine';
import { asPaise, applyPercentDiscount, sumPaise } from './money';

export const EstimateLineInputSchema = z.object({
  treatmentId: z.union([z.string(), z.instanceof(Types.ObjectId)]).optional(),
  description: z.string().trim().min(1, 'Description cannot be empty').max(500),
  teeth: z
    .array(z.number().int())
    .refine((arr) => !arr || arr.every(isValidFdiTooth), {
      message: 'All tooth numbers must be valid FDI two-digit teeth (11-48, 51-85)',
    })
    .optional()
    .default([]),
  qty: z.number().int().min(1, 'Quantity must be at least 1').max(99, 'Quantity cannot exceed 99'),
  listPrice: z.number().int().nonnegative('List price cannot be negative').optional(),
  unitPrice: z.number().int().nonnegative('Unit price cannot be negative'),
  amount: z.number().int().nonnegative('Amount cannot be negative'),
});

export const SaveEstimateDraftSchema = z.object({
  patientId: z.string().min(1, 'Patient ID is required'),
  visitId: z.string().optional(),
  items: z.array(EstimateLineInputSchema).min(1, 'Estimate must have at least one line item'),
  discount: z.number().int().nonnegative('Discount cannot be negative').default(0),
  discountPercent: z.number().min(0).max(100).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid until must be YYYY-MM-DD').optional(),
  notes: z.string().max(2000).optional(),
  replacesEstimateId: z.string().optional(),
  version: z.number().int().min(1).optional(),
});

export type SaveEstimateDraftInput = z.input<typeof SaveEstimateDraftSchema>;

export async function createEstimateDraft(
  clinicId: Types.ObjectId | string,
  input: SaveEstimateDraftInput,
  actor: TenantActor
): Promise<IEstimate> {
  const validated = SaveEstimateDraftSchema.parse(input);
  const clinicObjectId = new Types.ObjectId(clinicId);
  const patientObjectId = new Types.ObjectId(validated.patientId);
  const visitObjectId = validated.visitId ? new Types.ObjectId(validated.visitId) : undefined;
  const replacesObjectId = validated.replacesEstimateId
    ? new Types.ObjectId(validated.replacesEstimateId)
    : undefined;

  // Calculate subtotal from items
  const items: IEstimateItem[] = validated.items.map((it) => {
    const calculatedAmount = it.qty * it.unitPrice;
    return {
      treatmentId: it.treatmentId ? new Types.ObjectId(it.treatmentId) : undefined,
      description: it.description,
      teeth: it.teeth,
      qty: it.qty,
      listPrice: it.listPrice ?? it.unitPrice,
      unitPrice: it.unitPrice,
      amount: calculatedAmount,
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

  const estimate = await Estimate.create({
    clinicId: clinicObjectId,
    patientId: patientObjectId,
    visitId: visitObjectId,
    items,
    subtotal,
    discount,
    total,
    validUntil: validated.validUntil,
    notes: validated.notes,
    status: 'DRAFT',
    replacesEstimateId: replacesObjectId,
    printCount: 0,
    version: 1,
    createdBy: actor,
  });

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.ESTIMATE_CREATE,
    entity: 'Estimate',
    entityId: estimate._id.toString(),
    actor,
    meta: {
      patientId: patientObjectId.toString(),
      visitId: visitObjectId?.toString(),
      total,
      replacesEstimateId: replacesObjectId?.toString(),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return estimate;
}

export async function updateEstimateDraft(
  clinicId: Types.ObjectId | string,
  estimateId: Types.ObjectId | string,
  input: SaveEstimateDraftInput,
  actor: TenantActor
): Promise<IEstimate> {
  const validated = SaveEstimateDraftSchema.parse(input);
  const clinicObjectId = new Types.ObjectId(clinicId);
  const estimateObjectId = new Types.ObjectId(estimateId);

  const existing = await Estimate.findOne({ clinicId: clinicObjectId, _id: estimateObjectId });
  if (!existing) {
    throw new Error(`Estimate not found: ${estimateId}`);
  }

  if (existing.status !== 'DRAFT') {
    throw new Error(`Cannot edit estimate in status ${existing.status}`);
  }

  if (validated.version && existing.version !== validated.version) {
    const err: any = new Error(
      `Conflict: Estimate was modified by another session (v${existing.version}). Your edit was based on v${validated.version}.`
    );
    err.statusCode = 409;
    throw err;
  }

  const items: IEstimateItem[] = validated.items.map((it) => {
    const calculatedAmount = it.qty * it.unitPrice;
    return {
      treatmentId: it.treatmentId ? new Types.ObjectId(it.treatmentId) : undefined,
      description: it.description,
      teeth: it.teeth,
      qty: it.qty,
      listPrice: it.listPrice ?? it.unitPrice,
      unitPrice: it.unitPrice,
      amount: calculatedAmount,
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

  const updated = await Estimate.findOneAndUpdate(
    { clinicId: clinicObjectId, _id: estimateObjectId, version: existing.version },
    {
      $set: {
        items,
        subtotal,
        discount,
        total,
        validUntil: validated.validUntil,
        notes: validated.notes,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!updated) {
    const err: any = new Error('Conflict: Another session modified this estimate simultaneously.');
    err.statusCode = 409;
    throw err;
  }

  return updated;
}

export async function issueEstimate(
  clinicId: Types.ObjectId | string,
  estimateId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IEstimate> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const estimateObjectId = new Types.ObjectId(estimateId);

  return withTransaction(async (session) => {
    const estimate = await Estimate.findOne({ clinicId: clinicObjectId, _id: estimateObjectId }).session(session);
    if (!estimate) {
      throw new Error(`Estimate not found: ${estimateId}`);
    }

    if (!canTransitionEstimate(estimate.status, 'ISSUE')) {
      throw new Error(`Cannot issue estimate with status ${estimate.status}`);
    }

    // Allocate gapless estimate number inside transaction
    const estimateNo = await nextEstimateNo(clinicObjectId, session, clock.now());

    // Fetch clinic & patient details to build immutable snapshot
    const clinic = (await Clinic.findById(clinicObjectId).session(session))!;
    const patient = (await Patient.findById(estimate.patientId).session(session))!;
    const doctor = await User.findOne({ clinicId: clinicObjectId, role: 'DOCTOR' }).session(session);

    const snapshot = {
      clinic: {
        name: clinic.name,
        address: clinic.address,
        phone: clinic.phone,
        email: clinic.email,
        registrationNo: clinic.registrationNo,
      },
      doctor: {
        name: doctor ? doctor.name : 'Dr. Susheel Shinde',
        qualification: 'BDS, MDS (Oral & Maxillofacial Implantology)',
      },
      patient: {
        name: patient.name,
        patientCode: patient.patientCode,
        ageYears: patient.ageYears,
        sex: patient.sex,
        phone: patient.phone,
      },
      date: clinicDate(clock.now()),
      validUntil: estimate.validUntil,
      items: estimate.items.map((it) => ({
        treatmentId: it.treatmentId?.toString(),
        description: it.description,
        teeth: it.teeth,
        qty: it.qty,
        listPrice: it.listPrice,
        unitPrice: it.unitPrice,
        amount: it.amount,
      })),
      subtotal: estimate.subtotal,
      discount: estimate.discount,
      total: estimate.total,
      notes: estimate.notes || '',
    };

    estimate.estimateNo = estimateNo;
    estimate.status = 'ISSUED';
    estimate.issuedAt = clock.now();
    estimate.snapshot = snapshot;
    estimate.version += 1;
    await estimate.save({ session });

    await AuditLog.create(
      [
        {
          clinicId: clinicObjectId,
          action: AuditAction.ESTIMATE_ISSUE,
          entity: 'Estimate',
          entityId: estimate._id.toString(),
          actor,
          meta: {
            estimateNo,
            patientId: estimate.patientId.toString(),
            total: estimate.total,
          },
          at: clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    return estimate;
  });
}

export async function cancelEstimate(
  clinicId: Types.ObjectId | string,
  estimateId: Types.ObjectId | string,
  reason: string,
  actor: TenantActor
): Promise<IEstimate> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const estimateObjectId = new Types.ObjectId(estimateId);

  if (!reason || !reason.trim()) {
    throw new Error('A reason is required to cancel an estimate');
  }

  const estimate = await Estimate.findOne({ clinicId: clinicObjectId, _id: estimateObjectId });
  if (!estimate) {
    throw new Error(`Estimate not found: ${estimateId}`);
  }

  if (!canTransitionEstimate(estimate.status, 'CANCEL')) {
    throw new Error(`Cannot cancel estimate with status ${estimate.status}`);
  }

  estimate.status = 'CANCELLED';
  estimate.cancelReason = reason.trim();
  estimate.version += 1;
  await estimate.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.ESTIMATE_CANCEL,
    entity: 'Estimate',
    entityId: estimate._id.toString(),
    actor,
    meta: {
      estimateNo: estimate.estimateNo,
      patientId: estimate.patientId.toString(),
      cancelReason: reason.trim(),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return estimate;
}

export async function recordEstimatePrint(
  clinicId: Types.ObjectId | string,
  estimateId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IEstimate> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const estimateObjectId = new Types.ObjectId(estimateId);

  const updated = await Estimate.findOneAndUpdate(
    { clinicId: clinicObjectId, _id: estimateObjectId },
    { $inc: { printCount: 1 } },
    { returnDocument: 'after' }
  );

  if (!updated) {
    throw new Error(`Estimate not found: ${estimateId}`);
  }

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.ESTIMATE_PRINT,
    entity: 'Estimate',
    entityId: updated._id.toString(),
    actor,
    meta: {
      estimateNo: updated.estimateNo,
      reprintCount: updated.printCount,
    },
    at: clock.now(),
    createdBy: actor,
  });

  return updated;
}

export async function getEstimate(
  clinicId: Types.ObjectId | string,
  estimateId: Types.ObjectId | string
): Promise<IEstimate | null> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const estimateObjectId = new Types.ObjectId(estimateId);
  return Estimate.findOne({ clinicId: clinicObjectId, _id: estimateObjectId });
}

export async function listEstimates(
  clinicId: Types.ObjectId | string,
  filter: { patientId?: string; status?: EstimateStatus } = {}
): Promise<IEstimate[]> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const query: Record<string, unknown> = { clinicId: clinicObjectId };

  if (filter.patientId) {
    query.patientId = new Types.ObjectId(filter.patientId);
  }
  if (filter.status) {
    query.status = filter.status;
  }

  return Estimate.find(query).sort({ createdAt: -1 });
}
