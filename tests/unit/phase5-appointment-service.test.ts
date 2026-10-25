import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { clock } from '@/lib/clock';
import { systemScope, systemAdminScope } from '@/lib/tenancy';
import { Patient } from '@/models/Patient';
import { Appointment } from '@/models/Appointment';
import { SlotLock } from '@/models/SlotLock';
import { Treatment } from '@/models/Treatment';
import {
  validateSlotGeometry,
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  markAppointmentNoShow,
  getBusyIntervals,
  listAppointments,
  getAppointment,
  softDeleteAppointment,
} from '@/lib/appointment-service';

describe('Phase 5: Appointment Service Unit & Edge Coverage Suite', () => {
  const originalNow = clock.now.bind(clock);
  const clinicId = new Types.ObjectId();
  const actor = { type: 'USER' as const, id: 'doctor_appt_test' };
  let testPatient: any;

  // Reference time: 2026-10-26 10:00:00 IST (04:30:00 UTC)
  const testIsoTime = '2026-10-26T04:30:00.000Z';

  beforeAll(async () => {
    await connectDb();
    await systemScope(clinicId, async () => {
      testPatient = await Patient.create({
        clinicId,
        patientCode: 'P-APT-001',
        name: 'Appointment Patient',
        phone: '9822998877',
        sex: 'Female',
        ageYears: 29,
        consentAt: clock.now(),
        consentTextVersion: '1.0-staff',
        createdBy: actor,
      });

      // Active treatment
      await Treatment.create({
        clinicId,
        code: 'RCT-01',
        name: 'Root Canal Treatment',
        category: 'Endodontics',
        unit: 'per tooth',
        idaMin: 1500,
        idaMax: 3000,
        active: true,
        createdBy: actor,
      });

      // Inactive treatment
      await Treatment.create({
        clinicId,
        code: 'INACTIVE-01',
        name: 'Inactive Treatment',
        category: 'Other',
        unit: 'per tooth',
        idaMin: 1500,
        idaMax: 3000,
        active: false,
        createdBy: actor,
      });
    });
  });

  afterAll(async () => {
    (clock as any).now = originalNow;
    await systemScope(clinicId, async () => {
      await Appointment.deleteMany({});
      await SlotLock.deleteMany({});
      await Patient.deleteMany({});
      await Treatment.deleteMany({});
    });
  });

  beforeEach(async () => {
    (clock as any).now = () => new Date(testIsoTime);
    await systemScope(clinicId, async () => {
      await Appointment.deleteMany({});
      await SlotLock.deleteMany({});
    });
  });

  it('validates slot geometry correctly across all edge constraints', () => {
    // 1. start >= end
    expect(() =>
      validateSlotGeometry(new Date('2026-10-26T05:00:00.000Z'), new Date('2026-10-26T04:30:00.000Z'))
    ).toThrow(/start time must be before end time/);

    // 2. duration not multiple of 30 mins
    expect(() =>
      validateSlotGeometry(new Date('2026-10-26T05:00:00.000Z'), new Date('2026-10-26T05:45:00.000Z'))
    ).toThrow(/duration must be a multiple/);

    // 3. start off the 30-min grid
    expect(() =>
      validateSlotGeometry(new Date('2026-10-26T05:15:00.000Z'), new Date('2026-10-26T05:45:00.000Z'))
    ).toThrow(/start must be aligned to the 30-minute grid/);

    // 4. start in the past
    expect(() =>
      validateSlotGeometry(new Date('2026-10-25T05:00:00.000Z'), new Date('2026-10-25T05:30:00.000Z'))
    ).toThrow(/cannot be scheduled in the past/);

    // 5. start before clinic open (09:00 IST is 03:30 UTC; test 08:30 IST / 03:00 UTC on tomorrow)
    expect(() =>
      validateSlotGeometry(new Date('2026-10-27T03:00:00.000Z'), new Date('2026-10-27T03:30:00.000Z'))
    ).toThrow(/within clinic hours/);

    // 6. end after clinic close (20:00 IST is 14:30 UTC; test 20:30 IST / 15:00 UTC)
    expect(() =>
      validateSlotGeometry(new Date('2026-10-26T14:30:00.000Z'), new Date('2026-10-26T15:00:00.000Z'))
    ).toThrow(/within clinic hours/);

    // Valid slot (11:00 to 11:30 AM IST = 05:30 to 06:00 UTC)
    expect(() =>
      validateSlotGeometry(new Date('2026-10-26T05:30:00.000Z'), new Date('2026-10-26T06:00:00.000Z'))
    ).not.toThrow();
  });

  it('rejects appointments with inactive or non-existent treatmentCode', async () => {
    // Non-existent treatmentCode
    await expect(
      createAppointment(
        clinicId,
        {
          contactName: 'Treatment Test',
          contactPhone: '9822001122',
          start: new Date('2026-10-26T05:30:00.000Z'),
          reason: 'RCT check',
          treatmentCode: 'NON-EXISTENT',
        },
        actor
      )
    ).rejects.toMatchObject({ statusCode: 422 });

    // Inactive treatmentCode
    await expect(
      createAppointment(
        clinicId,
        {
          contactName: 'Treatment Test 2',
          contactPhone: '9822001122',
          start: new Date('2026-10-26T05:30:00.000Z'),
          reason: 'Inactive check',
          treatmentCode: 'INACTIVE-01',
        },
        actor
      )
    ).rejects.toMatchObject({ statusCode: 422 });

    // Active treatmentCode succeeds!
    const { appointment } = await createAppointment(
      clinicId,
      {
        contactName: 'Valid Treatment Patient',
        contactPhone: '9822001122',
        start: new Date('2026-10-26T05:30:00.000Z'),
        reason: 'RCT Consultation',
        treatmentCode: 'RCT-01',
      },
      actor
    );
    expect(appointment.treatmentCode).toBe('RCT-01');
  });

  it('exercises error paths: reschedule, cancel, no-show, soft-delete with non-existent IDs', async () => {
    const fakeId = new Types.ObjectId();

    // 1. Reschedule non-existent
    await expect(
      rescheduleAppointment(
        clinicId,
        fakeId,
        { start: new Date('2026-10-26T06:00:00.000Z'), version: 1 },
        actor
      )
    ).rejects.toMatchObject({ statusCode: 404 });

    // 2. Cancel non-existent
    await expect(
      cancelAppointment(clinicId, fakeId, 'Reason', actor)
    ).rejects.toMatchObject({ statusCode: 404 });

    // 3. Mark no-show non-existent
    await expect(
      markAppointmentNoShow(clinicId, fakeId, actor)
    ).rejects.toMatchObject({ statusCode: 404 });

    // 4. Soft delete non-existent
    await expect(
      softDeleteAppointment(clinicId, fakeId, actor)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('enforces cancellation, no-show, and soft-delete state constraints', async () => {
    // Create appointment
    const { appointment } = await createAppointment(
      clinicId,
      {
        contactName: 'Constraint Patient',
        contactPhone: '9822119900',
        start: new Date('2026-10-26T06:30:00.000Z'),
        reason: 'Check constraints',
      },
      actor
    );

    // Cancel without reason throws 422
    await expect(
      cancelAppointment(clinicId, appointment._id, '', actor)
    ).rejects.toMatchObject({ statusCode: 422 });

    // Cannot mark no-show before scheduled start time (test reference time is 04:30 UTC, appointment is 06:30 UTC)
    await expect(
      markAppointmentNoShow(clinicId, appointment._id, actor)
    ).rejects.toMatchObject({ statusCode: 422 });

    // Advance clock past appointment start (07:00 UTC)
    (clock as any).now = () => new Date('2026-10-26T07:00:00.000Z');

    // Mark as no-show
    const noShowAppt = await markAppointmentNoShow(clinicId, appointment._id, actor);
    expect(noShowAppt.status).toBe('NO_SHOW');

    // Cannot reschedule an appointment with status NO_SHOW -> throws 409
    await expect(
      rescheduleAppointment(
        clinicId,
        appointment._id,
        { start: new Date('2026-10-26T08:00:00.000Z'), version: noShowAppt.version },
        actor
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    // Cannot cancel an appointment with status NO_SHOW -> throws 409
    await expect(
      cancelAppointment(clinicId, appointment._id, 'Reason', actor)
    ).rejects.toMatchObject({ statusCode: 409 });

    // Soft delete allowed on never-checked-in appointment
    const deleted = await softDeleteAppointment(clinicId, appointment._id, actor);
    expect(deleted.deletedAt).toBeDefined();
  });

  it('validates getBusyIntervals input and bounds', async () => {
    // Inverted range (from > to)
    await expect(
      getBusyIntervals(
        clinicId,
        new Date('2026-10-27T00:00:00.000Z'),
        new Date('2026-10-26T00:00:00.000Z')
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    // Range exceeding 31 days
    await expect(
      getBusyIntervals(
        clinicId,
        new Date('2026-10-01T00:00:00.000Z'),
        new Date('2026-11-15T00:00:00.000Z')
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    // Valid range
    const intervals = await getBusyIntervals(
      clinicId,
      new Date('2026-10-26T00:00:00.000Z'),
      new Date('2026-10-27T00:00:00.000Z')
    );
    expect(Array.isArray(intervals)).toBe(true);
  });

  it('exercises listAppointments filters and getAppointment', async () => {
    const { appointment } = await createAppointment(
      clinicId,
      {
        contactName: 'Listing Test Patient',
        contactPhone: '9822118833',
        start: new Date('2026-10-26T08:30:00.000Z'),
        reason: 'General checkup',
        source: 'MANUAL',
      },
      actor
    );

    // 1. getAppointment
    const fetched = await getAppointment(clinicId, appointment._id);
    expect(fetched).not.toBeNull();
    expect(fetched!.contactName).toBe('Listing Test Patient');

    // 2. listAppointments with various filters
    const list1 = await listAppointments(clinicId, {
      status: 'BOOKED',
      source: 'MANUAL',
      search: 'Listing',
      page: 1,
      limit: 10,
    });
    expect(list1.appointments).toHaveLength(1);
    expect(list1.total).toBe(1);

    // Filter with date range
    const list2 = await listAppointments(clinicId, {
      dateFrom: '2026-10-26',
      dateTo: '2026-10-26',
    });
    expect(list2.appointments.length).toBeGreaterThanOrEqual(1);

    // Search by phone
    const list3 = await listAppointments(clinicId, {
      search: '9822118833',
    });
    expect(list3.appointments).toHaveLength(1);
  });
});
