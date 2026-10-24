import { Types } from 'mongoose';
import { Visit, IVisit, VisitStatus } from '../models/Visit';
import { Patient } from '../models/Patient';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { TenantActor } from './tenancy';
import { clock } from './clock';
import { clinicDate } from './date';
import {
  VisitAction,
  getNextStateForAction,
  getStateTimestampField,
} from './visit-state-machine';

export class IllegalTransitionError extends Error {
  constructor(message = 'Illegal status transition') {
    super(message);
    this.name = 'IllegalTransitionError';
  }
}

export class VersionConflictError extends Error {
  constructor(message = 'Conflict: Visit was modified concurrently by another session') {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export class OperatoryOccupiedError extends Error {
  constructor(message = 'Another patient is already in consultation') {
    super(message);
    this.name = 'OperatoryOccupiedError';
  }
}

export interface QueueCounters {
  waiting: number;
  inConsultation: number;
  completed: number;
  skippedOrNoShow: number;
  averageWaitMinutes: number;
}

export interface QueueItem {
  id: string;
  token: number;
  status: VisitStatus;
  patientId: string;
  patientName: string;
  ageYears?: number;
  dob?: string;
  sex: string;
  reasonForVisit: string;
  checkInAt: string;
  waitingMinutes: number;
  duplicateFlag: boolean;
  possibleDuplicateOfCode?: string;
  source: string;
  version: number;
}

export interface LiveQueueResult {
  date: string;
  counters: QueueCounters;
  items: QueueItem[];
  lastUpdated: string;
}

export async function getLiveQueue(
  clinicId: Types.ObjectId | string,
  targetDate = clinicDate(clock.now())
): Promise<LiveQueueResult> {
  const cId = typeof clinicId === 'string' ? new Types.ObjectId(clinicId) : clinicId;
  const now = clock.now();

  // Optimized single pipeline fetch: fetch visits for date with patient projection
  const visits = await Visit.find({ clinicId: cId, date: targetDate })
    .select('token status checkInAt startedAt completedAt reasonForVisit type version patientId')
    .populate({
      path: 'patientId',
      select: 'name ageYears dob sex possibleDuplicateOf',
      populate: {
        path: 'possibleDuplicateOf',
        select: 'patientCode',
      },
    })
    .sort({ token: 1 })
    .lean();

  let waiting = 0;
  let inConsultation = 0;
  let completed = 0;
  let skippedOrNoShow = 0;

  let totalWaitMinutes = 0;
  let waitSampleCount = 0;

  const activeItems: QueueItem[] = [];

  for (const visit of visits) {
    const status = visit.status as VisitStatus;
    const checkIn = new Date(visit.checkInAt);
    let waitMinutes = 0;

    if (visit.startedAt) {
      waitMinutes = Math.max(0, Math.floor((new Date(visit.startedAt).getTime() - checkIn.getTime()) / 60000));
    } else {
      waitMinutes = Math.max(0, Math.floor((now.getTime() - checkIn.getTime()) / 60000));
    }

    if (status === 'WAITING') {
      waiting++;
      totalWaitMinutes += waitMinutes;
      waitSampleCount++;
    } else if (status === 'IN_CONSULTATION') {
      inConsultation++;
      totalWaitMinutes += waitMinutes;
      waitSampleCount++;
    } else if (status === 'COMPLETED') {
      completed++;
      totalWaitMinutes += waitMinutes;
      waitSampleCount++;
    } else if (status === 'SKIPPED' || status === 'NO_SHOW') {
      skippedOrNoShow++;
    }

    // Active queue includes WAITING, IN_CONSULTATION, and SKIPPED
    if (status === 'WAITING' || status === 'IN_CONSULTATION' || status === 'SKIPPED') {
      const patient = visit.patientId as any;
      const isDuplicate = !!patient?.possibleDuplicateOf;
      const possibleCode = patient?.possibleDuplicateOf?.patientCode;

      activeItems.push({
        id: visit._id.toString(),
        token: visit.token,
        status,
        patientId: patient?._id?.toString() || '',
        patientName: patient?.name || 'Unknown Patient',
        ageYears: patient?.ageYears,
        dob: patient?.dob,
        sex: patient?.sex || 'Other',
        reasonForVisit: visit.reasonForVisit,
        checkInAt: checkIn.toISOString(),
        waitingMinutes: waitMinutes,
        duplicateFlag: isDuplicate,
        possibleDuplicateOfCode: possibleCode,
        source: visit.type,
        version: visit.version,
      });
    }
  }

  // Sort queue: IN_CONSULTATION first, then WAITING by token, then SKIPPED by token
  activeItems.sort((a, b) => {
    const priority = (s: VisitStatus) => {
      if (s === 'IN_CONSULTATION') return 1;
      if (s === 'WAITING') return 2;
      return 3; // SKIPPED
    };
    const pA = priority(a.status);
    const pB = priority(b.status);
    if (pA !== pB) return pA - pB;
    return a.token - b.token;
  });

  const averageWaitMinutes =
    waitSampleCount > 0 ? Math.round(totalWaitMinutes / waitSampleCount) : 0;

  return {
    date: targetDate,
    counters: {
      waiting,
      inConsultation,
      completed,
      skippedOrNoShow,
      averageWaitMinutes,
    },
    items: activeItems,
    lastUpdated: now.toISOString(),
  };
}

export async function transitionVisitStatus(
  clinicId: Types.ObjectId | string,
  visitId: Types.ObjectId | string,
  action: VisitAction,
  expectedVersion: number,
  actor: TenantActor
): Promise<IVisit> {
  const cId = typeof clinicId === 'string' ? new Types.ObjectId(clinicId) : clinicId;
  const vId = typeof visitId === 'string' ? new Types.ObjectId(visitId) : visitId;

  const currentVisit = await Visit.findOne({ _id: vId, clinicId: cId });
  if (!currentVisit) {
    throw new Error('Visit not found');
  }

  if (currentVisit.version !== expectedVersion) {
    throw new VersionConflictError('Visit was modified by another user. Please refresh.');
  }

  const nextState = getNextStateForAction(currentVisit.status, action);
  if (!nextState) {
    throw new IllegalTransitionError(
      `Cannot perform action ${action} on visit with status ${currentVisit.status}`
    );
  }

  // Enforce single IN_CONSULTATION constraint
  if (nextState === 'IN_CONSULTATION') {
    const activeConsultation = await Visit.findOne({
      clinicId: cId,
      status: 'IN_CONSULTATION',
      _id: { $ne: vId },
    }).lean();

    if (activeConsultation) {
      throw new OperatoryOccupiedError(
        'Doctor is already consulting with another patient. Complete or send back the current consultation first.'
      );
    }
  }

  const timestampField = getStateTimestampField(nextState);
  const now = clock.now();

  const updateDoc: Record<string, any> = {
    $set: {
      status: nextState,
    },
    $inc: {
      version: 1,
    },
  };

  if (timestampField) {
    updateDoc.$set[timestampField] = now;
  }

  try {
    const updated = await Visit.findOneAndUpdate(
      {
        _id: vId,
        clinicId: cId,
        version: expectedVersion,
      },
      updateDoc,
      { new: true }
    );

    if (!updated) {
      throw new VersionConflictError(
        'Visit was modified by another user. Please refresh.'
      );
    }

    await AuditLog.create({
      clinicId: cId,
      actor,
      action: AuditAction.VISIT_STATUS_CHANGE,
      entity: 'Visit',
      entityId: vId.toString(),
      meta: {
        fromStatus: currentVisit.status,
        toStatus: nextState,
        action,
        version: updated.version,
      },
      at: now,
      createdBy: actor,
    });

    return updated;
  } catch (error: any) {
    if (error?.code === 11000 || error?.message?.includes('duplicate key')) {
      throw new OperatoryOccupiedError('Another patient is already in consultation');
    }
    throw error;
  }
}
