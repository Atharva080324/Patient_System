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
});
