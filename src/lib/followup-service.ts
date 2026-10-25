import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { FollowUp, IFollowUp, FollowUpStatus } from '../models/FollowUp';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { clock } from './clock';
import { clinicDate } from './date';
import { TenantActor, getTenantContext, runWithTenantContext } from './tenancy';

export const CreateFollowUpSchema = z.object({
  patientId: z.string().min(1, 'Patient ID is required'),
  sourceVisitId: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD'),
  reason: z.string().trim().min(1, 'Reason is required').max(500),
  note: z.string().trim().max(1000).optional(),
});

export type CreateFollowUpInput = z.input<typeof CreateFollowUpSchema>;

export const UpdateFollowUpSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD').optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  note: z.string().trim().max(1000).optional(),
});

export type UpdateFollowUpInput = z.input<typeof UpdateFollowUpSchema>;

export type FollowUpTab = 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'DONE';

export interface EnrichedFollowUp extends IFollowUp {
  computedCategory: FollowUpTab;
}

export function computeFollowUpCategory(f: { status: FollowUpStatus; dueDate: string }, todayStr: string): FollowUpTab {
  if (f.status === 'DONE') return 'DONE';
  if (f.status === 'CANCELLED') return 'DONE'; // Group cancelled or handle separately
  if (f.dueDate < todayStr) return 'OVERDUE';
  if (f.dueDate === todayStr) return 'TODAY';
  return 'UPCOMING';
}

export async function createFollowUp(
  clinicId: Types.ObjectId | string,
  input: CreateFollowUpInput,
  actor: TenantActor
): Promise<IFollowUp> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      createFollowUp(clinicId, input, actor)
    );
  }

  const validated = CreateFollowUpSchema.parse(input);
  const patientObjectId = new Types.ObjectId(validated.patientId);
  const sourceVisitObjectId = validated.sourceVisitId ? new Types.ObjectId(validated.sourceVisitId) : undefined;

  const followUp = await FollowUp.create({
    clinicId: clinicObjectId,
    patientId: patientObjectId,
    sourceVisitId: sourceVisitObjectId,
    dueDate: validated.dueDate,
    reason: validated.reason,
    note: validated.note,
    status: 'PENDING',
    schemaVersion: 1,
    createdBy: actor,
  });

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.FOLLOWUP_CREATE,
    entity: 'FollowUp',
    entityId: followUp._id.toString(),
    actor,
    meta: {
      followUpId: followUp._id.toString(),
      patientId: validated.patientId,
      dueDate: validated.dueDate,
    },
    at: clock.now(),
    createdBy: actor,
  });

  return followUp;
}

export async function updateFollowUp(
  clinicId: Types.ObjectId | string,
  followUpId: Types.ObjectId | string,
  input: UpdateFollowUpInput,
  actor: TenantActor
): Promise<IFollowUp> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      updateFollowUp(clinicId, followUpId, input, actor)
    );
  }

  const validated = UpdateFollowUpSchema.parse(input);
  const followUpObjectId = new Types.ObjectId(followUpId);

  const followUp = await FollowUp.findOne({ clinicId: clinicObjectId, _id: followUpObjectId, deletedAt: null });
  if (!followUp) {
    const err: any = new Error(`Follow-up not found: ${followUpId}`);
    err.statusCode = 404;
    throw err;
  }

  const changedFields: string[] = [];
  if (validated.dueDate && validated.dueDate !== followUp.dueDate) {
    followUp.dueDate = validated.dueDate;
    changedFields.push('dueDate');
  }
  if (validated.reason && validated.reason !== followUp.reason) {
    followUp.reason = validated.reason;
    changedFields.push('reason');
  }
  if (validated.note !== undefined && validated.note !== followUp.note) {
    followUp.note = validated.note;
    changedFields.push('note');
  }

  if (changedFields.length > 0) {
    await followUp.save();
    await AuditLog.create({
      clinicId: clinicObjectId,
      action: AuditAction.FOLLOWUP_UPDATE,
      entity: 'FollowUp',
      entityId: followUp._id.toString(),
      actor,
      meta: {
        followUpId: followUp._id.toString(),
        changedFields,
      },
      at: clock.now(),
      createdBy: actor,
    });
  }

  return followUp;
}

export async function markFollowUpDone(
  clinicId: Types.ObjectId | string,
  followUpId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IFollowUp> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      markFollowUpDone(clinicId, followUpId, actor)
    );
  }

  const followUpObjectId = new Types.ObjectId(followUpId);

  const followUp = await FollowUp.findOne({ clinicId: clinicObjectId, _id: followUpObjectId, deletedAt: null });
  if (!followUp) {
    const err: any = new Error(`Follow-up not found: ${followUpId}`);
    err.statusCode = 404;
    throw err;
  }

  followUp.status = 'DONE';
  followUp.doneAt = clock.now();
  await followUp.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.FOLLOWUP_DONE,
    entity: 'FollowUp',
    entityId: followUp._id.toString(),
    actor,
    meta: {
      followUpId: followUp._id.toString(),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return followUp;
}

export async function cancelFollowUp(
  clinicId: Types.ObjectId | string,
  followUpId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IFollowUp> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      cancelFollowUp(clinicId, followUpId, actor)
    );
  }

  const followUpObjectId = new Types.ObjectId(followUpId);

  const followUp = await FollowUp.findOne({ clinicId: clinicObjectId, _id: followUpObjectId, deletedAt: null });
  if (!followUp) {
    const err: any = new Error(`Follow-up not found: ${followUpId}`);
    err.statusCode = 404;
    throw err;
  }

  followUp.status = 'CANCELLED';
  await followUp.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.FOLLOWUP_CANCEL,
    entity: 'FollowUp',
    entityId: followUp._id.toString(),
    actor,
    meta: {
      followUpId: followUp._id.toString(),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return followUp;
}

export async function listFollowUps(
  clinicId: Types.ObjectId | string,
  filter: { tab?: FollowUpTab; patientId?: string } = {}
): Promise<{
  followUps: any[];
  counts: { overdue: number; today: number; upcoming: number; done: number };
}> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor: { type: 'SYSTEM', id: 'reader' } }, () =>
      listFollowUps(clinicId, filter)
    );
  }
  const todayStr = clinicDate(clock.now());

  const baseQuery: Record<string, unknown> = { clinicId: clinicObjectId, deletedAt: null };
  if (filter.patientId) {
    baseQuery.patientId = new Types.ObjectId(filter.patientId);
  }

  // Fetch all active followups for this clinic (or patient) to compute dynamic tabs and counts
  const all = await FollowUp.find(baseQuery)
    .populate('patientId', 'name phone patientCode')
    .sort({ dueDate: 1 });

  let overdue = 0;
  let today = 0;
  let upcoming = 0;
  let done = 0;

  const categorized = all.map((doc) => {
    const obj = doc.toObject() as any;
    const cat = computeFollowUpCategory(obj, todayStr);
    obj.computedCategory = cat;

    if (cat === 'OVERDUE') overdue++;
    else if (cat === 'TODAY') today++;
    else if (cat === 'UPCOMING') upcoming++;
    else if (cat === 'DONE') done++;

    return obj;
  });

  let filtered = categorized;
  if (filter.tab) {
    filtered = categorized.filter((item) => item.computedCategory === filter.tab);
  }

  return {
    followUps: filtered,
    counts: { overdue, today, upcoming, done },
  };
}

export async function softDeleteFollowUp(
  clinicId: Types.ObjectId | string,
  followUpId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IFollowUp> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      softDeleteFollowUp(clinicId, followUpId, actor)
    );
  }

  const followUpObjectId = new Types.ObjectId(followUpId);

  const followUp = await FollowUp.findOne({ clinicId: clinicObjectId, _id: followUpObjectId, deletedAt: null });
  if (!followUp) {
    const err: any = new Error(`Follow-up not found: ${followUpId}`);
    err.statusCode = 404;
    throw err;
  }

  followUp.deletedAt = clock.now();
  await followUp.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.FOLLOWUP_CANCEL,
    entity: 'FollowUp',
    entityId: followUp._id.toString(),
    actor,
    meta: {
      followUpId: followUp._id.toString(),
      deleted: true,
    },
    at: clock.now(),
    createdBy: actor,
  });

  return followUp;
}

