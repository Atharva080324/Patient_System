import mongoose, { ClientSession } from 'mongoose';
import { z } from 'zod';
import {
  Prescription,
  IPrescription,
  IPrescriptionItem,
} from '../models/Prescription';
import { Clinic } from '../models/Clinic';
import { User } from '../models/User';
import { Patient } from '../models/Patient';
import { Visit } from '../models/Visit';
import { DoctorMedicine } from '../models/DoctorMedicine';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { TenantActor } from './tenancy';
import { buildPrescriptionSnapshot } from './prescription-snapshot';
import { nextRxNumber, withTransaction } from './counters';
import { clinicDate } from './date';
import { clock } from './clock';

export const PrescriptionItemSchema = z
  .object({
    medicineId: z.string().optional(),
    name: z.string().trim().min(1, 'Medicine name is required').max(200),
    form: z.string().trim().min(1, 'Form is required').max(50),
    strength: z.string().trim().min(1, 'Strength is required').max(50),
    dose: z.string().trim().max(100).optional().default(''),
    frequency: z.string().trim().min(1, 'Frequency is required').max(50),
    duration: z.string().trim().min(1, 'Duration is required').max(50),
    instruction: z.string().trim().max(500).optional().default(''),
    note: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const SavePrescriptionDraftSchema = z
  .object({
    items: z.array(PrescriptionItemSchema).min(0).max(50),
    advice: z.string().trim().max(2000).optional().default(''),
    followUpDate: z.string().trim().max(50).optional().default(''),
    language: z.enum(['en', 'hi', 'mr']).default('en'),
  })
  .strict();

export type SavePrescriptionDraftInput = z.input<typeof SavePrescriptionDraftSchema>;

export async function getPrescriptionForVisit(
  clinicId: mongoose.Types.ObjectId | string,
  visitId: mongoose.Types.ObjectId | string
): Promise<IPrescription | null> {
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const visitObjectId = new mongoose.Types.ObjectId(visitId);

  // Return latest prescription for this visit (draft or issued)
  return Prescription.findOne({
    clinicId: clinicObjectId,
    visitId: visitObjectId,
  }).sort({ createdAt: -1 });
}

export async function savePrescriptionDraft(
  clinicId: mongoose.Types.ObjectId | string,
  visitId: mongoose.Types.ObjectId | string,
  input: SavePrescriptionDraftInput,
  actor: TenantActor
): Promise<IPrescription> {
  const validated = SavePrescriptionDraftSchema.parse(input);
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const visitObjectId = new mongoose.Types.ObjectId(visitId);

  const existing = await Prescription.findOne({
    clinicId: clinicObjectId,
    visitId: visitObjectId,
    status: 'DRAFT',
  });

  if (existing) {
    existing.items = validated.items as unknown as IPrescriptionItem[];
    existing.advice = validated.advice;
    existing.followUpDate = validated.followUpDate;
    existing.language = validated.language;
    existing.version += 1;
    await existing.save();
    return existing;
  }

  // Check if there is an ISSUED prescription and no DRAFT
  const alreadyIssued = await Prescription.findOne({
    clinicId: clinicObjectId,
    visitId: visitObjectId,
    status: 'ISSUED',
  });

  const visit = await Visit.findOne({ clinicId: clinicObjectId, _id: visitObjectId });
  if (!visit) {
    throw new Error(`Visit not found: ${visitId}`);
  }

  const newDraft = await Prescription.create({
    clinicId: clinicObjectId,
    visitId: visitObjectId,
    patientId: visit.patientId,
    status: 'DRAFT',
    date: clock.now(),
    items: validated.items,
    advice: validated.advice,
    followUpDate: validated.followUpDate,
    language: validated.language,
    version: 1,
    createdBy: actor,
  });

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.PRESCRIPTION_CREATE,
    entity: 'Prescription',
    entityId: newDraft._id.toString(),
    actor,
    meta: {
      visitId: visitObjectId.toString(),
      patientId: visit.patientId.toString(),
      status: 'DRAFT',
      isAdditional: Boolean(alreadyIssued),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return newDraft;
}

export async function issuePrescription(
  clinicId: mongoose.Types.ObjectId | string,
  prescriptionId: mongoose.Types.ObjectId | string,
  actor: TenantActor
): Promise<IPrescription> {
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const prescriptionObjectId = new mongoose.Types.ObjectId(prescriptionId);

  return withTransaction(async (session: ClientSession) => {
    const rx = await Prescription.findOne({
      clinicId: clinicObjectId,
      _id: prescriptionObjectId,
    }).session(session);

    if (!rx) {
      throw new Error(`Prescription not found: ${prescriptionId}`);
    }

    if (rx.status !== 'DRAFT') {
      throw new Error(`Cannot issue prescription in status ${rx.status}. Only DRAFT can be issued.`);
    }

    if (!rx.items || rx.items.length === 0) {
      throw new Error('Cannot issue prescription with zero medicine items');
    }

    const clinic = await Clinic.findOne({ _id: clinicObjectId }).session(session);
    if (!clinic) {
      throw new Error('Clinic not found');
    }

    const doctor = await User.findOne({ clinicId: clinicObjectId, role: 'DOCTOR' }).session(session);
    const patient = await Patient.findOne({ clinicId: clinicObjectId, _id: rx.patientId }).session(session);
    if (!patient) {
      throw new Error('Patient record not found');
    }

    const now = clock.now();
    const rxNumber = await nextRxNumber(clinicObjectId, session, now);
    const dateStr = clinicDate(now);

    const snapshot = buildPrescriptionSnapshot({
      clinic: clinic.toObject(),
      doctor: doctor?.toObject() || {},
      patient: patient.toObject(),
      rxNumber,
      date: dateStr,
      items: rx.items,
      advice: rx.advice,
      followUpDate: rx.followUpDate,
      language: rx.language,
      issuedAt: now,
    });

    rx.status = 'ISSUED';
    rx.rxNumber = rxNumber;
    rx.snapshot = snapshot;
    rx.date = now;
    rx.version += 1;
    await rx.save({ session });

    // Link prescription to visit if not already linked
    await Visit.updateOne(
      { clinicId: clinicObjectId, _id: rx.visitId, prescriptionId: { $exists: false } },
      { $set: { prescriptionId: rx._id } },
      { session }
    );

    // Update doctor medicine usage counts
    for (const item of rx.items) {
      if (item.medicineId) {
        await DoctorMedicine.findOneAndUpdate(
          { clinicId: clinicObjectId, medicineId: item.medicineId },
          {
            $inc: { useCount: 1 },
            $set: { lastUsedAt: now },
            $setOnInsert: {
              clinicId: clinicObjectId,
              medicineId: item.medicineId,
              isFavorite: false,
              createdBy: actor,
            },
          },
          { upsert: true, session }
        );
      }
    }

    await AuditLog.create(
      [
        {
          clinicId: clinicObjectId,
          action: AuditAction.PRESCRIPTION_ISSUE,
          entity: 'Prescription',
          entityId: rx._id.toString(),
          actor,
          meta: {
            rxNumber,
            visitId: rx.visitId.toString(),
            patientId: rx.patientId.toString(),
            itemCount: rx.items.length,
          },
          at: now,
          createdBy: actor,
        },
      ],
      { session }
    );

    return rx;
  });
}

export async function voidPrescription(
  clinicId: mongoose.Types.ObjectId | string,
  prescriptionId: mongoose.Types.ObjectId | string,
  voidReason: string,
  actor: TenantActor
): Promise<IPrescription> {
  if (!voidReason || !voidReason.trim()) {
    throw new Error('A non-empty void reason is required to void an issued prescription');
  }

  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const prescriptionObjectId = new mongoose.Types.ObjectId(prescriptionId);

  const rx = await Prescription.findOne({
    clinicId: clinicObjectId,
    _id: prescriptionObjectId,
  });

  if (!rx) {
    throw new Error(`Prescription not found: ${prescriptionId}`);
  }

  if (rx.status !== 'ISSUED') {
    throw new Error(`Cannot void prescription in status ${rx.status}. Only ISSUED prescriptions can be voided.`);
  }

  const now = clock.now();
  rx.status = 'VOID';
  rx.voidReason = voidReason.trim();
  rx.voidedAt = now;
  rx.voidedBy = actor;
  rx.version += 1;
  await rx.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.PRESCRIPTION_VOID,
    entity: 'Prescription',
    entityId: rx._id.toString(),
    actor,
    meta: {
      rxNumber: rx.rxNumber,
      visitId: rx.visitId.toString(),
      patientId: rx.patientId.toString(),
      voidReason: rx.voidReason,
    },
    at: now,
    createdBy: actor,
  });

  return rx;
}

export async function createCorrectionPrescription(
  clinicId: mongoose.Types.ObjectId | string,
  oldPrescriptionId: mongoose.Types.ObjectId | string,
  voidReason: string,
  actor: TenantActor
): Promise<IPrescription> {
  const voided = await voidPrescription(clinicId, oldPrescriptionId, voidReason, actor);

  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const now = clock.now();

  const newDraft = await Prescription.create({
    clinicId: clinicObjectId,
    visitId: voided.visitId,
    patientId: voided.patientId,
    status: 'DRAFT',
    date: now,
    items: voided.items,
    advice: voided.advice,
    followUpDate: voided.followUpDate,
    language: voided.language,
    replacesPrescriptionId: voided._id,
    version: 1,
    createdBy: actor,
  });

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.PRESCRIPTION_CREATE,
    entity: 'Prescription',
    entityId: newDraft._id.toString(),
    actor,
    meta: {
      visitId: voided.visitId.toString(),
      patientId: voided.patientId.toString(),
      status: 'DRAFT',
      replacesPrescriptionId: voided._id.toString(),
      previousRxNumber: voided.rxNumber,
    },
    at: now,
    createdBy: actor,
  });

  return newDraft;
}

export async function recordPrescriptionPrint(
  clinicId: mongoose.Types.ObjectId | string,
  prescriptionId: mongoose.Types.ObjectId | string,
  actor: TenantActor
): Promise<IPrescription> {
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const prescriptionObjectId = new mongoose.Types.ObjectId(prescriptionId);

  const rx = await Prescription.findOne({
    clinicId: clinicObjectId,
    _id: prescriptionObjectId,
  });

  if (!rx) {
    throw new Error(`Prescription not found: ${prescriptionId}`);
  }

  const now = clock.now();
  rx.printCount = (rx.printCount || 0) + 1;
  rx.lastPrintedAt = now;
  await rx.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.PRESCRIPTION_PRINT,
    entity: 'Prescription',
    entityId: rx._id.toString(),
    actor,
    meta: {
      rxNumber: rx.rxNumber,
      printCount: rx.printCount,
      isReprint: rx.printCount > 1,
    },
    at: now,
    createdBy: actor,
  });

  return rx;
}
