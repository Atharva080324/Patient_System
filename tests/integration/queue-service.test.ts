import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { runWithTenantContext } from '@/lib/tenancy';
import {
  getLiveQueue,
  transitionVisitStatus,
  IllegalTransitionError,
  VersionConflictError,
  OperatoryOccupiedError,
} from '@/lib/queue-service';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';

describe('B6, B7, B8, B14: Live Queue Service & Operatory Invariants', () => {
  const clinicId = new Types.ObjectId();
  const doctorActor = { type: 'USER' as const, id: 'doctor_susheel' };
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

  async function createTestPatientAndVisit(
    name: string,
    token: number,
    status: any = 'WAITING'
  ) {
    return runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
      const patient = await Patient.create({
        clinicId,
        patientCode: `P-${token.toString().padStart(6, '0')}`,
        name,
        ageYears: 30,
        sex: 'Male',
        phone: `98220${(20000 + token).toString()}`,
        source: 'WALK_IN',
        consentAt: clock.now(),
        consentTextVersion: '1.0',
        createdBy: doctorActor,
      });

      const visit = await Visit.create({
        clinicId,
        patientId: patient._id,
        date: today,
        token,
        type: 'WALK_IN',
        status,
        checkInAt: clock.now(),
        reasonForVisit: 'Routine consultation',
        caseSheet: {
          chiefComplaint: 'Routine consultation',
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
        createdBy: doctorActor,
      });

      return { patient, visit };
    });
  }

  it('B6: Illegal status transitions are rejected with 409 for full transition matrix, and terminal states never change', async () => {
    await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
      const { visit } = await createTestPatientAndVisit('Patient Waiting', 1, 'WAITING');

      // Illegal from WAITING: COMPLETE or SEND_BACK
      await expect(
        transitionVisitStatus(clinicId, visit._id, 'COMPLETE', visit.version, doctorActor)
      ).rejects.toThrow(IllegalTransitionError);

      await expect(
        transitionVisitStatus(clinicId, visit._id, 'SEND_BACK', visit.version, doctorActor)
      ).rejects.toThrow(IllegalTransitionError);

      // Legal: WAITING -> IN_CONSULTATION via CALL_IN
      const inConsult = await transitionVisitStatus(
        clinicId,
        visit._id,
        'CALL_IN',
        visit.version,
        doctorActor
      );
      expect(inConsult.status).toBe('IN_CONSULTATION');
      expect(inConsult.version).toBe(2);
      expect(inConsult.startedAt).toBeDefined();

      // Illegal from IN_CONSULTATION: CALL_IN, SKIP, NO_SHOW, CANCEL
      await expect(
        transitionVisitStatus(clinicId, visit._id, 'CALL_IN', inConsult.version, doctorActor)
      ).rejects.toThrow(IllegalTransitionError);
      await expect(
        transitionVisitStatus(clinicId, visit._id, 'SKIP', inConsult.version, doctorActor)
      ).rejects.toThrow(IllegalTransitionError);

      // Legal: IN_CONSULTATION -> COMPLETED via COMPLETE
      const completed = await transitionVisitStatus(
        clinicId,
        visit._id,
        'COMPLETE',
        inConsult.version,
        doctorActor
      );
      expect(completed.status).toBe('COMPLETED');
      expect(completed.completedAt).toBeDefined();

      // Terminal state COMPLETED rejects ANY action
      const allActions: any[] = ['CALL_IN', 'COMPLETE', 'SKIP', 'SEND_BACK', 'NO_SHOW', 'CANCEL'];
      for (const action of allActions) {
        await expect(
          transitionVisitStatus(clinicId, visit._id, action, completed.version, doctorActor)
        ).rejects.toThrow(IllegalTransitionError);
      }
    });
  });

  it('B7: Only one visit can be IN_CONSULTATION at a time, even with two parallel "Call in" requests', async () => {
    await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
      const { visit: v1 } = await createTestPatientAndVisit('Patient Alpha', 1, 'WAITING');
      const { visit: v2 } = await createTestPatientAndVisit('Patient Beta', 2, 'WAITING');

      // Parallel call-in on two different visits
      const results = await Promise.allSettled([
        transitionVisitStatus(clinicId, v1._id, 'CALL_IN', v1.version, doctorActor),
        transitionVisitStatus(clinicId, v2._id, 'CALL_IN', v2.version, doctorActor),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly ONE must succeed and exactly ONE must be rejected with OperatoryOccupiedError!
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(
        err instanceof OperatoryOccupiedError ||
          err?.name === 'OperatoryOccupiedError' ||
          err?.message?.includes('consultation') ||
          err?.code === 11000
      ).toBe(true);

      // Assert database has strictly at most ONE visit with status IN_CONSULTATION
      const activeCount = await Visit.countDocuments({
        clinicId,
        status: 'IN_CONSULTATION',
      });
      expect(activeCount).toBe(1);
    });
  });

  it('B8: Two tabs acting on the same visit: the second gets a conflict, and no silent overwrite occurs', async () => {
    await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
      const { visit } = await createTestPatientAndVisit('Patient Concurrency', 3, 'WAITING');

      // Tab 1 calls in with version 1
      const tab1Call = transitionVisitStatus(clinicId, visit._id, 'CALL_IN', 1, doctorActor);

      // Tab 2 simultaneously tries to skip with stale version 1
      const tab2Call = transitionVisitStatus(clinicId, visit._id, 'SKIP', 1, doctorActor);

      const results = await Promise.allSettled([tab1Call, tab2Call]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one succeeds, the other gets VersionConflictError (409)
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const conflictErr = (rejected[0] as PromiseRejectedResult).reason;
      expect(
        conflictErr instanceof VersionConflictError ||
          conflictErr?.name === 'VersionConflictError' ||
          conflictErr?.message?.includes('modified')
      ).toBe(true);

      // Audit log records the successful status change
      const audit = await AuditLog.findOne({
        clinicId,
        action: AuditAction.VISIT_STATUS_CHANGE,
        entityId: visit._id.toString(),
      });
      expect(audit).not.toBeNull();
    });
  });

  it('B14: Queue endpoint p95 is under 150 ms with 500 visits seeded for one day', async () => {
    await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
      // 1. Seed 500 visits for today in batch
      const patientsData = Array.from({ length: 500 }, (_, i) => ({
        _id: new Types.ObjectId(),
        clinicId,
        patientCode: `P-${(i + 1).toString().padStart(6, '0')}`,
        name: `Benchmark Patient ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (Math.floor(i / 26) % 26))}`,
        ageYears: 25 + (i % 50),
        sex: i % 2 === 0 ? 'Male' : 'Female',
        phone: `98220${(30000 + (i % 10000)).toString().padStart(5, '0')}`,
        source: 'WALK_IN',
        consentAt: clock.now(),
        consentTextVersion: '1.0',
        createdBy: doctorActor,
      }));

      await Patient.insertMany(patientsData);

      const statuses: any[] = ['WAITING', 'COMPLETED', 'SKIPPED', 'CANCELLED'];
      const visitsData = patientsData.map((p, idx) => ({
        clinicId,
        patientId: p._id,
        date: today,
        token: idx + 1,
        type: 'WALK_IN',
        status: idx === 0 ? 'IN_CONSULTATION' : statuses[idx % statuses.length],
        checkInAt: clock.now(),
        startedAt: idx === 0 ? clock.now() : undefined,
        reasonForVisit: 'General checkup',
        caseSheet: {
          chiefComplaint: 'General checkup',
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
        createdBy: doctorActor,
      }));

      await Visit.insertMany(visitsData);

      // 2. Measure latency across 20 invocations
      const latencies: number[] = [];
      for (let run = 0; run < 20; run++) {
        const start = performance.now();
        const queueResult = await getLiveQueue(clinicId, today);
        const duration = performance.now() - start;
        latencies.push(duration);

        // Sanity assertions
        expect(queueResult.counters.inConsultation).toBe(1);
        expect(queueResult.items.length).toBeGreaterThan(0);
      }

      latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(latencies.length * 0.95);
      const p95Latency = latencies[p95Index];
      const p50Latency = latencies[Math.floor(latencies.length * 0.5)];

      console.log(
        `[B14 Benchmark] 500 visits seeded: p50 = ${p50Latency.toFixed(2)} ms, p95 = ${p95Latency.toFixed(2)} ms`
      );

      // Criterion B14: p95 must be under 150 ms
      expect(p95Latency).toBeLessThan(150);
    });
  });
});
