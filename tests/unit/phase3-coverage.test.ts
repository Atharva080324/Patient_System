import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { systemScope, runWithTenantContext, TenantActor } from '@/lib/tenancy';
import { Clinic } from '@/models/Clinic';
import { User } from '@/models/User';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { CaseSheet } from '@/models/CaseSheet';
import { Medicine } from '@/models/Medicine';
import { DoctorMedicine } from '@/models/DoctorMedicine';
import { Prescription } from '@/models/Prescription';
import { PrescriptionSet } from '@/models/PrescriptionSet';
import {
  getOrCreateCaseSheet,
  saveCaseSheet,
  VersionConflictError,
} from '@/lib/case-sheet-service';
import {
  searchMedicines,
  toggleMedicineFavorite,
  createCustomMedicine,
  deactivateCustomMedicine,
} from '@/lib/medicine-search';
import {
  getPrescriptionForVisit,
  savePrescriptionDraft,
  issuePrescription,
  voidPrescription,
  createCorrectionPrescription,
  recordPrescriptionPrint,
} from '@/lib/prescription-service';
import {
  updatePrescriptionSet,
  softDeletePrescriptionSet,
} from '@/lib/prescription-set-service';
import { clock } from '@/lib/clock';

describe('Phase 3 Core Modules: 90% Per-File Coverage Hardening', () => {
  let clinicId: mongoose.Types.ObjectId;
  let testPatient: any;
  let testVisit: any;
  const doctorActor: TenantActor = { type: 'USER', id: 'cov_doc_phase3' };

  beforeAll(async () => {
    await connectDb();

    const clinic = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Coverage Hardening Clinic" },
      {
        $setOnInsert: {
          address: 'Station Road, Chhatrapati Sambhajinagar',
          phone: '+91-98220-88990',
          email: 'cov.p3@clinic.com',
          registrationNo: 'MH-COV-P3-001',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicId = clinic._id;

    await systemScope(clinicId, async () => {
      // Doctor user
      await User.findOneAndUpdate(
        { clinicId, role: 'DOCTOR' },
        {
          $setOnInsert: {
            name: 'Dr. Susheel Shinde',
            email: 'dr.susheel.cov3@example.com',
            passwordHash: 'dummy',
            role: 'DOCTOR',
            totpEnabled: false,
            recoveryCodes: [],
            createdBy: { type: 'SYSTEM', id: 'test' },
          },
        },
        { upsert: true, returnDocument: 'after' }
      );

      // Patient
      testPatient = await Patient.create({
        clinicId,
        patientCode: 'P-COV3-01',
        name: 'Coverage Patient',
        phone: '9822001122',
        sex: 'Female',
        ageYears: 25,
        medicalHistory: {
          allergies: [],
          conditions: [],
          currentMedications: [],
          habits: [],
        },
        consentAt: clock.now(),
        consentTextVersion: '1.0',
        createdBy: doctorActor,
      });

      // Visit
      testVisit = await Visit.create({
        clinicId,
        patientId: testPatient._id,
        date: '2026-10-25',
        token: 301,
        type: 'WALK_IN',
        status: 'IN_CONSULTATION',
        checkInAt: clock.now(),
        reasonForVisit: 'Routine test checkup',
        version: 1,
        createdBy: doctorActor,
      });
    });
  });

  afterAll(async () => {
    await systemScope(clinicId, async () => {
      await Prescription.deleteMany({ clinicId });
      await CaseSheet.deleteMany({ clinicId });
      await Medicine.deleteMany({ clinicId });
      await DoctorMedicine.deleteMany({ clinicId });
      await PrescriptionSet.deleteMany({ clinicId });
      await Visit.deleteMany({ clinicId });
      await Patient.deleteMany({ clinicId });
      await Clinic.deleteMany({ _id: clinicId });
    });
    await disconnectDb();
  });

  describe('case-sheet-service branches', () => {
    it('throws error when getOrCreateCaseSheet is called with non-existent visit', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const fakeId = new mongoose.Types.ObjectId();
        await expect(getOrCreateCaseSheet(clinicId, fakeId, doctorActor)).rejects.toThrow(
          /Visit not found/
        );
      });
    });

    it('throws error when saveCaseSheet is called for non-existent case sheet', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const fakeId = new mongoose.Types.ObjectId();
        await expect(
          saveCaseSheet(clinicId, fakeId, { version: 1, chiefComplaint: 'Pain' }, doctorActor)
        ).rejects.toThrow(/Case sheet not found/);
      });
    });

    it('returns existing case sheet without database update when no fields changed', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const sheet = await getOrCreateCaseSheet(clinicId, testVisit._id, doctorActor);
        const savedAgain = await saveCaseSheet(
          clinicId,
          testVisit._id,
          {
            version: sheet.version,
            chiefComplaint: sheet.chiefComplaint, // Same value
          },
          doctorActor
        );
        // Version should remain unchanged because no fields actually changed
        expect(savedAgain.version).toBe(sheet.version);
      });
    });

    it('handles race condition when findOneAndUpdate returns null', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const sheet = await getOrCreateCaseSheet(clinicId, testVisit._id, doctorActor);

        const spy = vi.spyOn(CaseSheet, 'findOneAndUpdate').mockResolvedValueOnce(null as any);
        await expect(
          saveCaseSheet(
            clinicId,
            testVisit._id,
            {
              version: sheet.version,
              chiefComplaint: 'New complaint during race',
            },
            doctorActor
          )
        ).rejects.toThrowError(VersionConflictError);
        spy.mockRestore();
      });
    });

    it('handles race condition when CaseSheet.create throws code 11000 duplicate key', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const dummyVisit = await Visit.create({
          clinicId,
          patientId: testPatient._id,
          date: '2026-10-25',
          token: 399,
          type: 'WALK_IN',
          status: 'COMPLETED',
          checkInAt: clock.now(),
          reasonForVisit: 'Race test',
          version: 1,
          createdBy: doctorActor,
        });

        // Pre-create the case sheet so findOne on recovery finds it
        const preCreated = await CaseSheet.create({
          clinicId,
          visitId: dummyVisit._id,
          patientId: testPatient._id,
          version: 1,
          chiefComplaint: 'Pre-created',
          createdBy: doctorActor,
        });

        // Mock findOne to return null on the initial check (lines 37-40), but allow subsequent findOne to find it
        const originalFindOne = CaseSheet.findOne.bind(CaseSheet);
        let findOneCount = 0;
        const spyFindOne = vi.spyOn(CaseSheet, 'findOne').mockImplementation((...args: any[]) => {
          findOneCount++;
          if (findOneCount === 1) {
            return {
              session: () => Promise.resolve(null),
              then: (resolve: any) => Promise.resolve(null).then(resolve),
            } as any;
          }
          return (originalFindOne as any)(...args);
        });

        const dupError: any = new Error('E11000 duplicate key');
        dupError.code = 11000;
        const spyCreate = vi.spyOn(CaseSheet, 'create').mockRejectedValueOnce(dupError);

        const recovered = await getOrCreateCaseSheet(clinicId, dummyVisit._id, doctorActor);
        expect(recovered._id.toString()).toBe(preCreated._id.toString());

        spyFindOne.mockRestore();
        spyCreate.mockRestore();
        await CaseSheet.deleteMany({ visitId: dummyVisit._id });
        await Visit.deleteMany({ _id: dummyVisit._id });
      });
    });

    it('syncs updated allergies to Patient record', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const sheet = await getOrCreateCaseSheet(clinicId, testVisit._id, doctorActor);
        const updated = await saveCaseSheet(
          clinicId,
          testVisit._id,
          {
            version: sheet.version,
            allergies: ['Penicillin', 'Sulfa'],
          },
          doctorActor
        );
        expect(updated.allergies).toContain('Penicillin');
        const p = await Patient.findById(testPatient._id);
        expect(p?.medicalHistory?.allergies).toContain('Penicillin');
      });
    });

    it('creates case sheet when patient has no medicalHistory', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const rawPatient = await Patient.create({
          clinicId,
          patientCode: 'P-NO-HIST-01',
          name: 'No History Patient',
          phone: '9822009988',
          sex: 'Male',
          ageYears: 30,
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActor,
        });

        // Set status to WAITING so it does not collide with IN_CONSULTATION partial unique index
        const visitNoHist = await Visit.create({
          clinicId,
          patientId: rawPatient._id,
          date: '2026-10-25',
          token: 399,
          type: 'WALK_IN',
          status: 'WAITING',
          reasonForVisit: 'General checkup',
          checkInAt: clock.now(),
          version: 1,
          createdBy: doctorActor,
        });

        const sheet = await getOrCreateCaseSheet(clinicId, visitNoHist._id, doctorActor);
        expect(sheet.allergies).toEqual([]);
        expect(sheet.chiefComplaint).toBe('General checkup');
      });
    });

    it('creates case sheet when patient record is null or missing', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const dummyVisit = await Visit.create({
          clinicId,
          patientId: new mongoose.Types.ObjectId(),
          date: '2026-10-25',
          token: 386,
          type: 'WALK_IN',
          status: 'WAITING',
          reasonForVisit: 'Missing patient checkup',
          checkInAt: clock.now(),
          version: 1,
          createdBy: doctorActor,
        });

        const sheet = await getOrCreateCaseSheet(clinicId, dummyVisit._id, doctorActor);
        expect(sheet.allergies).toEqual([]);
        expect(sheet.chiefComplaint).toBe('Missing patient checkup');
        await CaseSheet.deleteMany({ visitId: dummyVisit._id });
        await Visit.deleteMany({ _id: dummyVisit._id });
      });
    });

    it('re-throws unexpected error when CaseSheet.create fails with non-11000 error', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const dummyVisit = await Visit.create({
          clinicId,
          patientId: testPatient._id,
          date: '2026-10-25',
          token: 388,
          type: 'WALK_IN',
          status: 'WAITING',
          checkInAt: clock.now(),
          reasonForVisit: 'Error test',
          version: 1,
          createdBy: doctorActor,
        });

        const spyCreate = vi.spyOn(CaseSheet, 'create').mockRejectedValueOnce(new Error('Fatal DB Connection Error'));
        await expect(getOrCreateCaseSheet(clinicId, dummyVisit._id, doctorActor)).rejects.toThrow(
          /Fatal DB Connection Error/
        );
        spyCreate.mockRestore();
        await Visit.deleteMany({ _id: dummyVisit._id });
      });
    });

    it('re-throws duplicate key error if existing sheet is not found after code 11000', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const dummyVisit = await Visit.create({
          clinicId,
          patientId: testPatient._id,
          date: '2026-10-25',
          token: 387,
          type: 'WALK_IN',
          status: 'WAITING',
          checkInAt: clock.now(),
          reasonForVisit: 'Dup error test',
          version: 1,
          createdBy: doctorActor,
        });

        const dupError: any = new Error('E11000 duplicate key');
        dupError.code = 11000;
        const spyCreate = vi.spyOn(CaseSheet, 'create').mockRejectedValueOnce(dupError);
        const spyFindOne = vi.spyOn(CaseSheet, 'findOne').mockResolvedValue(null as any);

        await expect(getOrCreateCaseSheet(clinicId, dummyVisit._id, doctorActor)).rejects.toThrow(
          /E11000 duplicate key/
        );
        spyCreate.mockRestore();
        spyFindOne.mockRestore();
        await Visit.deleteMany({ _id: dummyVisit._id });
      });
    });

    it('saves and detects changes in teethEntries array', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const sheet = await getOrCreateCaseSheet(clinicId, testVisit._id, doctorActor);
        const updated = await saveCaseSheet(
          clinicId,
          testVisit._id,
          {
            version: sheet.version,
            teethEntries: [{ tooth: 11, condition: 'Caries / Cavity' }], // notes undefined
          },
          doctorActor
        );
        expect(updated.teethEntries).toHaveLength(1);
        expect(updated.teethEntries[0].tooth).toBe(11);

        // Saving identical teethEntries should return existing without incrementing version
        const savedSame = await saveCaseSheet(
          clinicId,
          testVisit._id,
          {
            version: updated.version,
            teethEntries: [{ tooth: 11, condition: 'Caries / Cavity' }],
          },
          doctorActor
        );
        expect(savedSame.version).toBe(updated.version);
      });
    });

    it('uses existing case sheet in VersionConflictError if fresh findOne returns null', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const sheet = await getOrCreateCaseSheet(clinicId, testVisit._id, doctorActor);
        const spyUpdate = vi.spyOn(CaseSheet, 'findOneAndUpdate').mockResolvedValueOnce(null as any);
        let findCount = 0;
        const origFindOne = CaseSheet.findOne.bind(CaseSheet);
        const spyFind = vi.spyOn(CaseSheet, 'findOne').mockImplementation((...args: any[]) => {
          findCount++;
          if (findCount === 1) return (origFindOne as any)(...args);
          return {
            session: () => Promise.resolve(null),
            then: (resolve: any) => Promise.resolve(null).then(resolve),
          } as any;
        });

        try {
          await saveCaseSheet(
            clinicId,
            testVisit._id,
            { version: sheet.version, chiefComplaint: 'Testing null fresh' },
            doctorActor
          );
        } catch (e: any) {
          expect(e).toBeInstanceOf(VersionConflictError);
          expect(e.latestCaseSheet).toBeDefined();
        } finally {
          spyUpdate.mockRestore();
          spyFind.mockRestore();
        }
      });
    });
  });

  describe('medicine-search branches', () => {
    it('exercises substring contains search fallback when prefix matches are fewer than limit', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        await Medicine.create({
          clinicId,
          genericName: 'Sodium Fluoride Varnish',
          brandName: 'FluorProtector',
          form: 'gel',
          strength: '5%',
          category: 'Preventive',
          source: 'FORMULARY',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        });

        // Search 'Varnish' (substring match on genericName, not prefix)
        const results = await searchMedicines(clinicId, 'Varnish', 5);
        expect(results.some((m) => m.genericName.includes('Fluoride'))).toBe(true);
      });
    });

    it('toggles medicine favorite on and off', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const med = await Medicine.create({
          clinicId,
          genericName: 'Diclofenac Sodium',
          brandName: 'Voveran',
          form: 'tablet',
          strength: '50mg',
          category: 'Analgesic',
          source: 'FORMULARY',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        });

        // Toggle favorite on (no previous DoctorMedicine record)
        const res1 = await toggleMedicineFavorite(clinicId, med._id, doctorActor);
        expect(res1.isFavorite).toBe(true);

        // Toggle favorite off (existing DoctorMedicine record)
        const res2 = await toggleMedicineFavorite(clinicId, med._id, doctorActor);
        expect(res2.isFavorite).toBe(false);
      });
    });

    it('sorts empty query results by favorites and useCount, supplements with extra medicines, and exercises search ranking comparator', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const medA = await Medicine.create({
          clinicId,
          genericName: 'Amoxicillin Trihydrate',
          brandName: 'Mox 500',
          form: 'capsule',
          strength: '500mg',
          category: 'Antibiotic',
          source: 'FORMULARY',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        });

        const medB = await Medicine.create({
          clinicId,
          genericName: 'Amoxicillin with Sulbactam',
          brandName: 'Amoxirum',
          form: 'tablet',
          strength: '375mg',
          category: 'Antibiotic',
          source: 'FORMULARY',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        });

        const medC = await Medicine.create({
          clinicId,
          genericName: 'Ampicillin Sodium',
          brandName: 'Campicillin',
          form: 'tablet',
          strength: '250mg',
          category: 'Antibiotic',
          source: 'FORMULARY',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        });

        // Set up DoctorMedicine metadata:
        // medA is favorite with 2 uses
        await DoctorMedicine.create({
          clinicId,
          medicineId: medA._id,
          isFavorite: true,
          useCount: 2,
          lastUsedAt: clock.now(),
          createdBy: doctorActor,
        });

        // medB is non-favorite with 10 uses
        await DoctorMedicine.create({
          clinicId,
          medicineId: medB._id,
          isFavorite: false,
          useCount: 10,
          lastUsedAt: clock.now(),
          createdBy: doctorActor,
        });

        // medC is non-favorite with 1 use
        await DoctorMedicine.create({
          clinicId,
          medicineId: medC._id,
          isFavorite: false,
          useCount: 1,
          lastUsedAt: clock.now(),
          createdBy: doctorActor,
        });

        const brandMatchOnly = await Medicine.create({
          clinicId,
          genericName: 'Cefixime Dispersible',
          brandName: 'Amoxcefix Brand',
          form: 'tablet',
          strength: '100mg',
          category: 'Antibiotic',
          source: 'FORMULARY',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        });

        // 1. Empty query with limit 10 -> will exercise lines 90-93 (favorite vs non-favorite, and useCount sort)
        // AND will exercise lines 101-108 (supplementing with active meds since formatted.length < limit)
        const emptyQueryResults = await searchMedicines(clinicId, '', 10);
        expect(emptyQueryResults.length).toBeGreaterThanOrEqual(3);
        // Favorite comes first
        expect(emptyQueryResults[0].genericName).toBe('Amoxicillin Trihydrate');

        // 2. Query 'Amox' -> medA has generic prefix, brandMatchOnly has brand prefix only
        // Exercises both aGenPrefix ? -1 : 1 branches and isFavorite comparator
        const prefixRanked = await searchMedicines(clinicId, 'Amox', 10);
        expect(prefixRanked.length).toBeGreaterThanOrEqual(3);
        expect(prefixRanked[0].genericName).toContain('Amoxicillin');

        // 3. Test empty query with limit 1 (hits formatted.slice(0, limit))
        const limited = await searchMedicines(clinicId, '', 1);
        expect(limited.length).toBe(1);
      });
    });

    it('reactivates an existing deactivated custom medicine when created again', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const med = await createCustomMedicine(
          clinicId,
          {
            genericName: 'Clove Oil',
            form: 'drops',
            strength: '100%',
          },
          doctorActor
        );
        expect(med.active).toBe(true);

        // Deactivate it
        await deactivateCustomMedicine(clinicId, med._id, doctorActor);
        const deactivated = await Medicine.findById(med._id);
        expect(deactivated?.active).toBe(false);

        // Create again with same name: should reactivate!
        const reactivated = await createCustomMedicine(
          clinicId,
          {
            genericName: 'Clove Oil',
            form: 'drops',
            strength: '100%',
          },
          doctorActor
        );
        expect(reactivated.active).toBe(true);
        expect(reactivated._id.toString()).toBe(med._id.toString());
      });
    });

    it('throws error when deactivating non-existent or non-custom medicine', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const fakeId = new mongoose.Types.ObjectId();
        await expect(deactivateCustomMedicine(clinicId, fakeId, doctorActor)).rejects.toThrow(
          /Custom medicine not found/
        );
      });
    });
  });

  describe('prescription-service branches', () => {
    it('exercises getPrescriptionForVisit', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const resNull = await getPrescriptionForVisit(clinicId, new mongoose.Types.ObjectId());
        expect(resNull).toBeNull();
      });
    });

    it('throws error when saving draft for non-existent visit', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const fakeId = new mongoose.Types.ObjectId();
        await expect(
          savePrescriptionDraft(clinicId, fakeId, { items: [], language: 'en' }, doctorActor)
        ).rejects.toThrow(/Visit not found/);
      });
    });

    it('updates an existing draft when savePrescriptionDraft is called again', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const draft1 = await savePrescriptionDraft(
          clinicId,
          testVisit._id,
          {
            items: [
              {
                name: 'Paracetamol',
                form: 'tab',
                strength: '650mg',
                frequency: '1-0-1',
                duration: '3 days',
              },
            ],
            advice: 'Take with food',
            language: 'en',
          },
          doctorActor
        );
        expect(draft1.advice).toBe('Take with food');

        const draft2 = await savePrescriptionDraft(
          clinicId,
          testVisit._id,
          {
            items: [
              {
                name: 'Paracetamol',
                form: 'tab',
                strength: '650mg',
                frequency: '1-0-1',
                duration: '5 days',
              },
            ],
            advice: 'Take after meals',
            language: 'en',
          },
          doctorActor
        );
        expect(draft2._id.toString()).toBe(draft1._id.toString());
        expect(draft2.advice).toBe('Take after meals');
      });
    });

    it('issues prescription with both catalog and freeform items and creates correction prescription', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const medSample = await Medicine.findOne({ clinicId });
        const draft = await savePrescriptionDraft(
          clinicId,
          testVisit._id,
          {
            items: [
              {
                medicineId: medSample?._id.toString(),
                name: medSample?.genericName || 'Amoxicillin',
                form: 'tablet',
                strength: '500mg',
                frequency: '1-0-1',
                duration: '5 days',
              },
              {
                name: 'Warm Saline Rinse',
                form: 'mouthwash',
                strength: 'saline',
                frequency: '0-0-1',
                duration: '7 days',
              },
            ],
            advice: 'Warm water with half spoon salt',
            language: 'en',
          },
          doctorActor
        );

        const issued = await issuePrescription(clinicId, draft._id, doctorActor);
        expect(issued.status).toBe('ISSUED');
        expect(issued.rxNumber).toMatch(/^RX\//);

        // Record print
        const printed = await recordPrescriptionPrint(clinicId, issued._id, doctorActor);
        expect(printed.printCount).toBe(1);

        // Issue prescription when doctor record is missing
        const spyDoc = vi.spyOn(User, 'findOne').mockReturnValueOnce({
          session: vi.fn().mockResolvedValueOnce(null),
        } as any);
        const draftNoDoc = await savePrescriptionDraft(
          clinicId,
          testVisit._id,
          {
            items: [
              {
                name: 'Paracetamol',
                form: 'tablet',
                strength: '650mg',
                frequency: '1-0-1',
                duration: '3 days',
              },
            ],
            language: 'en',
          },
          doctorActor
        );
        const issuedNoDoc = await issuePrescription(clinicId, draftNoDoc._id, doctorActor);
        expect(issuedNoDoc.status).toBe('ISSUED');
        expect(issuedNoDoc.snapshot.doctor.name).toBe('Dr. Susheel');
        spyDoc.mockRestore();

        // Correct prescription
        const correctedDraft = await createCorrectionPrescription(
          clinicId,
          issued._id,
          'Patient allergic to saline or needs additional medication',
          doctorActor
        );
        expect(correctedDraft.status).toBe('DRAFT');
        expect(correctedDraft.replacesPrescriptionId?.toString()).toBe(issued._id.toString());

        const voided = await Prescription.findById(issued._id);
        expect(voided?.status).toBe('VOID');
        expect(voided?.voidReason).toContain('allergic');
      });
    });

    it('throws error when issuing non-existent prescription or empty items', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const fakeId = new mongoose.Types.ObjectId();
        await expect(issuePrescription(clinicId, fakeId, doctorActor)).rejects.toThrow(
          /Prescription not found/
        );

        // Create draft with 0 items
        const emptyDraft = await savePrescriptionDraft(
          clinicId,
          testVisit._id,
          { items: [], language: 'en' },
          doctorActor
        );
        await expect(issuePrescription(clinicId, emptyDraft._id, doctorActor)).rejects.toThrow(
          /Cannot issue prescription with zero medicine items/
        );
      });
    });

    it('throws error when clinic or patient not found during issue', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const draft = await savePrescriptionDraft(
          clinicId,
          testVisit._id,
          {
            items: [
              {
                name: 'Amoxicillin',
                form: 'cap',
                strength: '500mg',
                frequency: '1-1-1',
                duration: '5 days',
              },
            ],
            language: 'en',
          },
          doctorActor
        );

        // Clinic not found error branch
        const fakeClinicId = new mongoose.Types.ObjectId();
        await expect(issuePrescription(fakeClinicId, draft._id, doctorActor)).rejects.toThrow(
          /Prescription not found|Clinic not found/
        );

        // Patient not found branch: update draft with fake patientId
        await Prescription.updateOne(
          { _id: draft._id },
          { $set: { patientId: new mongoose.Types.ObjectId() } }
        );
        await expect(issuePrescription(clinicId, draft._id, doctorActor)).rejects.toThrow(
          /Patient record not found/
        );
      });
    });

    it('throws error when voiding non-existent prescription or non-ISSUED prescription', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const fakeId = new mongoose.Types.ObjectId();
        await expect(voidPrescription(clinicId, fakeId, 'Reason', doctorActor)).rejects.toThrow(
          /Prescription not found/
        );

        // Try voiding a DRAFT prescription
        const draft = await Prescription.findOne({ clinicId, status: 'DRAFT' });
        if (draft) {
          await expect(voidPrescription(clinicId, draft._id, 'Reason', doctorActor)).rejects.toThrow(
            /Only ISSUED prescriptions can be voided/
          );
        }
      });
    });

    it('throws error when recordPrescriptionPrint is called for non-existent prescription', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const fakeId = new mongoose.Types.ObjectId();
        await expect(recordPrescriptionPrint(clinicId, fakeId, doctorActor)).rejects.toThrow(
          /Prescription not found/
        );
      });
    });
  });

  describe('prescription-set-service branches', () => {
    it('throws error when updating or deleting non-existent prescription set', async () => {
      await runWithTenantContext({ clinicId: clinicId.toString(), actor: doctorActor }, async () => {
        const fakeId = new mongoose.Types.ObjectId();
        await expect(
          updatePrescriptionSet(
            clinicId,
            fakeId,
            {
              name: 'Fake Set',
              items: [
                {
                  name: 'Med',
                  form: 'tab',
                  strength: '500mg',
                  frequency: '1-0-1',
                  duration: '3 days',
                },
              ],
            },
            doctorActor
          )
        ).rejects.toThrow(/Prescription set not found/);

        await expect(softDeletePrescriptionSet(clinicId, fakeId, doctorActor)).rejects.toThrow(
          /Prescription set not found/
        );
      });
    });
  });
});
