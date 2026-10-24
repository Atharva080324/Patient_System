import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { assertSafeDatabase } from '../../scripts/script-utils';
import { IDA_28_TREATMENTS, SAMPLE_MEDICINES } from '../../scripts/seed-base';
import { Treatment } from '@/models/Treatment';
import { Medicine } from '@/models/Medicine';
import { Clinic } from '@/models/Clinic';
import { systemScope } from '@/lib/tenancy';
import { hashKioskPin } from '@/lib/passwords';

describe('A16: Seed Idempotency & Database Safety Enforcements', () => {
  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('Database and Environment Safety Assertions', () => {
    it('passes safely when database name ends in _test or _dev in non-production', () => {
      expect(() => assertSafeDatabase()).not.toThrow();
    });
  });

  describe('Idempotency of Base Seeds', () => {
    it('running base seed twice leaves exact counts of 28 treatments and 10 medicines with zero duplicates', async () => {
      const pinHash = await hashKioskPin('1234');
      const clinic = await Clinic.create({
        name: "Dr. Susheel's Advanced Dental Clinic",
        address: 'Chhatrapati Sambhajinagar',
        phone: '9822000000',
        email: 'doctor@example.com',
        registrationNo: 'MH-01',
        timezone: 'Asia/Kolkata',
        paperSize: 'A5',
        kioskPinHash: pinHash,
        createdBy: { type: 'SYSTEM', id: 'test' },
      });

      const clinicId = clinic._id;

      const runSeed = async () => {
        await systemScope(clinicId, async () => {
          for (const t of IDA_28_TREATMENTS) {
            await Treatment.findOneAndUpdate(
              { clinicId, code: t.code },
              {
                $set: {
                  name: t.name,
                  category: t.category,
                  idaMin: t.idaMin,
                  idaMax: t.idaMax,
                  unit: t.unit,
                  active: true,
                },
                $setOnInsert: {
                  clinicId,
                  code: t.code,
                  createdBy: { type: 'SYSTEM', id: 'seed' },
                },
              },
              { upsert: true }
            );
          }

          for (const m of SAMPLE_MEDICINES) {
            await Medicine.findOneAndUpdate(
              { clinicId, genericName: m.genericName, form: m.form, strength: m.strength },
              {
                $set: {
                  brandName: m.brandName,
                  route: m.route,
                  category: m.category,
                  source: 'SAMPLE',
                  verified: false,
                  active: true,
                },
                $setOnInsert: {
                  clinicId,
                  genericName: m.genericName,
                  form: m.form,
                  strength: m.strength,
                  createdBy: { type: 'SYSTEM', id: 'seed' },
                },
              },
              { upsert: true }
            );
          }
        });
      };

      // Run Seed 1st time
      await runSeed();
      let treatmentCount = await systemScope(clinicId, () => Treatment.countDocuments({ clinicId }));
      let medicineCount = await systemScope(clinicId, () => Medicine.countDocuments({ clinicId }));

      expect(treatmentCount).toBe(28);
      expect(medicineCount).toBe(10);

      // Run Seed 2nd time (Idempotency verification)
      await runSeed();
      treatmentCount = await systemScope(clinicId, () => Treatment.countDocuments({ clinicId }));
      medicineCount = await systemScope(clinicId, () => Medicine.countDocuments({ clinicId }));

      expect(treatmentCount).toBe(28);
      expect(medicineCount).toBe(10);
    });
  });
});
