import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';
import { systemScope, systemAdminScope } from '@/lib/tenancy';
import { Patient } from '@/models/Patient';
import { FollowUp } from '@/models/FollowUp';
import {
  computeFollowUpCategory,
  createFollowUp,
  updateFollowUp,
  markFollowUpDone,
  cancelFollowUp,
  softDeleteFollowUp,
  listFollowUps,
} from '@/lib/followup-service';

describe('E7: Follow-up Dynamic Overdue Computation in Asia/Kolkata & Service Methods', () => {
  const originalNow = clock.now.bind(clock);
  const clinicId = new Types.ObjectId();
  const actor = { type: 'USER' as const, id: 'doctor_unit_test' };
  let testPatient: any;

  beforeAll(async () => {
    await connectDb();
    await systemScope(clinicId, async () => {
      testPatient = await Patient.create({
        clinicId,
        patientCode: 'P-FU-001',
        name: 'FollowUp Patient',
        phone: '9822113355',
        sex: 'Male',
        ageYears: 35,
        consentAt: clock.now(),
        consentTextVersion: '1.0-staff',
        createdBy: actor,
      });
    });
  });

  afterAll(async () => {
    (clock as any).now = originalNow;
    await systemScope(clinicId, async () => {
      await FollowUp.deleteMany({});
      await Patient.deleteMany({});
    });
  });

  afterEach(() => {
    (clock as any).now = originalNow;
  });

  const setClock = (isoUtc: string) => {
    const fixed = new Date(isoUtc);
    (clock as any).now = () => new Date(fixed);
  };

  it('flips status exactly at midnight IST around due date', () => {
    const dueDate = '2026-10-25';
    const pendingFollowUp = { status: 'PENDING' as const, dueDate };

    // 1 second before midnight IST on 2026-10-25:
    setClock('2026-10-24T18:29:59.000Z');
    let todayStr = clinicDate(clock.now());
    expect(todayStr).toBe('2026-10-24');
    expect(computeFollowUpCategory(pendingFollowUp, todayStr)).toBe('UPCOMING');

    // Exactly at midnight IST on 2026-10-25:
    setClock('2026-10-24T18:30:00.000Z');
    todayStr = clinicDate(clock.now());
    expect(todayStr).toBe('2026-10-25');
    expect(computeFollowUpCategory(pendingFollowUp, todayStr)).toBe('TODAY');

    // 1 second before midnight IST ending 2026-10-25:
    setClock('2026-10-25T18:29:59.000Z');
    todayStr = clinicDate(clock.now());
    expect(todayStr).toBe('2026-10-25');
    expect(computeFollowUpCategory(pendingFollowUp, todayStr)).toBe('TODAY');

    // Exactly at midnight IST starting 2026-10-26 (Overdue!):
    setClock('2026-10-25T18:30:00.000Z');
    todayStr = clinicDate(clock.now());
    expect(todayStr).toBe('2026-10-26');
    expect(computeFollowUpCategory(pendingFollowUp, todayStr)).toBe('OVERDUE');
  });

  it('handles UTC-vs-IST day-difference (e.g. 19:00 UTC)', () => {
    setClock('2026-10-25T19:00:00.000Z');
    const todayStr = clinicDate(clock.now());
    expect(todayStr).toBe('2026-10-26');

    const f1 = { status: 'PENDING' as const, dueDate: '2026-10-25' };
    expect(computeFollowUpCategory(f1, todayStr)).toBe('OVERDUE');

    const f2 = { status: 'PENDING' as const, dueDate: '2026-10-26' };
    expect(computeFollowUpCategory(f2, todayStr)).toBe('TODAY');

    const f3 = { status: 'PENDING' as const, dueDate: '2026-10-27' };
    expect(computeFollowUpCategory(f3, todayStr)).toBe('UPCOMING');
  });

  it('terminal states DONE and CANCELLED never become OVERDUE', () => {
    const todayStr = '2026-10-26';
    const pastDueDate = '2026-10-20';

    const doneItem = { status: 'DONE' as const, dueDate: pastDueDate };
    expect(computeFollowUpCategory(doneItem, todayStr)).toBe('DONE');

    const cancelledItem = { status: 'CANCELLED' as const, dueDate: pastDueDate };
    expect(computeFollowUpCategory(cancelledItem, todayStr)).toBe('DONE');
  });

  it('exercises full CRUD lifecycle and coverage of followup-service', async () => {
    // 1. Create Follow-up
    const created = await createFollowUp(
      clinicId,
      {
        patientId: testPatient._id.toString(),
        dueDate: '2026-10-28',
        reason: 'Post extraction check',
        note: 'Check healing',
      },
      actor
    );

    expect(created._id).toBeDefined();
    expect(created.status).toBe('PENDING');

    // 2. Update Follow-up
    const updated = await updateFollowUp(
      clinicId,
      created._id,
      {
        dueDate: '2026-10-29',
        reason: 'Updated reason',
        note: 'Updated note',
      },
      actor
    );
    expect(updated.dueDate).toBe('2026-10-29');
    expect(updated.reason).toBe('Updated reason');

    // Update with non-existent id throws 404
    await expect(
      updateFollowUp(clinicId, new Types.ObjectId(), { reason: 'new' }, actor)
    ).rejects.toMatchObject({ statusCode: 404 });

    // 3. Mark Follow-up Done
    const done = await markFollowUpDone(clinicId, created._id, actor);
    expect(done.status).toBe('DONE');
    expect(done.doneAt).toBeDefined();

    // Mark non-existent done throws 404
    await expect(
      markFollowUpDone(clinicId, new Types.ObjectId(), actor)
    ).rejects.toMatchObject({ statusCode: 404 });

    // 4. Cancel Follow-up
    const created2 = await createFollowUp(
      clinicId,
      {
        patientId: testPatient._id.toString(),
        dueDate: '2026-10-30',
        reason: 'Root canal recall',
      },
      actor
    );

    const cancelled = await cancelFollowUp(clinicId, created2._id, actor);
    expect(cancelled.status).toBe('CANCELLED');

    // Cancel non-existent throws 404
    await expect(
      cancelFollowUp(clinicId, new Types.ObjectId(), actor)
    ).rejects.toMatchObject({ statusCode: 404 });

    // 5. List Follow-ups with counts and filtering
    const listAll = await listFollowUps(clinicId);
    expect(listAll.counts.done).toBeGreaterThanOrEqual(2);

    const listByPatient = await listFollowUps(clinicId, { patientId: testPatient._id.toString() });
    expect(listByPatient.followUps.length).toBeGreaterThan(0);

    const listUpcoming = await listFollowUps(clinicId, { tab: 'UPCOMING' });
    expect(listUpcoming.followUps).toBeDefined();

    // 6. Soft delete follow-up
    const deleted = await softDeleteFollowUp(clinicId, created._id, actor);
    expect(deleted.deletedAt).toBeDefined();

    // Soft delete non-existent throws 404
    await expect(
      softDeleteFollowUp(clinicId, new Types.ObjectId(), actor)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
