import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { runWithTenantContext } from '@/lib/tenancy';
import { registerWalkInPatient } from '@/lib/registration-service';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { IdempotencyKey } from '@/models/IdempotencyKey';
import { clock, FakeClock, setClock, resetClock } from '@/lib/clock';

describe('B1, B2, B9, B10, B11, B13: Registration Service & Kiosk Backend', () => {
  const clinicId = new Types.ObjectId();
  const deviceTokenId = new Types.ObjectId().toString();
  const kioskActor = { type: 'KIOSK' as const, id: deviceTokenId };

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('B1: 50 concurrent kiosk submissions produce 50 unique tokens, 50 visits, and no errors', async () => {
    await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      const submissions = Array.from({ length: 50 }, (_, i) => {
        const idKey = crypto.randomUUID();
        const phone = `98220${(10000 + i).toString()}`;
        const letter = letters[i] || 'A';
        return registerWalkInPatient(clinicId, deviceTokenId, {
          name: `Patient Batch ${letter}`,
          ageYears: 20 + (i % 50),
          sex: i % 2 === 0 ? 'Male' : 'Female',
          phone,
          reasonForVisit: 'General dental checkup and cleaning',
          consent: true,
          consentTextVersion: '1.0',
          idempotencyKey: idKey,
        });
      });

      const results = await Promise.all(submissions);

      expect(results).toHaveLength(50);
      for (const res of results) {
        expect(res.ok).toBe(true);
        expect(typeof res.token).toBe('number');
      }

      // Assert all 50 tokens are unique and consecutive 1..50
      const tokens = results.map((r) => r.token);
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(50);

      const sortedTokens = [...tokens].sort((a, b) => a - b);
      const expectedTokens = Array.from({ length: 50 }, (_, i) => i + 1);
      expect(sortedTokens).toEqual(expectedTokens);

      // Verify visits in DB
      const visitCount = await Visit.countDocuments({ clinicId });
      expect(visitCount).toBe(50);

      const patientCount = await Patient.countDocuments({ clinicId });
      expect(patientCount).toBe(50);
    });
  });

  it('B2: The same idempotency key submitted 10 times in parallel creates exactly ONE patient and ONE visit', async () => {
    await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
      const sharedKey = crypto.randomUUID();
      const phone = '9822099999';

      const parallelAttempts = Array.from({ length: 10 }, () =>
        registerWalkInPatient(clinicId, deviceTokenId, {
          name: 'Double Tapping Patient',
          ageYears: 34,
          sex: 'Male',
          phone,
          reasonForVisit: 'Severe toothache lower jaw',
          consent: true,
          consentTextVersion: '1.0',
          idempotencyKey: sharedKey,
        })
      );

      const results = await Promise.all(parallelAttempts);

      expect(results).toHaveLength(10);
      // All 10 returned identical response with identical token
      const firstToken = results[0].token;
      for (const res of results) {
        expect(res.ok).toBe(true);
        expect(res.token).toBe(firstToken);
      }

      // Assert exactly ONE patient and ONE visit created in MongoDB
      const visitCount = await Visit.countDocuments({ clinicId });
      expect(visitCount).toBe(1);

      const patientCount = await Patient.countDocuments({ clinicId });
      expect(patientCount).toBe(1);

      const keyDoc = await IdempotencyKey.findOne({ clinicId, key: sharedKey });
      expect(keyDoc).not.toBeNull();
      expect(keyDoc?.status).toBe('COMPLETED');
    });
  });

  it('B9: Duplicate rules: returns identical response shape for new and returning patients without data leakage', async () => {
    await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
      const phone = '9822112233';

      // 1. First registration: Brand new patient
      const res1 = await registerWalkInPatient(clinicId, deviceTokenId, {
        name: 'Sunita Deshmukh',
        ageYears: 40,
        sex: 'Female',
        phone,
        reasonForVisit: 'Tooth sensitivity',
        consent: true,
        consentTextVersion: '1.0',
        idempotencyKey: crypto.randomUUID(),
      });

      // 2. Second registration: Exact same patient returning on next occasion
      const res2 = await registerWalkInPatient(clinicId, deviceTokenId, {
        name: 'Mrs. Sunita Deshmukh',
        ageYears: 40,
        sex: 'Female',
        phone,
        reasonForVisit: 'Follow up cleaning',
        consent: true,
        consentTextVersion: '1.0',
        idempotencyKey: crypto.randomUUID(),
      });

      // Response shape is identical: { ok: true, token: N }
      expect(res1).toEqual({ ok: true, token: 1 });
      expect(res2).toEqual({ ok: true, token: 2 });

      // Verifies patient was reused (still only 1 Patient record)
      const patientCount = await Patient.countDocuments({ clinicId });
      expect(patientCount).toBe(1);

      const visitCount = await Visit.countDocuments({ clinicId });
      expect(visitCount).toBe(2);

      // 3. Third registration: Family member with clearly different name (spouse) sharing phone
      const res3 = await registerWalkInPatient(clinicId, deviceTokenId, {
        name: 'Ganesh Deshmukh',
        ageYears: 44,
        sex: 'Male',
        phone,
        reasonForVisit: 'Crown fallen off',
        consent: true,
        consentTextVersion: '1.0',
        idempotencyKey: crypto.randomUUID(),
      });

      expect(res3).toEqual({ ok: true, token: 3 });

      // Family member creates a NEW patient record without duplicate flag
      const updatedPatientCount = await Patient.countDocuments({ clinicId });
      expect(updatedPatientCount).toBe(2);

      const ganesh = await Patient.findOne({ clinicId, name: 'Ganesh Deshmukh' });
      expect(ganesh?.possibleDuplicateOf).toBeUndefined();
    });
  });

  it('B10: Honeypot submission creates nothing, returns standard success screen, and logs audit', async () => {
    await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
      const res = await registerWalkInPatient(clinicId, deviceTokenId, {
        name: 'Spam Bot Crawler',
        ageYears: 99,
        sex: 'Other',
        phone: '9822999999',
        reasonForVisit: 'Spam backlinks',
        consent: true,
        consentTextVersion: '1.0',
        idempotencyKey: crypto.randomUUID(),
        confirm_hp: 'http://spam-link.ru', // Honeypot filled!
      });

      // Returns standard success screen with token 0
      expect(res.ok).toBe(true);

      // Verifies NOTHING created in patient or visit collection
      const patientCount = await Patient.countDocuments({ clinicId });
      expect(patientCount).toBe(0);

      const visitCount = await Visit.countDocuments({ clinicId });
      expect(visitCount).toBe(0);

      // Verifies audit entry was logged
      const auditLog = await AuditLog.findOne({
        clinicId,
        action: AuditAction.HONEYPOT_TRIGGERED,
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog?.entity).toBe('Kiosk');
    });
  });

  it('B11: A failure injected mid-registration leaves no orphan patient or visit', async () => {
    await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
      const idKey = crypto.randomUUID();

      await expect(
        registerWalkInPatient(
          clinicId,
          deviceTokenId,
          {
            name: 'Failure Injected Patient',
            ageYears: 28,
            sex: 'Female',
            phone: '9822554433',
            reasonForVisit: 'Bleeding gums',
            consent: true,
            consentTextVersion: '1.0',
            idempotencyKey: idKey,
          },
          { injectFailure: 'VISIT_CREATION' }
        )
      ).rejects.toThrow(/Injected failure: VISIT_CREATION/);

      // Transaction aborted: verify neither Patient nor Visit exists!
      const patientCount = await Patient.countDocuments({ clinicId });
      expect(patientCount).toBe(0);

      const visitCount = await Visit.countDocuments({ clinicId });
      expect(visitCount).toBe(0);

      // Key should have been cleared so patient can retry
      const keyDoc = await IdempotencyKey.findOne({ clinicId, key: idKey });
      expect(keyDoc).toBeNull();
    });
  });

  it('B13: Tokens restart at 1 on a new clinic day (with FakeClock)', async () => {
    const fakeClock = new FakeClock(new Date('2026-10-24T10:00:00.000+05:30'));
    setClock(fakeClock);

    try {
      await runWithTenantContext({ clinicId, actor: kioskActor }, async () => {
        // Register two patients on 2026-10-24
        const res1 = await registerWalkInPatient(clinicId, deviceTokenId, {
          name: 'Day One Patient Alpha',
          ageYears: 30,
          sex: 'Male',
          phone: '9822000001',
          reasonForVisit: 'Consultation',
          consent: true,
          consentTextVersion: '1.0',
          idempotencyKey: crypto.randomUUID(),
        });
        const res2 = await registerWalkInPatient(clinicId, deviceTokenId, {
          name: 'Day One Patient Beta',
          ageYears: 31,
          sex: 'Female',
          phone: '9822000002',
          reasonForVisit: 'Consultation',
          consent: true,
          consentTextVersion: '1.0',
          idempotencyKey: crypto.randomUUID(),
        });

        expect(res1.token).toBe(1);
        expect(res2.token).toBe(2);

        // Advance clock to next day: 2026-10-25 09:00:00 IST (+23 hours)
        fakeClock.advance(23 * 3600 * 1000);

        const resNextDay = await registerWalkInPatient(clinicId, deviceTokenId, {
          name: 'Day Two Patient Gamma',
          ageYears: 25,
          sex: 'Male',
          phone: '9822000003',
          reasonForVisit: 'Consultation',
          consent: true,
          consentTextVersion: '1.0',
          idempotencyKey: crypto.randomUUID(),
        });

        // Token must restart at 1!
        expect(resNextDay.token).toBe(1);
      });
    } finally {
      resetClock();
    }
  });
});
