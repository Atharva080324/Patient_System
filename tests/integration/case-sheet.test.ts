import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { systemScope, runWithTenantContext, TenantActor } from '@/lib/tenancy';
import { Clinic } from '@/models/Clinic';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { CaseSheet } from '@/models/CaseSheet';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import {
  getOrCreateCaseSheet,
  saveCaseSheet,
  VersionConflictError,
} from '@/lib/case-sheet-service';
import { clock } from '@/lib/clock';

describe('Case Sheet Service, Versioning & Concurrency Conflicts', () => {
  let clinicId: mongoose.Types.ObjectId;
  let patientId: mongoose.Types.ObjectId;
  let visitId: mongoose.Types.ObjectId;
  const doctorActor: TenantActor = { type: 'USER', id: 'doc_susheel_123' };

  beforeAll(async () => {
    await connectDb();

    // Setup clinic
    const clinic = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Advanced Dental Clinic & Implant Center" },
      {
        $setOnInsert: {
          address: 'Chhatrapati Sambhajinagar',
          phone: '+91-98220-11223',
          email: 'dr.susheel.casesheet@test.com',
          registrationNo: 'MH-DENT-CS-001',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicId = clinic._id;

    await systemScope(clinicId, async () => {
      // Setup patient with initial allergies
      const patient = await Patient.create({
        clinicId,
        patientCode: 'P-CS-001',
        name: 'CaseSheet Patient',
        phone: '9822000001',
        sex: 'Female',
        ageYears: 29,
        medicalHistory: {
          allergies: ['Penicillin'],
          conditions: ['Diabetes'],
          currentMedications: [],
          habits: [],
        },
        consentAt: clock.now(),
        consentTextVersion: '1.0',
        createdBy: doctorActor,
      });
      patientId = patient._id;

      // Setup visit
      const visit = await Visit.create({
        clinicId,
        patientId,
        date: '2026-10-25',
        token: 101,
        type: 'WALK_IN',
        status: 'IN_CONSULTATION',
        checkInAt: clock.now(),
        reasonForVisit: 'Severe throbbing molar pain',
        version: 1,
        createdBy: doctorActor,
      });
      visitId = visit._id;
    });
  });

  afterAll(async () => {
    await systemScope(clinicId, async () => {
      await CaseSheet.deleteMany({ clinicId });
      await Visit.deleteMany({ clinicId, _id: visitId });
      await Patient.deleteMany({ clinicId, _id: patientId });
    });
    await disconnectDb();
  });

  it('initializes a new CaseSheet with patient allergies and audits CASE_SHEET_VIEW', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const sheet = await getOrCreateCaseSheet(clinicId, visitId, doctorActor);

        expect(sheet).toBeDefined();
        expect(sheet.version).toBe(1);
        expect(sheet.chiefComplaint).toBe('Severe throbbing molar pain');
        expect(sheet.allergies).toEqual(['Penicillin']);
        expect(sheet.teethEntries).toEqual([]);

        // Verify audit log
        const audit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.CASE_SHEET_VIEW,
          entityId: sheet._id.toString(),
        });
        expect(audit).toBeDefined();
        expect(audit?.meta?.visitId).toBe(visitId.toString());
      }
    );
  });

  it('updates case sheet, increments version, and logs field NAMES only in audit trail', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const sheetBefore = await CaseSheet.findOne({ clinicId, visitId });
        expect(sheetBefore?.version).toBe(1);

        const updated = await saveCaseSheet(
          clinicId,
          visitId,
          {
            version: 1,
            chiefComplaint: 'Severe throbbing pain in lower right jaw #46',
            examinationFindings: 'Deep distal occlusal caries #46 with tenderness on vertical percussion',
            diagnosis: 'Acute Irreversible Pulpitis #46 with Apical Periodontitis',
            treatmentDoneOrAdvised: 'Root Canal Treatment advised. Biopulpectomy initiated.',
            teethEntries: [
              {
                tooth: 46,
                condition: 'Deep Dentinal Caries',
                notes: 'RCT initiated under local anesthesia',
              },
            ],
          },
          doctorActor
        );

        expect(updated.version).toBe(2);
        expect(updated.diagnosis).toBe('Acute Irreversible Pulpitis #46 with Apical Periodontitis');
        expect(updated.teethEntries).toHaveLength(1);
        expect(updated.teethEntries[0].tooth).toBe(46);

        // Verify Audit Log: strictly field names only, zero clinical text or PII
        const updateAudit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.CASE_SHEET_UPDATE,
          entityId: updated._id.toString(),
        }).sort({ at: -1 });

        expect(updateAudit).toBeDefined();
        expect(updateAudit?.meta?.fromVersion).toBe(1);
        expect(updateAudit?.meta?.toVersion).toBe(2);
        const changedFields = updateAudit?.meta?.changedFields as string[];
        expect(changedFields).toEqual(
          expect.arrayContaining(['chiefComplaint', 'examinationFindings', 'diagnosis', 'treatmentDoneOrAdvised', 'teethEntries'])
        );

        // Verify no clinical values exist in the audit log document
        const auditJson = JSON.stringify(updateAudit?.toObject());
        expect(auditJson).not.toContain('Acute Irreversible Pulpitis');
        expect(auditJson).not.toContain('Biopulpectomy');
      }
    );
  });

  it('syncs updated allergies to the patient master record', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const currentSheet = await CaseSheet.findOne({ clinicId, visitId });
        const newAllergies = ['Penicillin', 'Sulfa Drugs', 'Ibuprofen'];

        await saveCaseSheet(
          clinicId,
          visitId,
          {
            version: currentSheet!.version,
            allergies: newAllergies,
          },
          doctorActor
        );

        const patientRecord = await Patient.findOne({ clinicId, _id: patientId });
        expect(patientRecord?.medicalHistory?.allergies).toEqual(newAllergies);
      }
    );
  });

  it('rejects concurrent edit with 409 VersionConflictError when incoming version is stale', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const currentSheet = await CaseSheet.findOne({ clinicId, visitId });
        const currentVersion = currentSheet!.version;

        // Simulate Tab 1 saving successfully and incrementing version
        await saveCaseSheet(
          clinicId,
          visitId,
          {
            version: currentVersion,
            notes: 'Tab 1 saved notes',
          },
          doctorActor
        );

        const sheetAfterTab1 = await CaseSheet.findOne({ clinicId, visitId });
        expect(sheetAfterTab1?.version).toBe(currentVersion + 1);

        // Simulate Tab 2 trying to save with the old version
        await expect(
          saveCaseSheet(
            clinicId,
            visitId,
            {
              version: currentVersion, // Stale!
              notes: 'Tab 2 conflicting notes',
            },
            doctorActor
          )
        ).rejects.toThrowError(VersionConflictError);

        // Ensure Tab 1 data was preserved and not overwritten
        const fresh = await CaseSheet.findOne({ clinicId, visitId });
        expect(fresh?.notes).toBe('Tab 1 saved notes');
        expect(fresh?.version).toBe(currentVersion + 1);
      }
    );
  });

  it('rejects invalid FDI tooth number in case sheet tooth entries', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const currentSheet = await CaseSheet.findOne({ clinicId, visitId });

        await expect(
          saveCaseSheet(
            clinicId,
            visitId,
            {
              version: currentSheet!.version,
              teethEntries: [
                {
                  tooth: 99, // Invalid!
                  condition: 'Caries',
                },
              ],
            },
            doctorActor
          )
        ).rejects.toThrow();
      }
    );
  });
});
