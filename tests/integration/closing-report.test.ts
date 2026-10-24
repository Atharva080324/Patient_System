import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { runWithTenantContext } from '@/lib/tenancy';
import { generateClosingReport } from '@/lib/closing-report-service';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { clock, FakeClock, setClock, resetClock } from '@/lib/clock';

describe('B12: Closing Report Reconciliation & Midnight Boundary (Asia/Kolkata)', () => {
  const clinicId = new Types.ObjectId();
  const doctorActor = { type: 'USER' as const, id: 'doctor_susheel' };

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  let patientSeq = 1;
  async function createVisitWithTimestamps(data: {
    name: string;
    token: number;
    date: string;
    status: any;
    checkInAt: Date;
    startedAt?: Date;
    completedAt?: Date;
  }) {
    const currentSeq = patientSeq++;
    return runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
      const patient = await Patient.create({
        clinicId,
        patientCode: `P-${currentSeq.toString().padStart(6, '0')}`,
        name: data.name,
        ageYears: 32,
        sex: 'Male',
        phone: `98220${(40000 + currentSeq).toString()}`,
        source: 'WALK_IN',
        consentAt: data.checkInAt,
        consentTextVersion: '1.0',
        createdBy: doctorActor,
      });

      return Visit.create({
        clinicId,
        patientId: patient._id,
        date: data.date,
        token: data.token,
        type: 'WALK_IN',
        status: data.status,
        checkInAt: data.checkInAt,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        reasonForVisit: 'Consultation',
        caseSheet: {
          chiefComplaint: 'Consultation',
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
    });
  }

  it('B12: Closing report totals match raw count of visits, including midnight boundary in Asia/Kolkata', async () => {
    // Target date: 2026-10-24
    // 1. Visit 1: Completed (checkIn at 10:00 AM IST, started at 10:15 AM, completed at 10:45 AM) -> wait 15m
    await createVisitWithTimestamps({
      name: 'Morning Completed Patient',
      token: 1,
      date: '2026-10-24',
      status: 'COMPLETED',
      checkInAt: new Date('2026-10-24T10:00:00.000+05:30'),
      startedAt: new Date('2026-10-24T10:15:00.000+05:30'),
      completedAt: new Date('2026-10-24T10:45:00.000+05:30'),
    });

    // 2. Visit 2: Skipped
    await createVisitWithTimestamps({
      name: 'Afternoon Skipped Patient',
      token: 2,
      date: '2026-10-24',
      status: 'SKIPPED',
      checkInAt: new Date('2026-10-24T14:00:00.000+05:30'),
    });

    // 3. Visit 3: No-Show
    await createVisitWithTimestamps({
      name: 'Evening No Show Patient',
      token: 3,
      date: '2026-10-24',
      status: 'NO_SHOW',
      checkInAt: new Date('2026-10-24T17:00:00.000+05:30'),
    });

    // 4. Visit 4: Cancelled
    await createVisitWithTimestamps({
      name: 'Evening Cancelled Patient',
      token: 4,
      date: '2026-10-24',
      status: 'CANCELLED',
      checkInAt: new Date('2026-10-24T18:00:00.000+05:30'),
    });

    // 5. Visit 5: Registered 1 second before midnight IST (23:59:59 IST on 2026-10-24) -> WAITING
    await createVisitWithTimestamps({
      name: 'Late Night Patient Before Midnight',
      token: 5,
      date: '2026-10-24',
      status: 'WAITING',
      checkInAt: new Date('2026-10-24T23:59:59.000+05:30'),
    });

    // 6. Visit 6: Registered 1 second AFTER midnight IST (00:00:01 IST on 2026-10-25) -> Belongs to 2026-10-25!
    await createVisitWithTimestamps({
      name: 'Early Morning Patient After Midnight',
      token: 1, // Restarts on new clinic day
      date: '2026-10-25',
      status: 'WAITING',
      checkInAt: new Date('2026-10-25T00:00:01.000+05:30'),
    });

    await runWithTenantContext({ clinicId, actor: doctorActor }, async () => {
      // Generate report for 2026-10-24
      const report24 = await generateClosingReport(clinicId, '2026-10-24');

      expect(report24.clinicDate).toBe('2026-10-24');
      // Exactly 5 visits registered on 2026-10-24 (including Visit 5 at 23:59:59 IST)
      expect(report24.totalRegistered).toBe(5);
      expect(report24.completed).toBe(1);
      expect(report24.skipped).toBe(1);
      expect(report24.noShow).toBe(1);
      expect(report24.cancelled).toBe(1);
      expect(report24.stillWaiting).toBe(1);

      // Token span: 1 to 5
      expect(report24.firstToken).toBe(1);
      expect(report24.lastToken).toBe(5);

      // Raw reconciliation check
      expect(report24.reconciliation.rawVisitCount).toBe(5);
      expect(report24.reconciliation.sumOfCategories).toBe(5);
      expect(report24.reconciliation.isReconciled).toBe(true);

      // Generate report for next day: 2026-10-25
      const report25 = await generateClosingReport(clinicId, '2026-10-25');
      expect(report25.clinicDate).toBe('2026-10-25');
      // Exactly 1 visit registered on 2026-10-25 (Visit 6 at 00:00:01 IST)
      expect(report25.totalRegistered).toBe(1);
      expect(report25.stillWaiting).toBe(1);
      expect(report25.firstToken).toBe(1);
      expect(report25.lastToken).toBe(1);
      expect(report25.reconciliation.isReconciled).toBe(true);
    });
  });
});
