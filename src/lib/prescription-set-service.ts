import mongoose from 'mongoose';
import { z } from 'zod';
import { PrescriptionSet, IPrescriptionSet, IPrescriptionSetItem } from '../models/PrescriptionSet';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { TenantActor } from './tenancy';
import { clock } from './clock';

export const PrescriptionSetItemInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Medicine name is required').max(200),
    form: z.string().trim().min(1, 'Form is required').max(50),
    strength: z.string().trim().min(1, 'Strength is required').max(50),
    dose: z.string().trim().max(100).optional().default(''),
    frequency: z.string().trim().min(1, 'Frequency is required').max(50),
    duration: z.string().trim().min(1, 'Duration is required').max(50),
    instructions: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const PrescriptionSetInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Set name must be at least 2 characters').max(100),
    items: z.array(PrescriptionSetItemInputSchema).min(1, 'At least one medicine is required in a set'),
  })
  .strict();

export type PrescriptionSetInput = z.input<typeof PrescriptionSetInputSchema>;

export async function listPrescriptionSets(
  clinicId: mongoose.Types.ObjectId | string
): Promise<IPrescriptionSet[]> {
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  return PrescriptionSet.find({
    clinicId: clinicObjectId,
    deletedAt: { $exists: false },
  }).sort({ name: 1 });
}

export async function createPrescriptionSet(
  clinicId: mongoose.Types.ObjectId | string,
  input: PrescriptionSetInput,
  actor: TenantActor
): Promise<IPrescriptionSet> {
  const validated = PrescriptionSetInputSchema.parse(input);
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);

  const formattedItems: IPrescriptionSetItem[] = validated.items.map((item) => ({
    medicineSnapshot: {
      name: item.name,
      form: item.form,
      strength: item.strength,
    },
    dose: item.dose,
    frequency: item.frequency,
    duration: item.duration,
    instructions: item.instructions,
  }));

  const set = await PrescriptionSet.create({
    clinicId: clinicObjectId,
    name: validated.name,
    items: formattedItems,
    createdBy: actor,
  });

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.SET_CREATE,
    entity: 'PrescriptionSet',
    entityId: set._id.toString(),
    actor,
    meta: { name: set.name, itemCount: set.items.length },
    at: clock.now(),
    createdBy: actor,
  });

  return set;
}

export async function updatePrescriptionSet(
  clinicId: mongoose.Types.ObjectId | string,
  setId: mongoose.Types.ObjectId | string,
  input: PrescriptionSetInput,
  actor: TenantActor
): Promise<IPrescriptionSet> {
  const validated = PrescriptionSetInputSchema.parse(input);
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const setObjectId = new mongoose.Types.ObjectId(setId);

  const set = await PrescriptionSet.findOne({
    clinicId: clinicObjectId,
    _id: setObjectId,
    deletedAt: { $exists: false },
  });

  if (!set) {
    throw new Error('Prescription set not found');
  }

  set.name = validated.name;
  set.items = validated.items.map((item) => ({
    medicineSnapshot: {
      name: item.name,
      form: item.form,
      strength: item.strength,
    },
    dose: item.dose,
    frequency: item.frequency,
    duration: item.duration,
    instructions: item.instructions,
  }));

  await set.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.SET_UPDATE,
    entity: 'PrescriptionSet',
    entityId: set._id.toString(),
    actor,
    meta: { name: set.name, itemCount: set.items.length },
    at: clock.now(),
    createdBy: actor,
  });

  return set;
}

export async function softDeletePrescriptionSet(
  clinicId: mongoose.Types.ObjectId | string,
  setId: mongoose.Types.ObjectId | string,
  actor: TenantActor
): Promise<void> {
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const setObjectId = new mongoose.Types.ObjectId(setId);

  const set = await PrescriptionSet.findOne({
    clinicId: clinicObjectId,
    _id: setObjectId,
    deletedAt: { $exists: false },
  });

  if (!set) {
    throw new Error('Prescription set not found');
  }

  set.deletedAt = clock.now();
  await set.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.SET_DELETE,
    entity: 'PrescriptionSet',
    entityId: set._id.toString(),
    actor,
    meta: { name: set.name },
    at: clock.now(),
    createdBy: actor,
  });
}
