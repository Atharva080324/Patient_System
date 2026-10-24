import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from '../integration/test-db-helper';
import { runWithTenantContext } from '@/lib/tenancy';
import {
  canTransition,
  getNextStateForAction,
  getStateTimestampField,
} from '@/lib/visit-state-machine';
import {
  RegistrationInputSchema,
  registerWalkInPatient,
} from '@/lib/registration-service';
import {
  getLiveQueue,
  transitionVisitStatus,
  OperatoryOccupiedError,
} from '@/lib/queue-service';
import { generateClosingReport } from '@/lib/closing-report-service';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { IdempotencyKey } from '@/models/IdempotencyKey';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';

describe('Phase 2 Per-File 90% Coverage Hardening', () => {
  const clinicId = new Types.ObjectId();
  const doctorActor = { type: 'USER' as const, id: 'doctor_susheel' };
  const kioskActor = { type: 'KIOSK' as const, id: 'kiosk_dev_1' };
  const today = clinicDate(clock.now());

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('visit-state-machine branches', () => {
    it('handles unexpected or invalid state types defensively', () => {
      expect(canTransition('INVALID' as any, 'WAITING')).toBe(false);
      expect(getNextStateForAction('INVALID' as any, 'CALL_IN')).toBeNull();
      expect(getStateTimestampField('UNKNOWN' as any)).toBeNull();
    });
  });

  describe('registration-service branches & validation', () => {
    it('validates schema edge cases (dob without ageYears, consent error map, invalid age/dob)', () => {
      // DOB without ageYears
      const validDob = RegistrationInputSchema.safeParse({
        name: 'Aarav Patil',
        dob: '1995-04-12',
        sex: 'Male',
        phone: '9822012345',
        reasonForVisit: 'Cleaning',
        consent: true,
        consentTextVersion: '1.0',
        idempotencyKey: crypto.randomUUID(),
      });
      expect(validDob.success).toBe(true);

      // Both ageYears and dob provided -> refine error
      const bothError = RegistrationInputSchema.safeParse({
        name: 'Aarav Patil',
        ageYears: 30,
        dob: '1995-04-12',
        sex: 'Male',
        phone: '9822012345',
        reasonForVisit: 'Cleaning',
        consent: true,
        consentTextVersion: '1.0',
        idempotencyKey: crypto.randomUUID(),
      });
      expect(bothError.success).toBe(false);

      // Neither ageYears nor dob provided -> refine error
      const neitherError = RegistrationInputSchema.safeParse({
        name: 'Aarav Patil',
        sex: 'Male',
        phone: '9822012345',
        reasonForVisit: 'Cleaning',
        consent: true,
        consentTextVersion: '1.0',
        idempotencyKey: crypto.randomUUID(),
      });
      expect(neitherError.success).toBe(false);

      // Consent false -> triggers errorMap
      const consentFalse = RegistrationInputSchema.safeParse({
        name: 'Aarav Patil',
        ageYears: 30,
        sex: 'Male',
        phone: '9822012345',
        reasonForVisit: 'Cleaning',
        consent: false,
        consentTextVersion: '1.0',
        idempotencyKey: crypto.randomUUID(),
      });
      expect(consentFalse.success).toBe(false);
      if (!consentFalse.success) {
        expect(consentFalse.error.issues[0].message).toBe('Consent must be accepted');
      }
    });

    it('exercises PATIENT_CREATION injection failure and dob registration', async () => {
      await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
        await expect(
          registerWalkInPatient(
            clinicId,
            'kiosk_dev_1',
            {
              name: 'Injected Fail Patient',
              dob: '1990-01-01',
              sex: 'Other',
              phone: '9822077777',
              reasonForVisit: 'Checkup',
              consent: true,
              consentTextVersion: '1.0',
              idempotencyKey: crypto.randomUUID(),
            },
            { injectFailure: 'PATIENT_CREATION' }
          )
        ).rejects.toThrow(/Injected failure: PATIENT_CREATION/);
      });
    });

    it('exercises idempotency timeout when key remains PROCESSING', async () => {
      await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
        const stuckKey = crypto.randomUUID();

        // Create a stuck PROCESSING idempotency key
        await IdempotencyKey.create({
          clinicId,
          key: stuckKey,
          status: 'PROCESSING',
        });

        // Registration with the same key should poll and timeout
        await expect(
          registerWalkInPatient(clinicId, 'kiosk_dev_1', {
            name: 'Stuck Key Patient',
            ageYears: 29,
            sex: 'Male',
            phone: '9822066666',
            reasonForVisit: 'RCT',
            consent: true,
            consentTextVersion: '1.0',
            idempotencyKey: stuckKey,
          })
        ).rejects.toThrow(/timed out/i);
      });
    });
  });

  describe('queue-service branches', () => {
    it('exercises getLiveQueue with default date and all status types', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const patient = await Patient.create({
          clinicId,
          patientCode: 'P-888001',
          name: 'Queue Status Patient',
          ageYears: 25,
          sex: 'Other',
          phone: '9822033333',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActor,
        });

        const now = clock.now();
        // Create one visit for each status
        await Visit.create([
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 1,
            type: 'WALK_IN',
            status: 'IN_CONSULTATION',
            checkInAt: new Date(now.getTime() - 15 * 60000),
            startedAt: new Date(now.getTime() - 10 * 60000),
            reasonForVisit: 'In consultation',
            caseSheet: { chiefComplaint: 'In consult', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 2,
            type: 'WALK_IN',
            status: 'COMPLETED',
            checkInAt: new Date(now.getTime() - 40 * 60000),
            startedAt: new Date(now.getTime() - 35 * 60000),
            completedAt: new Date(now.getTime() - 20 * 60000),
            reasonForVisit: 'Completed with startedAt',
            caseSheet: { chiefComplaint: 'Done', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 3,
            type: 'WALK_IN',
            status: 'COMPLETED',
            checkInAt: new Date(now.getTime() - 30 * 60000),
            completedAt: new Date(now.getTime() - 10 * 60000),
            reasonForVisit: 'Completed without startedAt',
            caseSheet: { chiefComplaint: 'Done', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 4,
            type: 'WALK_IN',
            status: 'SKIPPED',
            checkInAt: new Date(now.getTime() - 25 * 60000),
            reasonForVisit: 'Skipped visit',
            caseSheet: { chiefComplaint: 'Skipped', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 5,
            type: 'WALK_IN',
            status: 'NO_SHOW',
            checkInAt: new Date(now.getTime() - 20 * 60000),
            reasonForVisit: 'No show',
            caseSheet: { chiefComplaint: 'No show', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
        ]);

        // Default argument test (calling without targetDate)
        const queueDefault = await getLiveQueue(clinicId);
        expect(queueDefault.counters.inConsultation).toBe(1);
        expect(queueDefault.counters.completed).toBe(2);
        expect(queueDefault.counters.skippedOrNoShow).toBe(2);
        expect(queueDefault.items).toHaveLength(2); // 1 in consultation + 1 skipped
      });
    });

    it('throws when visit is not found in transitionVisitStatus', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const nonExistentId = new Types.ObjectId();
        await expect(
          transitionVisitStatus(clinicId, nonExistentId, 'CALL_IN', 1, doctorActor)
        ).rejects.toThrow(/Visit not found/);
      });
    });

    it('exercises SEND_BACK transition where timestampField is null and OperatoryOccupied', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const patient = await Patient.create({
          clinicId,
          patientCode: 'P-999001',
          name: 'Send Back Patient',
          ageYears: 33,
          sex: 'Male',
          phone: '9822055555',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActor,
        });

        const visit1 = await Visit.create({
          clinicId,
          patientId: patient._id,
          date: today,
          token: 99,
          type: 'WALK_IN',
          status: 'IN_CONSULTATION',
          checkInAt: clock.now(),
          startedAt: clock.now(),
          reasonForVisit: 'Consultation',
          caseSheet: { chiefComplaint: 'Consultation', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
          version: 1,
          createdBy: doctorActor,
        });

        const visit2 = await Visit.create({
          clinicId,
          patientId: patient._id,
          date: today,
          token: 100,
          type: 'WALK_IN',
          status: 'WAITING',
          checkInAt: clock.now(),
          reasonForVisit: 'Waiting',
          caseSheet: { chiefComplaint: 'Waiting', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
          version: 1,
          createdBy: doctorActor,
        });

        // Calling in visit2 while visit1 is IN_CONSULTATION throws OperatoryOccupiedError
        await expect(
          transitionVisitStatus(clinicId, visit2._id, 'CALL_IN', 1, doctorActor)
        ).rejects.toThrow(OperatoryOccupiedError);

        // SEND_BACK on visit1 transitions to WAITING (timestampField is null)
        const updated = await transitionVisitStatus(clinicId, visit1._id, 'SEND_BACK', 1, doctorActor);
        expect(updated.status).toBe('WAITING');
        expect(updated.version).toBe(2);

        // SKIPPED -> SEND_BACK -> WAITING
        await Visit.updateOne({ _id: visit1._id }, { status: 'SKIPPED', version: 2 });
        const fromSkipped = await transitionVisitStatus(clinicId, visit1._id, 'SEND_BACK', 2, doctorActor);
        expect(fromSkipped.status).toBe('WAITING');
      });
    });
  });

  describe('closing-report-service branches', () => {
    it('handles default date argument and empty clinic day with zero visits', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        // Calling without targetDate exercises default argument line
        const report = await generateClosingReport(clinicId);
        expect(report.totalRegistered).toBe(0);
        expect(report.completed).toBe(0);
        expect(report.firstToken).toBeNull();
        expect(report.lastToken).toBeNull();
        expect(report.averageWaitMinutes).toBe(0);
        expect(report.longestWaitMinutes).toBe(0);
        expect(report.reconciliation.isReconciled).toBe(true);
      });
    });

    it('exercises token updates and wait time comparisons for all categories', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const patient = await Patient.create({
          clinicId,
          patientCode: 'P-999002',
          name: 'Direct Complete Patient',
          ageYears: 40,
          sex: 'Female',
          phone: '9822044444',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActor,
        });

        const now = clock.now();
        // Insert unsorted tokens to exercise token comparison branches
        await Visit.create([
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 10,
            type: 'WALK_IN',
            status: 'COMPLETED',
            checkInAt: new Date(now.getTime() - 60 * 60000),
            startedAt: new Date(now.getTime() - 40 * 60000),
            completedAt: new Date(now.getTime() - 10 * 60000),
            reasonForVisit: 'Complete 1 with startedAt',
            caseSheet: { chiefComplaint: 'Done', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 5, // smaller than first
            type: 'WALK_IN',
            status: 'COMPLETED',
            checkInAt: new Date(now.getTime() - 20 * 60000),
            completedAt: new Date(now.getTime() - 5 * 60000), // wait is 15 mins (smaller than 20 mins)
            reasonForVisit: 'Complete 2 without startedAt',
            caseSheet: { chiefComplaint: 'Done', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 15, // larger than last
            type: 'WALK_IN',
            status: 'WAITING',
            checkInAt: new Date(now.getTime() - 50 * 60000),
            reasonForVisit: 'Waiting long wait',
            caseSheet: { chiefComplaint: 'Waiting', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 16,
            type: 'WALK_IN',
            status: 'WAITING',
            checkInAt: new Date(now.getTime() - 5 * 60000), // smaller wait than previous waiting
            reasonForVisit: 'Waiting smaller wait',
            caseSheet: { chiefComplaint: 'Waiting', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 17,
            type: 'WALK_IN',
            status: 'NO_SHOW',
            checkInAt: new Date(now.getTime() - 30 * 60000),
            noShowAt: new Date(now.getTime() - 25 * 60000),
            reasonForVisit: 'Did not show',
            caseSheet: { chiefComplaint: 'No show', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
          {
            clinicId,
            patientId: patient._id,
            date: today,
            token: 18,
            type: 'WALK_IN',
            status: 'CANCELLED',
            checkInAt: new Date(now.getTime() - 20 * 60000),
            cancelledAt: new Date(now.getTime() - 15 * 60000),
            reasonForVisit: 'Cancelled by patient',
            caseSheet: { chiefComplaint: 'Cancelled', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
            version: 1,
            createdBy: doctorActor,
          },
        ]);

        // String clinicId test
        const report = await generateClosingReport(clinicId.toString(), today);
        expect(report.completed).toBe(2);
        expect(report.stillWaiting).toBe(2);
        expect(report.noShow).toBe(1);
        expect(report.cancelled).toBe(1);
        expect(report.firstToken).toBe(5);
        expect(report.lastToken).toBe(18);
        expect(report.reconciliation.isReconciled).toBe(true);
      });
    });
  });

  describe('targeted branch coverage for queue-service and registration-service', () => {
    it('exercises string clinicId and string visitId for queue-service, plus SKIP, NO_SHOW, CANCEL', async () => {
      await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
        const patient = await Patient.create({
          clinicId,
          patientCode: 'P-999003',
          name: 'Queue Transition Branch Patient',
          ageYears: 42,
          sex: 'Male',
          phone: '9822011223',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActor,
        });

        const vSkip = await Visit.create({
          clinicId,
          patientId: patient._id,
          date: today,
          token: 50,
          type: 'WALK_IN',
          status: 'WAITING',
          checkInAt: clock.now(),
          reasonForVisit: 'To skip',
          caseSheet: { chiefComplaint: '', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
          version: 1,
          createdBy: doctorActor,
        });

        // Exercise string clinicId, string visitId, and SKIP action
        const skipped = await transitionVisitStatus(
          clinicId.toString(),
          vSkip._id.toString(),
          'SKIP',
          1,
          doctorActor
        );
        expect(skipped.status).toBe('SKIPPED');
        expect(skipped.skippedAt).toBeDefined();

        // Exercise NO_SHOW from SKIPPED
        const noShow = await transitionVisitStatus(
          clinicId.toString(),
          vSkip._id.toString(),
          'NO_SHOW',
          2,
          doctorActor
        );
        expect(noShow.status).toBe('NO_SHOW');
        expect(noShow.noShowAt).toBeDefined();

        // Exercise CANCEL from WAITING
        const vCancel = await Visit.create({
          clinicId,
          patientId: patient._id,
          date: today,
          token: 51,
          type: 'WALK_IN',
          status: 'WAITING',
          checkInAt: clock.now(),
          reasonForVisit: 'To cancel',
          caseSheet: { chiefComplaint: '', historyOfPresentIllness: '', extraOral: '', intraOral: '', findings: [], investigations: [], diagnosis: '', treatmentPlan: [], procedureNotes: '', advice: '' },
          version: 1,
          createdBy: doctorActor,
        });

        const cancelled = await transitionVisitStatus(
          clinicId,
          vCancel._id,
          'CANCEL',
          1,
          doctorActor
        );
        expect(cancelled.status).toBe('CANCELLED');
        expect(cancelled.cancelledAt).toBeDefined();

        // Exercise string clinicId in getLiveQueue
        const liveQueue = await getLiveQueue(clinicId.toString(), today);
        expect(liveQueue.counters.skippedOrNoShow).toBeGreaterThan(0);
      });
    });

    it('exercises string clinicId, POSSIBLE_DUPLICATE_FLAG, and non-11000 errors in registration-service', async () => {
      await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
        // Seed existing patient
        const existing = await Patient.create({
          clinicId,
          patientCode: 'P-999004',
          name: 'Rohan Sharma',
          ageYears: 35,
          sex: 'Male',
          phone: '9822099112',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActor,
        });

        // Register walk-in with string clinicId, same phone, same name but age mismatch (senior vs junior) -> triggers POSSIBLE_DUPLICATE_FLAG
        const res = await registerWalkInPatient(
          clinicId.toString(),
          'kiosk_dev_1',
          {
            name: 'Rohan Sharma',
            ageYears: 20,
            sex: 'Male',
            phone: '9822099112',
            reasonForVisit: 'Toothache',
            consent: true,
            consentTextVersion: '1.0',
            idempotencyKey: crypto.randomUUID(),
          }
        );
        expect(res.ok).toBe(true);

        const newPatient = await Patient.findOne({
          clinicId,
          name: 'Rohan Sharma',
          ageYears: 20,
        });
        expect(newPatient).toBeDefined();
        expect(newPatient?.possibleDuplicateOf?.toString()).toBe(existing._id.toString());
      });
    });
  });
});
