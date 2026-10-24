import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import {
  runWithTenantContext,
  systemScope,
  systemAdminScope,
  TenantContextMissingError,
  TenantIsolationViolationError,
} from '@/lib/tenancy';
import { Patient } from '@/models/Patient';
import { clock } from '@/lib/clock';

describe('A8: Strict Multi-Tenant Isolation', () => {
  const clinicA = new Types.ObjectId();
  const clinicB = new Types.ObjectId();

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('throws TenantContextMissingError when creating or querying without a tenant context', async () => {
    // 1. Creation without context
    const patientDoc = new Patient({
      name: 'Unscoped Patient',
      patientCode: 'P-000001',
      ageYears: 30,
      sex: 'Male',
      phone: '9822000001',
      source: 'WALK_IN',
      consentAt: clock.now(),
      consentTextVersion: '1.0',
    });

    await expect(patientDoc.save()).rejects.toThrow(TenantContextMissingError);

    // 2. Query without context
    await expect(Patient.find({})).rejects.toThrow(TenantContextMissingError);
  });

  it('proves complete isolation across two clinics for find, findOne, count, aggregate, update, and delete', async () => {
    // Seed Patient in Clinic A
    let patientAId: any;
    await runWithTenantContext(
      {
        clinicId: clinicA,
        actor: { type: 'USER', id: 'doctor_a' },
      },
      async () => {
        const pA = await Patient.create({
          name: 'Clinic A Patient',
          patientCode: 'P-000001',
          ageYears: 25,
          sex: 'Male',
          phone: '9822000001',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
        });
        patientAId = pA._id;
      }
    );

    // Seed Patient in Clinic B
    let patientBId: any;
    await runWithTenantContext(
      {
        clinicId: clinicB,
        actor: { type: 'USER', id: 'doctor_b' },
      },
      async () => {
        const pB = await Patient.create({
          name: 'Clinic B Patient',
          patientCode: 'P-000002',
          ageYears: 40,
          sex: 'Female',
          phone: '9822000002',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
        });
        patientBId = pB._id;
      }
    );

    // Now execute operations strictly within Clinic A's context
    await runWithTenantContext(
      {
        clinicId: clinicA,
        actor: { type: 'USER', id: 'doctor_a' },
      },
      async () => {
        // 1. find() returns ONLY Clinic A patients
        const allA = await Patient.find({});
        expect(allA).toHaveLength(1);
        expect(allA[0].name).toBe('Clinic A Patient');

        // 2. findOne() targeting Clinic B patient ID returns null
        const crossLookup = await Patient.findOne({ _id: patientBId });
        expect(crossLookup).toBeNull();

        // 3. countDocuments() counts ONLY Clinic A patients
        const count = await Patient.countDocuments({});
        expect(count).toBe(1);

        // 4. aggregate() automatically filters out Clinic B data
        const aggregated = await Patient.aggregate([
          { $group: { _id: null, totalAge: { $sum: '$ageYears' } } },
        ]);
        expect(aggregated).toHaveLength(1);
        expect(aggregated[0].totalAge).toBe(25); // Only Clinic A's patient age (25), not 25+40

        // 5. updateOne() targeting Clinic B patient does not modify it
        const updateResult = await Patient.updateOne(
          { _id: patientBId },
          { $set: { name: 'Attempted Cross-Tenant Hack' } }
        );
        expect(updateResult.matchedCount).toBe(0);
        expect(updateResult.modifiedCount).toBe(0);

        // 6. deleteOne() targeting Clinic B patient does not delete it
        const deleteResult = await Patient.deleteOne({ _id: patientBId });
        expect(deleteResult.deletedCount).toBe(0);
      }
    );

    // Verify Clinic B patient is completely untouched
    await runWithTenantContext(
      {
        clinicId: clinicB,
        actor: { type: 'USER', id: 'doctor_b' },
      },
      async () => {
        const pB = await Patient.findById(patientBId);
        expect(pB).not.toBeNull();
        expect(pB?.name).toBe('Clinic B Patient');
      }
    );
  });

  it('rejects attempts to modify or change clinicId on existing records', async () => {
    let patientId: any;

    await runWithTenantContext(
      {
        clinicId: clinicA,
        actor: { type: 'USER', id: 'doctor_a' },
      },
      async () => {
        const p = await Patient.create({
          name: 'Immutable ClinicId Patient',
          patientCode: 'P-000003',
          ageYears: 30,
          sex: 'Male',
          phone: '9822000003',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
        });
        patientId = p._id;

        // Attempt to change clinicId via save()
        p.clinicId = clinicB;
        await expect(p.save()).rejects.toThrow(TenantIsolationViolationError);

        // Attempt to change clinicId via update query
        await expect(
          Patient.updateOne({ _id: patientId }, { $set: { clinicId: clinicB } })
        ).rejects.toThrow(TenantIsolationViolationError);
      }
    );
  });

  it('enforces tenancy on insertMany and aggregate pipelines', async () => {
    // 1. insertMany without context throws TenantContextMissingError
    await expect(
      Patient.insertMany([
        {
          name: 'Batch 1',
          patientCode: 'P-999001',
          ageYears: 20,
          sex: 'Male',
          phone: '9822000991',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
        },
      ])
    ).rejects.toThrow(TenantContextMissingError);

    // 2. insertMany with mismatched clinicId throws TenantIsolationViolationError
    await runWithTenantContext(
      {
        clinicId: clinicA,
        actor: { type: 'USER', id: 'doctor_a' },
      },
      async () => {
        await expect(
          Patient.insertMany([
            {
              clinicId: clinicB,
              name: 'Mismatched Patient',
              patientCode: 'P-999002',
              ageYears: 20,
              sex: 'Male',
              phone: '9822000992',
              source: 'WALK_IN',
              consentAt: clock.now(),
              consentTextVersion: '1.0',
            },
          ])
        ).rejects.toThrow(TenantIsolationViolationError);

        // Valid insertMany works and populates clinicId
        const inserted = await Patient.insertMany([
          {
            name: 'Valid Batch Patient',
            patientCode: 'P-999003',
            ageYears: 22,
            sex: 'Female',
            phone: '9822000993',
            source: 'WALK_IN',
            consentAt: clock.now(),
            consentTextVersion: '1.0',
          },
        ]);
        expect(inserted[0].clinicId.toString()).toBe(clinicA.toString());
      }
    );

    // 3. Aggregate without context throws TenantContextMissingError
    await expect(Patient.aggregate([{ $match: {} }])).rejects.toThrow(TenantContextMissingError);

    // 4. Aggregate under systemAdminScope bypasses clinicId injection
    await systemAdminScope(async () => {
      const allAgg = await Patient.aggregate([{ $group: { _id: null, count: { $sum: 1 } } }]);
      expect(allAgg).toBeDefined();
    });
  });

  describe('Tenant Context Lifecycle & High Concurrency Isolation', () => {
    beforeEach(async () => {
      // Pre-seed 1 patient in Clinic A
      await runWithTenantContext(
        { clinicId: clinicA, actor: { type: 'USER', id: 'doctor_a' } },
        async () => {
          await Patient.create({
            name: 'Clinic A Patient',
            patientCode: 'P-000001',
            ageYears: 25,
            sex: 'Male',
            phone: '9822000001',
            source: 'WALK_IN',
            consentAt: clock.now(),
            consentTextVersion: '1.0',
          });
        }
      );

      // Pre-seed 1 patient in Clinic B
      await runWithTenantContext(
        { clinicId: clinicB, actor: { type: 'USER', id: 'doctor_b' } },
        async () => {
          await Patient.create({
            name: 'Clinic B Patient',
            patientCode: 'P-000002',
            ageYears: 40,
            sex: 'Female',
            phone: '9822000002',
            source: 'WALK_IN',
            consentAt: clock.now(),
            consentTextVersion: '1.0',
          });
        }
      );
    });

    it('query created inside tenant context but awaited outside throws TenantContextMissingError', async () => {
      let queryCreatedInside: any;

      await runWithTenantContext(
        { clinicId: clinicA, actor: { type: 'USER', id: 'doctor_a' } },
        () => {
          // Construct query object inside context
          queryCreatedInside = Patient.find({ name: 'Clinic A Patient' });
        }
      );

      // Await execution outside tenant context
      await expect(queryCreatedInside).rejects.toThrow(TenantContextMissingError);
    });

    it('query created outside tenant context and awaited inside applies tenant isolation', async () => {
      // Construct unexecuted query object outside any context
      const queryOutside = Patient.find({});

      // Await execution inside Clinic A's context
      const resultsA = await runWithTenantContext(
        { clinicId: clinicA, actor: { type: 'USER', id: 'doctor_a' } },
        async () => await queryOutside
      );

      // Execution strictly scoped to Clinic A
      expect(resultsA).toHaveLength(1);
      expect(resultsA[0].name).toBe('Clinic A Patient');
      expect(resultsA[0].clinicId.toString()).toBe(clinicA.toString());
    });

    it('supports nested tenant contexts correctly (Context A -> Context B -> restores Context A)', async () => {
      await runWithTenantContext(
        { clinicId: clinicA, actor: { type: 'USER', id: 'doctor_a' } },
        async () => {
          // Outer level: Clinic A
          const outerInitial = await Patient.find({});
          expect(outerInitial).toHaveLength(1);
          expect(outerInitial[0].name).toBe('Clinic A Patient');

          // Nested level: Clinic B
          await runWithTenantContext(
            { clinicId: clinicB, actor: { type: 'USER', id: 'doctor_b' } },
            async () => {
              const inner = await Patient.find({});
              expect(inner).toHaveLength(1);
              expect(inner[0].name).toBe('Clinic B Patient');
            }
          );

          // Returned to outer level: restored to Clinic A
          const outerRestored = await Patient.find({});
          expect(outerRestored).toHaveLength(1);
          expect(outerRestored[0].name).toBe('Clinic A Patient');
        }
      );
    });

    it('100 interleaved concurrent requests across 5 clinics never cross-contaminate data', async () => {
      const clinics = Array.from({ length: 5 }, () => new Types.ObjectId());

      // Seed 1 patient per clinic
      for (let c = 0; c < clinics.length; c++) {
        await runWithTenantContext(
          { clinicId: clinics[c], actor: { type: 'USER', id: `doctor_${c}` } },
          async () => {
            await Patient.create({
              name: `Concurrent Patient Clinic ${c}`,
              patientCode: `P-CC-${c}`,
              ageYears: 20 + c,
              sex: 'Male',
              phone: `982299900${c}`,
              source: 'WALK_IN',
              consentAt: clock.now(),
              consentTextVersion: '1.0',
            });
          }
        );
      }

      // Launch 100 interleaved asynchronous requests with random delays
      const concurrentTasks = Array.from({ length: 100 }, async (_, index) => {
        const clinicIdx = index % clinics.length;
        const targetClinicId = clinics[clinicIdx];

        return runWithTenantContext(
          { clinicId: targetClinicId, actor: { type: 'USER', id: `actor_${index}` } },
          async () => {
            // Introduce event loop jitter
            await new Promise((res) => setTimeout(res, Math.floor(Math.random() * 25)));

            // Query patients
            const patients = await Patient.find({});
            expect(patients).toHaveLength(1);
            expect(patients[0].clinicId.toString()).toBe(targetClinicId.toString());
            expect(patients[0].name).toBe(`Concurrent Patient Clinic ${clinicIdx}`);

            // Count query
            const count = await Patient.countDocuments({});
            expect(count).toBe(1);

            // Aggregate query
            const agg = await Patient.aggregate([{ $group: { _id: null, count: { $sum: 1 } } }]);
            expect(agg).toHaveLength(1);
            expect(agg[0].count).toBe(1);

            return true;
          }
        );
      });

      const taskResults = await Promise.all(concurrentTasks);
      expect(taskResults).toHaveLength(100);
      expect(taskResults.every((res) => res === true)).toBe(true);
    });
  });
});
