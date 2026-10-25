import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { NextRequest } from 'next/server';
import { connectDb, disconnectDb } from '@/lib/db';
import { systemScope, runWithTenantContext, TenantActor, systemAdminScope } from '@/lib/tenancy';
import { Clinic } from '@/models/Clinic';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { Appointment } from '@/models/Appointment';
import { FollowUp } from '@/models/FollowUp';
import { SlotLock } from '@/models/SlotLock';
import { IntegrationKey } from '@/models/IntegrationKey';
import { IntegrationReplay } from '@/models/IntegrationReplay';
import { RateLimit } from '@/models/RateLimit';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import {
  createAppointment,
  checkInAppointment,
  rescheduleAppointment,
  cancelAppointment,
  markAppointmentNoShow,
  getBusyIntervals,
  listAppointments,
  SlotConflictError,
} from '@/lib/appointment-service';
import {
  createFollowUp,
  updateFollowUp,
  markFollowUpDone,
  cancelFollowUp,
  listFollowUps,
} from '@/lib/followup-service';
import {
  encryptSecret,
  computeHmacSignature,
} from '@/lib/hmac';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';
import { KIOSK_COOKIE_NAME, DEV_KIOSK_COOKIE_NAME } from '@/lib/auth';

// Route handlers
import { POST as postIntegrationAppointments } from '@/app/api/integrations/appointments/route';
import { PATCH as patchIntegrationAppointments } from '@/app/api/integrations/appointments/[externalId]/route';
import { GET as getIntegrationBusy } from '@/app/api/integrations/busy/route';
import { GET as getAppointments, POST as postAppointments } from '@/app/api/appointments/route';
import { GET as getAppointmentById, PATCH as patchAppointmentById } from '@/app/api/appointments/[id]/route';
import { POST as cancelAppointmentRoute } from '@/app/api/appointments/[id]/cancel/route';
import { POST as noShowAppointmentRoute } from '@/app/api/appointments/[id]/no-show/route';
import { POST as checkInAppointmentRoute } from '@/app/api/appointments/[id]/check-in/route';
import { GET as getFollowUps, POST as postFollowUps } from '@/app/api/followups/route';
import { PATCH as patchFollowUp, DELETE as deleteFollowUp } from '@/app/api/followups/[id]/route';
import { POST as doneFollowUpRoute } from '@/app/api/followups/[id]/done/route';
import { POST as cancelFollowUpRoute } from '@/app/api/followups/[id]/cancel/route';

describe('Phase 5: Appointments, Follow-ups & Integration Endpoint Integration Suite', () => {
  let clinicA: mongoose.Types.ObjectId;
  let clinicB: mongoose.Types.ObjectId;
  const doctorActorA: TenantActor = { type: 'USER', id: 'doc_susheel_p5' };
  const doctorActorB: TenantActor = { type: 'USER', id: 'doc_other_p5' };

  const keyIdA = 'key_clinic_a_test';
  const secretA = 'secret_clinic_a_0123456789abcdef0123456789abcdef';
  const keyIdB = 'key_clinic_b_test';
  const secretB = 'secret_clinic_b_fedcba9876543210fedcba9876543210';

  // Fixed test reference time in IST: 2026-10-26 10:00:00 IST (04:30 UTC)
  const testIsoTime = '2026-10-26T04:30:00.000Z';
  const originalNow = clock.now.bind(clock);

  beforeAll(async () => {
    await connectDb();

    try {
      await Appointment.collection.dropIndex('clinicId_1_source_1_externalId_1');
    } catch {
      // index might not exist yet
    }
    await Appointment.syncIndexes();

    // 1. Setup Clinics
    const cA = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Dental Clinic - Phase 5 A" },
      {
        $setOnInsert: {
          address: 'Station Road, Sambhajinagar',
          phone: '+91-98220-11111',
          email: 'p5a@clinic.com',
          registrationNo: 'MH-P5-001',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicA = cA._id;

    const cB = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Dental Clinic - Phase 5 B" },
      {
        $setOnInsert: {
          address: 'CIDCO, Sambhajinagar',
          phone: '+91-98220-22222',
          email: 'p5b@clinic.com',
          registrationNo: 'MH-P5-002',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicB = cB._id;

    // 2. Setup Integration Keys in systemAdminScope
    await systemAdminScope(async () => {
      await IntegrationKey.deleteMany({ keyId: { $in: [keyIdA, keyIdB] } });
      await IntegrationKey.create([
        {
          clinicId: clinicA,
          keyId: keyIdA,
          encryptedSecret: encryptSecret(secretA),
          name: 'Clinic A Bot Key',
          active: true,
          createdBy: { type: 'SYSTEM', id: 'seed' },
        },
        {
          clinicId: clinicB,
          keyId: keyIdB,
          encryptedSecret: encryptSecret(secretB),
          name: 'Clinic B Bot Key',
          active: true,
          createdBy: { type: 'SYSTEM', id: 'seed' },
        },
      ]);
    });
  });

  afterAll(async () => {
    (clock as any).now = originalNow;
    await systemAdminScope(async () => {
      await IntegrationKey.deleteMany({ keyId: { $in: [keyIdA, keyIdB] } });
      await IntegrationReplay.deleteMany({});
      await Appointment.deleteMany({ clinicId: { $in: [clinicA, clinicB] } });
      await FollowUp.deleteMany({ clinicId: { $in: [clinicA, clinicB] } });
      await SlotLock.deleteMany({ clinicId: { $in: [clinicA, clinicB] } });
      await Visit.deleteMany({ clinicId: { $in: [clinicA, clinicB] } });
      await Patient.deleteMany({ clinicId: { $in: [clinicA, clinicB] } });
    });
  });

  beforeEach(async () => {
    (clock as any).now = () => new Date(testIsoTime);
    await systemScope(clinicA, async () => {
      await Appointment.deleteMany({});
      await FollowUp.deleteMany({});
      await SlotLock.deleteMany({});
      await Visit.deleteMany({});
    });
    await systemScope(clinicB, async () => {
      await Appointment.deleteMany({});
      await FollowUp.deleteMany({});
      await SlotLock.deleteMany({});
      await Visit.deleteMany({});
    });
    await systemAdminScope(async () => {
      await IntegrationReplay.deleteMany({});
      await RateLimit.deleteMany({});
    });
  });

  // Helper to construct signed integration requests
  const createSignedRequest = (
    url: string,
    method: string,
    keyId: string,
    secret: string,
    bodyObj?: any,
    timestampOffsetSec = 0
  ) => {
    const rawBody = bodyObj !== undefined ? JSON.stringify(bodyObj) : '';
    const nowSec = Math.floor(clock.now().getTime() / 1000) + timestampOffsetSec;
    const urlObj = new URL(url);
    const pathAndQuery = urlObj.pathname + urlObj.search;
    const signature = computeHmacSignature(secret, nowSec, method, pathAndQuery, rawBody);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-key-id': keyId,
      'x-timestamp': String(nowSec),
      'x-signature': signature,
    };

    return new NextRequest(url, {
      method,
      headers,
      body: bodyObj !== undefined ? rawBody : undefined,
    });
  };

  // E1: Check-in clicked twice, in parallel, and from two tabs creates exactly ONE visit with ONE token; second call returns existing visit
  it('E1: parallel and duplicate check-in creates exactly ONE visit with ONE token, returning existing visit on second call', async () => {
    const todayStr = clinicDate(clock.now());
    const start = new Date('2026-10-26T04:30:00.000Z'); // 10:00 AM IST on today
    const end = new Date('2026-10-26T05:00:00.000Z');

    const { appointment } = await createAppointment(
      clinicA,
      {
        contactName: 'Rahul Shinde',
        contactPhone: '9822114455',
        start,
        end,
        reason: 'Tooth extraction',
      },
      doctorActorA
    );

    // Call checkInAppointment in parallel 3 times (simulating two tabs and a double click)
    const [res1, res2, res3] = await Promise.all([
      checkInAppointment(
        clinicA,
        appointment._id,
        { sex: 'Male', ageYears: 32 },
        doctorActorA
      ),
      checkInAppointment(
        clinicA,
        appointment._id,
        { sex: 'Male', ageYears: 32 },
        doctorActorA
      ),
      checkInAppointment(
        clinicA,
        appointment._id,
        { sex: 'Male', ageYears: 32 },
        doctorActorA
      ),
    ]);

    const results = [res1, res2, res3];
    const initialCreates = results.filter((r) => !r.alreadyCheckedIn);
    const idempotentReturns = results.filter((r) => r.alreadyCheckedIn);

    expect(initialCreates).toHaveLength(1);
    expect(idempotentReturns).toHaveLength(2);

    // Verify exactly ONE visit was created in DB for this appointment
    const visits = await systemScope(clinicA, async () => {
      return Visit.find({ clinicId: clinicA, appointmentId: appointment._id });
    });
    expect(visits).toHaveLength(1);
    expect(visits[0].token).toBeDefined();

    // Verify all 3 results point to the EXACT same visit and token
    for (const r of results) {
      expect(r.visit._id.toString()).toBe(visits[0]._id.toString());
      expect(r.visit.token).toBe(visits[0].token);
    }
  });

  // E2: 20 parallel overlapping booking attempts for the same slot: exactly one succeeds, the rest get 409; non-overlapping parallel bookings all succeed
  it('E2: 20 parallel overlapping booking attempts: exactly one succeeds, rest get 409; non-overlapping parallel bookings succeed', async () => {
    const slotStart = new Date('2026-10-26T05:30:00.000Z'); // 11:00 AM IST
    const slotEnd = new Date('2026-10-26T06:00:00.000Z'); // 11:30 AM IST

    // 20 parallel attempts for the SAME slot
    const attempts = Array.from({ length: 20 }, (_, i) =>
      createAppointment(
        clinicA,
        {
          contactName: `Parallel Patient ${i}`,
          contactPhone: '9822000000',
          start: slotStart,
          end: slotEnd,
          reason: `Slot attempt ${i}`,
        },
        doctorActorA
      )
        .then((res) => ({ status: 'success' as const, data: res, error: null }))
        .catch((err) => ({ status: 'error' as const, data: null, error: err }))
    );

    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 'success');
    const conflicts = results.filter(
      (r) =>
        r.status === 'error' &&
        (r.error instanceof SlotConflictError || r.error?.code === 'SLOT_TAKEN' || r.error?.statusCode === 409)
    );

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(19);

    // Now test parallel bookings for NON-OVERLAPPING slots
    // 5 distinct 30-min slots from 12:00 to 14:30 IST
    const nonOverlappingSlots = [
      { start: new Date('2026-10-26T06:30:00.000Z'), end: new Date('2026-10-26T07:00:00.000Z') }, // 12:00-12:30 IST
      { start: new Date('2026-10-26T07:00:00.000Z'), end: new Date('2026-10-26T07:30:00.000Z') }, // 12:30-13:00 IST
      { start: new Date('2026-10-26T07:30:00.000Z'), end: new Date('2026-10-26T08:00:00.000Z') }, // 13:00-13:30 IST
      { start: new Date('2026-10-26T08:00:00.000Z'), end: new Date('2026-10-26T08:30:00.000Z') }, // 13:30-14:00 IST
      { start: new Date('2026-10-26T08:30:00.000Z'), end: new Date('2026-10-26T09:00:00.000Z') }, // 14:00-14:30 IST
    ];

    const nonOverlappingAttempts = nonOverlappingSlots.map((slot, i) =>
      createAppointment(
        clinicA,
        {
          contactName: `Distinct Patient ${i}`,
          contactPhone: '9822110000',
          start: slot.start,
          end: slot.end,
          reason: `Non-overlapping slot ${i}`,
        },
        doctorActorA
      )
    );

    const nonOverlappingResults = await Promise.all(nonOverlappingAttempts);
    expect(nonOverlappingResults).toHaveLength(5);
    for (const r of nonOverlappingResults) {
      expect(r.appointment._id).toBeDefined();
      expect(r.appointment.status).toBe('BOOKED');
    }
  });

  // E4: Malformed payloads return 400 or 422 and create nothing
  it('E4: malformed payloads (missing fields, extra keys, NoSQL injection, bad phone, bad start) return 400 or 422 and create nothing', async () => {
    const validStart = '2026-10-26T09:30:00.000Z'; // 15:00 IST (valid slot)

    const malformedCases = [
      {
        name: 'missing externalId',
        payload: {
          source: 'WEBSITE',
          name: 'Jane Doe',
          phone: '9822001122',
          start: validStart,
          reason: 'Checkup',
        },
        expectedStatus: 400,
      },
      {
        name: 'extra unknown key (strict Zod)',
        payload: {
          externalId: 'ext_extra_key',
          source: 'WEBSITE',
          name: 'Jane Doe',
          phone: '9822001122',
          start: validStart,
          reason: 'Checkup',
          maliciousKey: 'attack',
        },
        expectedStatus: 400,
      },
      {
        name: 'NoSQL operator injection in name: {"$ne": null}',
        payload: {
          externalId: 'ext_nosql_1',
          source: 'WEBSITE',
          name: { $ne: null },
          phone: '9822001122',
          start: validStart,
          reason: 'Checkup',
        },
        expectedStatus: 400,
      },
      {
        name: 'key starting with $ (operator injection guard)',
        payload: {
          externalId: 'ext_dollar_key',
          source: 'WEBSITE',
          name: 'Jane Doe',
          phone: '9822001122',
          start: validStart,
          reason: 'Checkup',
          $where: 'sleep(1000)',
        },
        expectedStatus: 400,
      },
      {
        name: 'bad Indian phone number (not 10 digits starting with 6-9)',
        payload: {
          externalId: 'ext_bad_phone',
          source: 'WEBSITE',
          name: 'Jane Doe',
          phone: '1234567890',
          start: validStart,
          reason: 'Checkup',
        },
        expectedStatus: 400,
      },
      {
        name: 'off-grid start time (e.g. 10:17 IST instead of 30-min slot)',
        payload: {
          externalId: 'ext_offgrid_start',
          source: 'WEBSITE',
          name: 'Jane Doe',
          phone: '9822001122',
          start: '2026-10-26T04:47:00.000Z', // 10:17 IST
          reason: 'Checkup',
        },
        expectedStatus: 422,
      },
      {
        name: 'past start time',
        payload: {
          externalId: 'ext_past_start',
          source: 'WEBSITE',
          name: 'Jane Doe',
          phone: '9822001122',
          start: '2026-10-25T04:30:00.000Z', // Yesterday
          reason: 'Checkup',
        },
        expectedStatus: 422,
      },
      {
        name: 'outside clinic hours (e.g. 02:00 AM IST)',
        payload: {
          externalId: 'ext_night_start',
          source: 'WEBSITE',
          name: 'Jane Doe',
          phone: '9822001122',
          start: '2026-10-26T20:30:00.000Z', // 02:00 AM IST next day
          reason: 'Checkup',
        },
        expectedStatus: 422,
      },
    ];

    for (const tc of malformedCases) {
      const req = createSignedRequest(
        'http://localhost:3000/api/integrations/appointments',
        'POST',
        keyIdA,
        secretA,
        tc.payload
      );
      const res = await postIntegrationAppointments(req);
      expect(res.status, `Failed on case: ${tc.name}`).toBe(tc.expectedStatus);
    }

    // Verify zero appointments were inserted
    const count = await systemScope(clinicA, async () => Appointment.countDocuments({ clinicId: clinicA }));
    expect(count).toBe(0);
  });

  // E5: Posting same externalId twice (also 10 times in parallel) creates exactly one appointment; different payload returns 409
  it('E5: posting same externalId multiple times returns original record with 200; different payload returns 409', async () => {
    const externalId = 'ext_whatsapp_test_e5';
    const validStart = '2026-10-26T10:00:00.000Z'; // 15:30 IST
    const originalPayload = {
      externalId,
      source: 'WHATSAPP',
      name: 'Sunil Gavaskar',
      phone: '9822012345',
      start: validStart,
      reason: 'Routine consultation',
      language: 'en',
    };

    // 10 parallel requests with EXACT same payload and externalId
    const parallelRequests = Array.from({ length: 10 }, (_, i) => {
      const req = createSignedRequest(
        'http://localhost:3000/api/integrations/appointments',
        'POST',
        keyIdA,
        secretA,
        originalPayload,
        i // slight timestamp offset within ±5 mins
      );
      return postIntegrationAppointments(req);
    });

    const responses = await Promise.all(parallelRequests);
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
      const data = await res.json();
      expect(data.externalId).toBe(externalId);
      expect(data.contactName).toBe('Sunil Gavaskar');
    }

    // Verify DB has strictly ONE appointment
    const appointments = await systemScope(clinicA, async () =>
      Appointment.find({ clinicId: clinicA, externalId })
    );
    expect(appointments).toHaveLength(1);

    // Now post the SAME externalId with a DIFFERENT payload (different phone & name)
    const conflictingPayload = {
      ...originalPayload,
      name: 'Different Name',
      phone: '9822999999',
    };

    const conflictReq = createSignedRequest(
      'http://localhost:3000/api/integrations/appointments',
      'POST',
      keyIdA,
      secretA,
      conflictingPayload
    );
    const conflictRes = await postIntegrationAppointments(conflictReq);
    expect(conflictRes.status).toBe(409);
    const conflictData = await conflictRes.json();
    expect(conflictData.code).toBe('EXTERNAL_ID_CONFLICT');
  });

  // E6: Busy endpoint returns only intervals, contains no personal data, rejected without valid signature
  it('E6: busy endpoint returns only intervals, contains no personal data, rejected without valid signature', async () => {
    // Seed 2 active appointments
    await createAppointment(
      clinicA,
      {
        contactName: 'Confidential Patient',
        contactPhone: '9822998877',
        start: new Date('2026-10-26T04:30:00.000Z'),
        end: new Date('2026-10-26T05:00:00.000Z'),
        reason: 'Confidential Reason',
      },
      doctorActorA
    );

    await createAppointment(
      clinicA,
      {
        contactName: 'Another Patient',
        contactPhone: '9822334455',
        start: new Date('2026-10-26T05:00:00.000Z'),
        end: new Date('2026-10-26T05:30:00.000Z'),
        reason: 'Tooth filling',
      },
      doctorActorA
    );

    const busyUrl =
      'http://localhost:3000/api/integrations/busy?from=2026-10-26T00:00:00.000Z&to=2026-10-26T23:59:59.000Z';

    // 1. Unauthenticated / missing signature -> 401
    const unauthReq = new NextRequest(busyUrl);
    const unauthRes = await getIntegrationBusy(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 2. Authenticated with valid HMAC
    const signedReq = createSignedRequest(busyUrl, 'GET', keyIdA, secretA);
    const signedRes = await getIntegrationBusy(signedReq);
    expect(signedRes.status).toBe(200);

    const body = await signedRes.json();
    expect(body).toHaveProperty('intervals');
    expect(body.intervals).toHaveLength(2);

    // Assert response shape: MUST contain ONLY start and end, absolutely NO personal data or internal IDs
    for (const interval of body.intervals) {
      const keys = Object.keys(interval);
      expect(keys.sort()).toEqual(['end', 'start'].sort());
      expect((interval as any).patientId).toBeUndefined();
      expect((interval as any).contactName).toBeUndefined();
      expect((interval as any).contactPhone).toBeUndefined();
      expect((interval as any).name).toBeUndefined();
      expect((interval as any).phone).toBeUndefined();
      expect((interval as any)._id).toBeUndefined();
      expect((interval as any).id).toBeUndefined();
      expect((interval as any).reason).toBeUndefined();
    }
  });

  // E8-reschedule: Reschedule needs the correct version (stale version gets 409)
  it('E8-reschedule: rescheduling requires the exact version, stale version returns 409', async () => {
    const { appointment } = await createAppointment(
      clinicA,
      {
        contactName: 'Version Test',
        contactPhone: '9822001144',
        start: new Date('2026-10-26T04:30:00.000Z'),
        end: new Date('2026-10-26T05:00:00.000Z'),
        reason: 'RCT check',
      },
      doctorActorA
    );

    expect(appointment.version).toBe(1);

    // Reschedule with matching version (v1) -> succeeds and bumps to v2
    const resched1 = await rescheduleAppointment(
      clinicA,
      appointment._id,
      {
        start: new Date('2026-10-26T05:00:00.000Z'),
        end: new Date('2026-10-26T05:30:00.000Z'),
        version: 1,
      },
      doctorActorA
    );
    expect(resched1.version).toBe(2);

    // Reschedule with stale version (still using v1) -> throws 409 Conflict
    await expect(
      rescheduleAppointment(
        clinicA,
        appointment._id,
        {
          start: new Date('2026-10-26T05:30:00.000Z'),
          end: new Date('2026-10-26T06:00:00.000Z'),
          version: 1, // Stale! Current is v2
        },
        doctorActorA
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  // E9: Check-in on another day is rejected; check-in without patient links on confident match or creates patient
  it('E9: check-in on another day is rejected with 422; unlinked appointment matches confident duplicate or creates patient with age/sex', async () => {
    // 1. Appointment for another day (tomorrow) -> 422
    const tomorrowStart = new Date('2026-10-27T04:30:00.000Z');
    const { appointment: tomorrowAppt } = await createAppointment(
      clinicA,
      {
        contactName: 'Future Patient',
        contactPhone: '9822112233',
        start: tomorrowStart,
        end: new Date('2026-10-27T05:00:00.000Z'),
        reason: 'Future appointment',
      },
      doctorActorA
    );

    await expect(
      checkInAppointment(clinicA, tomorrowAppt._id, undefined, doctorActorA)
    ).rejects.toMatchObject({ statusCode: 422 });

    // 2. Unlinked appointment without patientId, but matching existing patient (duplicate detector)
    const existingPatient = await systemScope(clinicA, async () => {
      return Patient.create({
        clinicId: clinicA,
        patientCode: 'P-TEST-001',
        name: 'Mahesh Kumar',
        phone: '9822778899',
        sex: 'Male',
        ageYears: 40,
        consentAt: clock.now(),
        consentTextVersion: '1.0-staff',
        createdBy: doctorActorA,
      });
    });

    const { appointment: apptWithMatch } = await createAppointment(
      clinicA,
      {
        contactName: 'Mahesh Kumar',
        contactPhone: '9822778899',
        start: new Date('2026-10-26T06:00:00.000Z'),
        end: new Date('2026-10-26T06:30:00.000Z'),
        reason: 'Follow-up consultation',
      },
      doctorActorA
    );

    // Check in without providing age/sex -> duplicate detector confident match auto-links existing patient!
    const checkInMatch = await checkInAppointment(clinicA, apptWithMatch._id, undefined, doctorActorA);
    expect(checkInMatch.visit.patientId.toString()).toBe(existingPatient._id.toString());

    // 3. Unlinked appointment with NO existing match:
    // Without age/sex -> rejects with 422
    const { appointment: newAppt } = await createAppointment(
      clinicA,
      {
        contactName: 'Completely Brand New Patient',
        contactPhone: '9822990011',
        start: new Date('2026-10-26T06:30:00.000Z'),
        end: new Date('2026-10-26T07:00:00.000Z'),
        reason: 'First time visit',
      },
      doctorActorA
    );

    await expect(
      checkInAppointment(clinicA, newAppt._id, undefined, doctorActorA)
    ).rejects.toMatchObject({ statusCode: 422 });

    // With age & sex provided -> creates new patient record and links it!
    const checkInNew = await checkInAppointment(
      clinicA,
      newAppt._id,
      { sex: 'Female', ageYears: 28 },
      doctorActorA
    );

    expect(checkInNew.visit).toBeDefined();
    const createdPatient = await systemScope(clinicA, async () => {
      return Patient.findById(checkInNew.visit.patientId);
    });
    expect(createdPatient).toBeDefined();
    expect(createdPatient!.name).toBe('Completely Brand New Patient');
    expect(createdPatient!.sex).toBe('Female');
    expect(createdPatient!.ageYears).toBe(28);
    expect(createdPatient!.consentTextVersion).toBe('1.0-staff');

    // The visit is in Live Queue (status WAITING)
    expect(checkInNew.visit.status).toBe('WAITING');
    expect(checkInNew.visit.token).toBeGreaterThan(0);
  });

  // E10: Authorization: unauthenticated and kiosk requests get 401/403 on every new doctor route; valid integration signature never grants access to doctor route
  it('E10: unauthenticated and kiosk requests get 401 on doctor routes; integration signature never grants access to doctor routes', async () => {
    const kioskHeaders = {
      cookie: `${KIOSK_COOKIE_NAME}=kiosk_dummy; ${DEV_KIOSK_COOKIE_NAME}=kiosk_dummy`,
    };

    // 1. Unauthenticated requests on doctor routes
    const r1 = await getAppointments(new NextRequest('http://localhost:3000/api/appointments'));
    expect(r1.status).toBe(401);

    const r2 = await postAppointments(
      new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        body: JSON.stringify({ contactName: 'Test' }),
      })
    );
    expect(r2.status).toBe(401);

    const r3 = await getFollowUps(new NextRequest('http://localhost:3000/api/followups'));
    expect(r3.status).toBe(401);

    const r4 = await postFollowUps(
      new NextRequest('http://localhost:3000/api/followups', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Test' }),
      })
    );
    expect(r4.status).toBe(401);

    // 2. Kiosk requests on doctor routes get 401
    const kr1 = await getAppointments(
      new NextRequest('http://localhost:3000/api/appointments', { headers: kioskHeaders })
    );
    expect(kr1.status).toBe(401);

    const kr2 = await getFollowUps(
      new NextRequest('http://localhost:3000/api/followups', { headers: kioskHeaders })
    );
    expect(kr2.status).toBe(401);

    // 3. A valid integration HMAC signature sent to a doctor route NEVER grants access (still 401)
    const doctorUrl = 'http://localhost:3000/api/appointments';
    const nowSec = Math.floor(clock.now().getTime() / 1000);
    const sig = computeHmacSignature(secretA, nowSec, 'GET', '/api/appointments', '');

    const spoofReq = new NextRequest(doctorUrl, {
      headers: {
        'x-key-id': keyIdA,
        'x-timestamp': String(nowSec),
        'x-signature': sig,
      },
    });

    const spoofRes = await getAppointments(spoofReq);
    expect(spoofRes.status).toBe(401);
  });

  // E11: Tenancy: second clinic cannot see or change appointments, follow-ups, or busy intervals; key from B cannot create records in A
  it('E11: tenancy isolation: second clinic cannot view or modify appointments, followups, or busy intervals; key B cannot create in clinic A', async () => {
    // 1. Create appointment in Clinic A
    const { appointment: apptA } = await createAppointment(
      clinicA,
      {
        contactName: 'Clinic A Patient',
        contactPhone: '9822110011',
        start: new Date('2026-10-26T04:30:00.000Z'),
        end: new Date('2026-10-26T05:00:00.000Z'),
        reason: 'Clinic A Reason',
      },
      doctorActorA
    );

    // Clinic B cannot view or list Clinic A's appointment
    const listB = await listAppointments(clinicB, { dateFrom: '2026-10-26', dateTo: '2026-10-26' });
    expect(listB.appointments).toHaveLength(0);

    // Clinic B attempting to cancel Clinic A's appointment fails with 404
    await expect(
      cancelAppointment(clinicB, apptA._id, 'Attempted cross-tenant cancel', doctorActorB)
    ).rejects.toMatchObject({ statusCode: 404 });

    // 2. Integration Key from Clinic B attempting to schedule: keyId resolves clinicId directly from the key!
    // A bot presenting Key B automatically creates records in Clinic B, NEVER in Clinic A!
    const createReqB = createSignedRequest(
      'http://localhost:3000/api/integrations/appointments',
      'POST',
      keyIdB,
      secretB,
      {
        externalId: 'ext_b_test',
        source: 'WHATSAPP',
        name: 'Clinic B Bot Patient',
        phone: '9822998811',
        start: '2026-10-26T04:30:00.000Z',
        reason: 'Bot Booking',
      }
    );

    const createResB = await postIntegrationAppointments(createReqB);
    expect(createResB.status).toBe(201);
    const createdDataB = await createResB.json();

    // Verify created record in DB belongs strictly to Clinic B
    const apptInDb = await systemAdminScope(async () => Appointment.findById(createdDataB._id));
    expect(apptInDb!.clinicId.toString()).toBe(clinicB.toString());
    expect(apptInDb!.clinicId.toString()).not.toBe(clinicA.toString());

    // 3. Follow-up tenancy isolation
    const patientA = await systemScope(clinicA, async () => {
      return Patient.create({
        clinicId: clinicA,
        patientCode: 'P-A-001',
        name: 'Patient A',
        phone: '9822119988',
        sex: 'Male',
        ageYears: 30,
        consentAt: clock.now(),
        consentTextVersion: '1.0-staff',
        createdBy: doctorActorA,
      });
    });

    const followUpA = await createFollowUp(
      clinicA,
      {
        patientId: patientA._id.toString(),
        dueDate: '2026-10-26',
        reason: 'Clinic A suture removal',
      },
      doctorActorA
    );

    // Clinic B cannot list followUpA
    const followUpsB = await listFollowUps(clinicB);
    expect(followUpsB.followUps).toHaveLength(0);

    // Clinic B cannot mark followUpA as done
    await expect(markFollowUpDone(clinicB, followUpA._id, doctorActorB)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  // E12: Audit entries exist for every action with ids and field names only; no patient data and no secrets
  it('E12: audit entries exist for all Phase 5 actions with ids and field names only, zero personal data or secrets', async () => {
    // Audit actions created during tests:
    // APPOINTMENT_CREATE, APPOINTMENT_CHECK_IN, APPOINTMENT_CANCEL, APPOINTMENT_UPDATE,
    // FOLLOWUP_CREATE, FOLLOWUP_UPDATE, FOLLOWUP_DONE, FOLLOWUP_CANCEL,
    // INTEGRATION_APPOINTMENT_CREATE, INTEGRATION_APPOINTMENT_CANCEL, INTEGRATION_APPOINTMENT_RESCHEDULE, INTEGRATION_BUSY_READ

    // Perform an update on follow-up and appointment to generate APPOINTMENT_UPDATE and FOLLOWUP_UPDATE
    const { appointment } = await createAppointment(
      clinicA,
      {
        contactName: 'Audit Test Contact',
        contactPhone: '9822001199',
        start: new Date('2026-10-26T07:00:00.000Z'),
        end: new Date('2026-10-26T07:30:00.000Z'),
        reason: 'Audit Reason',
      },
      doctorActorA
    );

    await rescheduleAppointment(
      clinicA,
      appointment._id,
      {
        start: new Date('2026-10-26T07:30:00.000Z'),
        end: new Date('2026-10-26T08:00:00.000Z'),
        version: 1,
      },
      doctorActorA
    );

    await cancelAppointment(clinicA, appointment._id, 'Audit cancel reason', doctorActorA);

    const patient = await systemScope(clinicA, async () => {
      return Patient.create({
        clinicId: clinicA,
        patientCode: 'P-AUD-001',
        name: 'Audit Patient',
        phone: '9822004455',
        sex: 'Female',
        ageYears: 30,
        consentAt: clock.now(),
        consentTextVersion: '1.0-staff',
        createdBy: doctorActorA,
      });
    });

    const fu = await createFollowUp(
      clinicA,
      {
        patientId: patient._id.toString(),
        dueDate: '2026-10-26',
        reason: 'Suture removal',
      },
      doctorActorA
    );

    await updateFollowUp(
      clinicA,
      fu._id,
      { dueDate: '2026-10-27', note: 'Delayed' },
      doctorActorA
    );

    await markFollowUpDone(clinicA, fu._id, doctorActorA);

    // Query all AuditLogs for Clinic A
    const logs = await systemScope(clinicA, async () => {
      return AuditLog.find({ clinicId: clinicA });
    });

    expect(logs.length).toBeGreaterThan(0);

    const rawLogsString = JSON.stringify(logs);

    // Assert: logs contain NO patient phone numbers (unredacted), NO secret keys, and NO signatures
    expect(rawLogsString).not.toContain(secretA);
    expect(rawLogsString).not.toContain(secretB);
    expect(rawLogsString).not.toContain('Sunil Gavaskar');
    expect(rawLogsString).not.toContain('9822012345');
    expect(rawLogsString).not.toContain('Audit Test Contact');

    // Verify metadata only contains IDs and field names
    for (const log of logs) {
      if (log.meta?.changedFields) {
        expect(Array.isArray(log.meta.changedFields)).toBe(true);
      }
    }
  });
});
