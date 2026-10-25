import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { systemScope, runWithTenantContext, TenantActor } from '@/lib/tenancy';
import { Clinic } from '@/models/Clinic';
import { PrescriptionSet } from '@/models/PrescriptionSet';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import {
  listPrescriptionSets,
  createPrescriptionSet,
  updatePrescriptionSet,
  softDeletePrescriptionSet,
} from '@/lib/prescription-set-service';

describe('Prescription Sets (Templates) Service', () => {
  let clinicId: mongoose.Types.ObjectId;
  const doctorActor: TenantActor = { type: 'USER', id: 'doc_susheel_sets_test' };

  beforeAll(async () => {
    await connectDb();

    // Create test clinic
    const clinic = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Prescription Sets Test Clinic" },
      {
        $setOnInsert: {
          address: 'Station Road, Chhatrapati Sambhajinagar',
          phone: '+91-98220-33445',
          email: 'sets.test@clinic.com',
          registrationNo: 'MH-SETS-TEST-001',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicId = clinic._id;
  });

  afterAll(async () => {
    await systemScope(clinicId, async () => {
      await PrescriptionSet.deleteMany({ clinicId });
      await Clinic.deleteMany({ _id: clinicId });
    });
    await disconnectDb();
  });

  it('creates a new template set and audits SET_CREATE', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const input = {
          name: 'After Extraction Protocol',
          items: [
            {
              name: 'Amoxicillin',
              form: 'capsule',
              strength: '500 mg',
              dose: '1 capsule',
              frequency: '1-0-1',
              duration: '5 days',
              instructions: 'After food',
            },
            {
              name: 'Ketorolac Tromethamine',
              form: 'tablet',
              strength: '10 mg',
              dose: '1 tablet',
              frequency: '1-0-1',
              duration: '3 days',
              instructions: 'After food (SOS)',
            },
          ],
        };

        const created = await createPrescriptionSet(clinicId, input, doctorActor);
        expect(created).toBeDefined();
        expect(created.name).toBe('After Extraction Protocol');
        expect(created.items).toHaveLength(2);
        expect(created.items[0].medicineSnapshot.name).toBe('Amoxicillin');

        // Verify Audit Log
        const audit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.SET_CREATE,
          entityId: created._id.toString(),
        });
        expect(audit).toBeDefined();
        expect(audit?.meta?.name).toBe('After Extraction Protocol');
      }
    );
  });

  it('lists active prescription sets alphabetically', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        // Add a second set
        await createPrescriptionSet(
          clinicId,
          {
            name: 'Acute Pulpitis Emergency',
            items: [
              {
                name: 'Paracetamol',
                form: 'tablet',
                strength: '650 mg',
                dose: '1 tab',
                frequency: '1-1-1',
                duration: '2 days',
                instructions: 'After food',
              },
            ],
          },
          doctorActor
        );

        const sets = await listPrescriptionSets(clinicId);
        expect(sets.length).toBeGreaterThanOrEqual(2);
        // Sorted alphabetically: 'Acute Pulpitis Emergency' comes before 'After Extraction Protocol'
        expect(sets[0].name).toBe('Acute Pulpitis Emergency');
        expect(sets[1].name).toBe('After Extraction Protocol');
      }
    );
  });

  it('updates a prescription set and audits SET_UPDATE', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const existing = await PrescriptionSet.findOne({ clinicId, name: 'Acute Pulpitis Emergency' });
        expect(existing).toBeDefined();

        const updated = await updatePrescriptionSet(
          clinicId,
          existing!._id,
          {
            name: 'Acute Pulpitis Emergency (Updated)',
            items: [
              ...existing!.items.map((i) => ({
                name: i.medicineSnapshot.name,
                form: i.medicineSnapshot.form,
                strength: i.medicineSnapshot.strength,
                dose: i.dose,
                frequency: i.frequency,
                duration: i.duration,
                instructions: i.instructions,
              })),
              {
                name: 'Pantoprazole',
                form: 'tablet',
                strength: '40 mg',
                dose: '1 tab',
                frequency: '1-0-0',
                duration: '2 days',
                instructions: 'Before food',
              },
            ],
          },
          doctorActor
        );

        expect(updated.name).toBe('Acute Pulpitis Emergency (Updated)');
        expect(updated.items).toHaveLength(2);

        // Verify Audit Log
        const audit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.SET_UPDATE,
          entityId: updated._id.toString(),
        });
        expect(audit).toBeDefined();
      }
    );
  });

  it('soft-deletes a prescription set and excludes it from future listings', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const existing = await PrescriptionSet.findOne({ clinicId, name: 'Acute Pulpitis Emergency (Updated)' });
        expect(existing).toBeDefined();

        await softDeletePrescriptionSet(clinicId, existing!._id, doctorActor);

        // Still exists in DB with deletedAt
        const inDb = await PrescriptionSet.findById(existing!._id);
        expect(inDb?.deletedAt).toBeInstanceOf(Date);

        // Excluded from listPrescriptionSets
        const activeSets = await listPrescriptionSets(clinicId);
        expect(activeSets.find((s) => s._id.toString() === existing!._id.toString())).toBeUndefined();

        // Verify Audit Log
        const audit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.SET_DELETE,
          entityId: existing!._id.toString(),
        });
        expect(audit).toBeDefined();
        expect(audit?.meta?.name).toBe('Acute Pulpitis Emergency (Updated)');
      }
    );
  });
});
