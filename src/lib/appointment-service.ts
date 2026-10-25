import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { Appointment, IAppointment, AppointmentStatus, AppointmentSource } from '../models/Appointment';
import { SlotLock } from '../models/SlotLock';
import { Treatment } from '../models/Treatment';
import { Patient } from '../models/Patient';
import { Visit, IVisit } from '../models/Visit';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { withTransaction, nextToken, nextPatientCode } from './counters';
import { clock } from './clock';
import { clinicDate, clinicHourMinute } from './date';
import { TenantActor, getTenantContext, runWithTenantContext } from './tenancy';
import { evaluateDuplicate, normalizePhone } from './duplicate-detector';
import { canTransitionAppointment } from './appointment-state-machine';

export const DEFAULT_SLOT_MINUTES = 30;
export const CLINIC_OPEN_HOUR = 9; // 09:00 IST
export const CLINIC_CLOSE_HOUR = 20; // 20:00 IST
export const STAFF_REGISTRATION_CONSENT_VERSION = '1.0-staff';

export class SlotConflictError extends Error {
  statusCode: number;
  code: string;

  constructor(message = 'Selected appointment slot is already booked') {
    super(message);
    this.name = 'SlotConflictError';
    this.statusCode = 409;
    this.code = 'SLOT_TAKEN';
  }
}

export function validateSlotGeometry(start: Date, end: Date): void {
  const now = clock.now();

  if (start.getTime() >= end.getTime()) {
    const err: any = new Error('Appointment start time must be before end time');
    err.statusCode = 422;
    throw err;
  }

  // Duration must be a multiple of 30 mins
  const durationMs = end.getTime() - start.getTime();
  const slotMs = DEFAULT_SLOT_MINUTES * 60 * 1000;
  if (durationMs % slotMs !== 0) {
    const err: any = new Error(`Appointment duration must be a multiple of ${DEFAULT_SLOT_MINUTES} minutes`);
    err.statusCode = 422;
    throw err;
  }

  // Check 30-minute grid alignment (Asia/Kolkata is UTC+05:30, aligned with 30-min grid)
  if (start.getTime() % slotMs !== 0) {
    const err: any = new Error(`Appointment start must be aligned to the ${DEFAULT_SLOT_MINUTES}-minute grid`);
    err.statusCode = 422;
    throw err;
  }

  // Cannot be in the past compared to Clock
  if (start.getTime() < now.getTime()) {
    const err: any = new Error('Appointment cannot be scheduled in the past');
    err.statusCode = 422;
    throw err;
  }

  // Clinic operating hours: 09:00 to 20:00 IST
  const startHM = clinicHourMinute(start);
  const endHM = clinicHourMinute(end);

  if (startHM.hour < CLINIC_OPEN_HOUR || startHM.hour >= CLINIC_CLOSE_HOUR) {
    const err: any = new Error(
      `Appointment start must be within clinic hours (${CLINIC_OPEN_HOUR.toString().padStart(2, '0')}:00 - ${CLINIC_CLOSE_HOUR.toString().padStart(2, '0')}:00 IST)`
    );
    err.statusCode = 422;
    throw err;
  }

  if (endHM.hour > CLINIC_CLOSE_HOUR || (endHM.hour === CLINIC_CLOSE_HOUR && endHM.minute > 0)) {
    const err: any = new Error(
      `Appointment end must be within clinic hours (${CLINIC_OPEN_HOUR.toString().padStart(2, '0')}:00 - ${CLINIC_CLOSE_HOUR.toString().padStart(2, '0')}:00 IST)`
    );
    err.statusCode = 422;
    throw err;
  }
}

export const CreateAppointmentSchema = z.object({
  patientId: z.string().optional(),
  contactName: z.string().trim().min(1, 'Contact name is required').max(100),
  contactPhone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number'),
  start: z.coerce.date(),
  end: z.coerce.date().optional(),
  reason: z.string().trim().min(1, 'Reason is required').max(500),
  treatmentCode: z.string().trim().optional(),
  source: z.enum(['MANUAL', 'WEBSITE', 'WHATSAPP']).default('MANUAL'),
  externalId: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateAppointmentInput = z.input<typeof CreateAppointmentSchema>;

export async function createAppointment(
  clinicId: Types.ObjectId | string,
  input: CreateAppointmentInput,
  actor: TenantActor
): Promise<{ appointment: IAppointment; isExisting: boolean }> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      createAppointment(clinicId, input, actor)
    );
  }

  const validated = CreateAppointmentSchema.parse(input);

  const start = validated.start;
  const end = validated.end || new Date(start.getTime() + DEFAULT_SLOT_MINUTES * 60 * 1000);

  // Validate geometry & clinic hours
  validateSlotGeometry(start, end);

  // Derive date in Asia/Kolkata
  const derivedClinicDate = clinicDate(start);

  return withTransaction(async (session) => {
    // Validate treatmentCode if provided
    if (validated.treatmentCode) {
      const treatment = await Treatment.findOne({
        clinicId: clinicObjectId,
        code: validated.treatmentCode,
        active: true,
      }).session(session);

      if (!treatment) {
        const err: any = new Error(`Invalid or inactive treatment code: ${validated.treatmentCode}`);
        err.statusCode = 422;
        throw err;
      }
    }

    // Idempotency check for external bookings (WEBSITE/WHATSAPP)
    if (validated.externalId) {
      const existing = await Appointment.findOne({
        clinicId: clinicObjectId,
        source: validated.source,
        externalId: validated.externalId,
      }).session(session);

      if (existing) {
        // Verify payload match
        const isSameTime = existing.start.getTime() === start.getTime() && existing.end.getTime() === end.getTime();
        const isSamePhone = existing.contactPhone === validated.contactPhone;

        if (isSameTime && isSamePhone) {
          return { appointment: existing, isExisting: true };
        } else {
          const err: any = new Error('Conflict: appointment with externalId exists with a different payload');
          err.statusCode = 409;
          err.code = 'CONFLICT_PAYLOAD_MISMATCH';
          throw err;
        }
      }
    }

    // 1. Acquire per-clinic-per-day slot lock to serialize concurrent bookings
    await SlotLock.findOneAndUpdate(
      { clinicId: clinicObjectId, clinicDate: derivedClinicDate },
      { $inc: { version: 1 } },
      { upsert: true, returnDocument: 'after', session }
    );

    // 2. Overlap Check: [start, end) intersects [existing.start, existing.end)
    const overlap = await Appointment.findOne({
      clinicId: clinicObjectId,
      status: { $in: ['BOOKED', 'CHECKED_IN'] },
      start: { $lt: end },
      end: { $gt: start },
      deletedAt: null,
    }).session(session);

    if (overlap) {
      throw new SlotConflictError(
        `Slot from ${start.toISOString()} to ${end.toISOString()} is already booked by appointment ${overlap._id}`
      );
    }

    // 3. Create Appointment
    const patientObjectId = validated.patientId ? new Types.ObjectId(validated.patientId) : undefined;

    const [appointment] = await Appointment.create(
      [
        {
          clinicId: clinicObjectId,
          patientId: patientObjectId,
          contactName: validated.contactName,
          contactPhone: validated.contactPhone,
          start,
          end,
          clinicDate: derivedClinicDate,
          status: 'BOOKED',
          reason: validated.reason,
          treatmentCode: validated.treatmentCode,
          source: validated.source,
          externalId: validated.externalId,
          notes: validated.notes,
          version: 1,
          schemaVersion: 1,
          createdBy: actor,
        },
      ],
      { session }
    );

    // 4. Audit Log
    const auditAction =
      validated.source === 'MANUAL'
        ? AuditAction.APPOINTMENT_CREATE
        : AuditAction.INTEGRATION_APPOINTMENT_CREATE;

    await AuditLog.create(
      [
        {
          clinicId: clinicObjectId,
          action: auditAction,
          entity: 'Appointment',
          entityId: appointment._id.toString(),
          actor,
          meta: {
            appointmentId: appointment._id.toString(),
            source: validated.source,
            externalId: validated.externalId,
          },
          at: clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    return { appointment, isExisting: false };
  });
}

export async function rescheduleAppointment(
  clinicId: Types.ObjectId | string,
  appointmentId: Types.ObjectId | string,
  input: { start: Date; end?: Date; version: number },
  actor: TenantActor,
  isIntegration = false
): Promise<IAppointment> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      rescheduleAppointment(clinicId, appointmentId, input, actor, isIntegration)
    );
  }

  const appointmentObjectId = new Types.ObjectId(appointmentId);

  const start = input.start;
  const end = input.end || new Date(start.getTime() + DEFAULT_SLOT_MINUTES * 60 * 1000);

  validateSlotGeometry(start, end);
  const derivedClinicDate = clinicDate(start);

  return withTransaction(async (session) => {
    const appointment = await Appointment.findOne({
      clinicId: clinicObjectId,
      _id: appointmentObjectId,
    }).session(session);

    if (!appointment) {
      const err: any = new Error(`Appointment not found: ${appointmentId}`);
      err.statusCode = 404;
      throw err;
    }

    if (appointment.status !== 'BOOKED') {
      const err: any = new Error(`Cannot reschedule appointment with status ${appointment.status}`);
      err.statusCode = 409;
      throw err;
    }

    if (appointment.version !== input.version) {
      const err: any = new Error(
        `Conflict: Appointment was modified by another session (v${appointment.version}). Your edit was based on v${input.version}.`
      );
      err.statusCode = 409;
      throw err;
    }

    // Acquire lock
    await SlotLock.findOneAndUpdate(
      { clinicId: clinicObjectId, clinicDate: derivedClinicDate },
      { $inc: { version: 1 } },
      { upsert: true, returnDocument: 'after', session }
    );

    // Overlap check excluding self
    const overlap = await Appointment.findOne({
      clinicId: clinicObjectId,
      _id: { $ne: appointmentObjectId },
      status: { $in: ['BOOKED', 'CHECKED_IN'] },
      start: { $lt: end },
      end: { $gt: start },
      deletedAt: null,
    }).session(session);

    if (overlap) {
      throw new SlotConflictError(
        `Slot from ${start.toISOString()} to ${end.toISOString()} is already booked by appointment ${overlap._id}`
      );
    }

    appointment.start = start;
    appointment.end = end;
    appointment.clinicDate = derivedClinicDate;
    appointment.version += 1;
    await appointment.save({ session });

    const auditAction = isIntegration
      ? AuditAction.INTEGRATION_APPOINTMENT_RESCHEDULE
      : AuditAction.APPOINTMENT_UPDATE;

    await AuditLog.create(
      [
        {
          clinicId: clinicObjectId,
          action: auditAction,
          entity: 'Appointment',
          entityId: appointment._id.toString(),
          actor,
          meta: {
            appointmentId: appointment._id.toString(),
            changedFields: ['start', 'end', 'clinicDate'],
          },
          at: clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    return appointment;
  });
}

export async function cancelAppointment(
  clinicId: Types.ObjectId | string,
  appointmentId: Types.ObjectId | string,
  reason: string,
  actor: TenantActor,
  isIntegration = false
): Promise<IAppointment> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      cancelAppointment(clinicId, appointmentId, reason, actor, isIntegration)
    );
  }

  const appointmentObjectId = new Types.ObjectId(appointmentId);

  if (!reason || !reason.trim()) {
    const err: any = new Error('A reason is required to cancel an appointment');
    err.statusCode = 422;
    throw err;
  }

  const appointment = await Appointment.findOne({
    clinicId: clinicObjectId,
    _id: appointmentObjectId,
  });

  if (!appointment) {
    const err: any = new Error(`Appointment not found: ${appointmentId}`);
    err.statusCode = 404;
    throw err;
  }

  if (!canTransitionAppointment(appointment.status, 'CANCEL')) {
    const err: any = new Error(`Cannot cancel appointment with status ${appointment.status}`);
    err.statusCode = 409;
    throw err;
  }

  appointment.status = 'CANCELLED';
  appointment.cancelReason = reason.trim();
  appointment.version += 1;
  await appointment.save();

  const auditAction = isIntegration
    ? AuditAction.INTEGRATION_APPOINTMENT_CANCEL
    : AuditAction.APPOINTMENT_CANCEL;

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: auditAction,
    entity: 'Appointment',
    entityId: appointment._id.toString(),
    actor,
    meta: {
      appointmentId: appointment._id.toString(),
      cancelReason: reason.trim(),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return appointment;
}

export async function markAppointmentNoShow(
  clinicId: Types.ObjectId | string,
  appointmentId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IAppointment> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      markAppointmentNoShow(clinicId, appointmentId, actor)
    );
  }

  const appointmentObjectId = new Types.ObjectId(appointmentId);

  const appointment = await Appointment.findOne({
    clinicId: clinicObjectId,
    _id: appointmentObjectId,
  });

  if (!appointment) {
    const err: any = new Error(`Appointment not found: ${appointmentId}`);
    err.statusCode = 404;
    throw err;
  }

  if (!canTransitionAppointment(appointment.status, 'NO_SHOW')) {
    const err: any = new Error(`Cannot mark appointment with status ${appointment.status} as no-show`);
    err.statusCode = 409;
    throw err;
  }

  // Must be in the past
  if (appointment.start.getTime() > clock.now().getTime()) {
    const err: any = new Error('Cannot mark appointment as no-show before scheduled start time');
    err.statusCode = 422;
    throw err;
  }

  appointment.status = 'NO_SHOW';
  appointment.version += 1;
  await appointment.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.APPOINTMENT_NO_SHOW,
    entity: 'Appointment',
    entityId: appointment._id.toString(),
    actor,
    meta: {
      appointmentId: appointment._id.toString(),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return appointment;
}

export interface CheckInAppointmentInput {
  ageYears?: number;
  dob?: string;
  sex?: 'Male' | 'Female' | 'Other';
}

export async function checkInAppointment(
  clinicId: Types.ObjectId | string,
  appointmentId: Types.ObjectId | string,
  unlinkedDetails: CheckInAppointmentInput | undefined,
  actor: TenantActor
): Promise<{ alreadyCheckedIn: boolean; visit: IVisit }> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      checkInAppointment(clinicId, appointmentId, unlinkedDetails, actor)
    );
  }

  const appointmentObjectId = new Types.ObjectId(appointmentId);
  const todayStr = clinicDate(clock.now());

  return withTransaction(async (session) => {
    const appointment = await Appointment.findOne({
      clinicId: clinicObjectId,
      _id: appointmentObjectId,
    }).session(session);

    if (!appointment) {
      const err: any = new Error(`Appointment not found: ${appointmentId}`);
      err.statusCode = 404;
      throw err;
    }

    // Idempotency: if already checked in, return the existing visit
    if (appointment.status === 'CHECKED_IN' && appointment.checkedInVisitId) {
      const existingVisit = await Visit.findById(appointment.checkedInVisitId).session(session);
      if (existingVisit) {
        return { alreadyCheckedIn: true, visit: existingVisit };
      }
    }

    if (appointment.clinicDate !== todayStr) {
      const err: any = new Error(
        `Appointment is scheduled for ${appointment.clinicDate}, but today is ${todayStr}. Appointments can only be checked in on their scheduled day.`
      );
      err.statusCode = 422;
      throw err;
    }

    // Atomic update status BOOKED -> CHECKED_IN
    const updated = await Appointment.findOneAndUpdate(
      {
        clinicId: clinicObjectId,
        _id: appointmentObjectId,
        status: 'BOOKED',
      },
      {
        $set: { status: 'CHECKED_IN' },
        $inc: { version: 1 },
      },
      { session, returnDocument: 'after' }
    );

    if (!updated) {
      // Re-check if another session checked it in concurrently
      const current = await Appointment.findById(appointmentObjectId).session(session);
      if (current?.status === 'CHECKED_IN' && current.checkedInVisitId) {
        const existingVisit = await Visit.findById(current.checkedInVisitId).session(session);
        if (existingVisit) {
          return { alreadyCheckedIn: true, visit: existingVisit };
        }
      }
      const err: any = new Error(`Cannot check in appointment with status ${current?.status || 'UNKNOWN'}`);
      err.statusCode = 409;
      throw err;
    }

    // Resolve patientId
    let patientId = updated.patientId;
    if (!patientId) {
      const normalizedPhone = normalizePhone(updated.contactPhone);
      const existingPatients = await Patient.find({
        clinicId: clinicObjectId,
        phone: normalizedPhone,
        deletedAt: null,
      })
        .select('_id patientCode name phone ageYears dob')
        .lean()
        .session(session);

      const decision = evaluateDuplicate(
        {
          name: updated.contactName,
          phone: updated.contactPhone,
        },
        existingPatients.map((p) => ({
          _id: p._id.toString(),
          patientCode: p.patientCode,
          name: p.name,
          phone: p.phone,
          ageYears: p.ageYears,
          dob: p.dob,
        }))
      );

      if (decision.action === 'RETURNING_PATIENT' && decision.matchedPatientId) {
        patientId = new Types.ObjectId(decision.matchedPatientId);
      } else if (unlinkedDetails && (unlinkedDetails.ageYears !== undefined || unlinkedDetails.dob) && unlinkedDetails.sex) {
        const patientCode = await nextPatientCode(clinicObjectId);
        const [newPatient] = await Patient.create(
          [
            {
              clinicId: clinicObjectId,
              patientCode,
              name: updated.contactName,
              phone: updated.contactPhone,
              sex: unlinkedDetails.sex,
              ageYears: unlinkedDetails.ageYears,
              dob: unlinkedDetails.dob,
              consentAt: clock.now(),
              consentTextVersion: STAFF_REGISTRATION_CONSENT_VERSION,
              possibleDuplicateOf: decision.possibleDuplicateOfId
                ? new Types.ObjectId(decision.possibleDuplicateOfId)
                : undefined,
              createdBy: actor,
            },
          ],
          { session }
        );
        patientId = newPatient._id;
      } else {
        const err: any = new Error(
          'Patient details (sex, and age or date of birth) are required to create a patient record for an unlinked appointment'
        );
        err.statusCode = 422;
        throw err;
      }

      updated.patientId = patientId;
    }

    // Allocate token & create visit
    const token = await nextToken(clinicObjectId, todayStr);

    const [visit] = await Visit.create(
      [
        {
          clinicId: clinicObjectId,
          patientId,
          appointmentId: updated._id,
          date: todayStr,
          token,
          type: 'APPOINTMENT',
          status: 'WAITING',
          checkInAt: clock.now(),
          reasonForVisit: updated.reason,
          caseSheet: {
            chiefComplaint: updated.reason,
            historyOfPresentIllness: '',
            extraOral: '',
            intraOral: '',
            findings: [],
            investigations: [],
            diagnosis: '',
            treatmentPlan: [],
            procedureNotes: '',
            advice: '',
          },
          version: 1,
          schemaVersion: 1,
          createdBy: actor,
        },
      ],
      { session }
    );

    updated.checkedInVisitId = visit._id;
    await updated.save({ session });

    await AuditLog.create(
      [
        {
          clinicId: clinicObjectId,
          action: AuditAction.APPOINTMENT_CHECK_IN,
          entity: 'Appointment',
          entityId: updated._id.toString(),
          actor,
          meta: {
            appointmentId: updated._id.toString(),
            visitId: visit._id.toString(),
            token,
          },
          at: clock.now(),
          createdBy: actor,
        },
      ],
      { session }
    );

    return { alreadyCheckedIn: false, visit };
  });
}

export async function getBusyIntervals(
  clinicId: Types.ObjectId | string,
  from: Date,
  to: Date
): Promise<Array<{ start: string; end: string }>> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor: { type: 'INTEGRATION', id: 'busy' } }, () =>
      getBusyIntervals(clinicId, from, to)
    );
  }

  const diffMs = to.getTime() - from.getTime();
  const maxRangeMs = 31 * 24 * 60 * 60 * 1000; // 31 days

  if (diffMs < 0 || diffMs > maxRangeMs) {
    const err: any = new Error('Date range must be positive and cannot exceed 31 days');
    err.statusCode = 400;
    throw err;
  }

  const appointments = await Appointment.find({
    clinicId: clinicObjectId,
    status: { $in: ['BOOKED', 'CHECKED_IN'] },
    start: { $lt: to },
    end: { $gt: from },
    deletedAt: null,
  })
    .select('start end -_id')
    .sort({ start: 1 });

  return appointments.map((a) => ({
    start: a.start.toISOString(),
    end: a.end.toISOString(),
  }));
}

export interface ListAppointmentsFilter {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  status?: AppointmentStatus;
  source?: AppointmentSource;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listAppointments(
  clinicId: Types.ObjectId | string,
  filter: ListAppointmentsFilter = {}
): Promise<{ appointments: IAppointment[]; total: number; page: number; limit: number }> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor: { type: 'SYSTEM', id: 'reader' } }, () =>
      listAppointments(clinicId, filter)
    );
  }
  const query: Record<string, unknown> = { clinicId: clinicObjectId, deletedAt: null };

  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.source) {
    query.source = filter.source;
  }

  if (filter.dateFrom && filter.dateTo) {
    query.clinicDate = { $gte: filter.dateFrom, $lte: filter.dateTo };
  } else if (filter.dateFrom) {
    query.clinicDate = { $gte: filter.dateFrom };
  } else if (filter.dateTo) {
    query.clinicDate = { $lte: filter.dateTo };
  }

  if (filter.search && filter.search.trim()) {
    const term = filter.search.trim();
    query.$or = [
      { contactName: { $regex: term, $options: 'i' } },
      { contactPhone: { $regex: term } },
    ];
  }

  const page = Math.max(1, filter.page || 1);
  const limit = Math.max(1, Math.min(100, filter.limit || 50));
  const skip = (page - 1) * limit;

  const [appointments, total] = await Promise.all([
    Appointment.find(query).sort({ start: 1 }).skip(skip).limit(limit),
    Appointment.countDocuments(query),
  ]);

  return { appointments, total, page, limit };
}

export async function getAppointment(
  clinicId: Types.ObjectId | string,
  appointmentId: Types.ObjectId | string
): Promise<IAppointment | null> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor: { type: 'SYSTEM', id: 'reader' } }, () =>
      getAppointment(clinicId, appointmentId)
    );
  }
  const appointmentObjectId = new Types.ObjectId(appointmentId);
  return Appointment.findOne({ clinicId: clinicObjectId, _id: appointmentObjectId, deletedAt: null });
}

export async function softDeleteAppointment(
  clinicId: Types.ObjectId | string,
  appointmentId: Types.ObjectId | string,
  actor: TenantActor
): Promise<IAppointment> {
  const clinicObjectId = new Types.ObjectId(clinicId);
  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      softDeleteAppointment(clinicId, appointmentId, actor)
    );
  }
  const appointmentObjectId = new Types.ObjectId(appointmentId);

  const appointment = await Appointment.findOne({ clinicId: clinicObjectId, _id: appointmentObjectId });
  if (!appointment) {
    const err: any = new Error(`Appointment not found: ${appointmentId}`);
    err.statusCode = 404;
    throw err;
  }

  // Soft delete allowed only on never-checked-in appointments
  if (appointment.status === 'CHECKED_IN' || appointment.checkedInVisitId) {
    const err: any = new Error('Cannot delete an appointment that has already been checked in');
    err.statusCode = 409;
    throw err;
  }

  appointment.deletedAt = clock.now();
  await appointment.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.RECORD_DELETE,
    entity: 'Appointment',
    entityId: appointment._id.toString(),
    actor,
    meta: { appointmentId: appointment._id.toString() },
    at: clock.now(),
    createdBy: actor,
  });

  return appointment;
}
