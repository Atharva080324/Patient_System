import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { systemScope, runWithTenantContext, TenantActor } from '@/lib/tenancy';
import { Clinic } from '@/models/Clinic';
import { User } from '@/models/User';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { Prescription } from '@/models/Prescription';
import { Counter } from '@/models/Counter';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import {
  savePrescriptionDraft,
  issuePrescription,
  voidPrescription,
  createCorrectionPrescription,
  recordPrescriptionPrint,
} from '@/lib/prescription-service';
import { financialYear } from '@/lib/date';
import { clock } from '@/lib/clock';

describe('Prescription Service: Gapless Numbering, Immutability & Void/Correction', () => {
  let clinicId: mongoose.Types.ObjectId;
  let doctorUser: any;
  let patient: any;
  let visit: any;
  const doctorActor: TenantActor = { type: 'USER', id: 'doc_susheel_rx_test' };

  beforeAll(async () => {
    await connectDb();

    // Create test clinic
    const clinic = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Prescription Test Clinic" },
      {
        $setOnInsert: {
          address: 'Station Road, Chhatrapati Sambhajinagar',
          phone: '+91-98220-44556',
          email: 'rx.test@clinic.com',
          registrationNo: 'MH-RX-TEST-001',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicId = clinic._id;

    await systemScope(clinicId, async () => {
      // Create doctor user
      doctorUser = await User.findOneAndUpdate(
        { clinicId, email: 'dr.susheel.rx@example.com' },
        {
          $setOnInsert: {
            name: 'Dr. Susheel Shinde',
            passwordHash: 'dummyHash',
            role: 'DOCTOR',
            totpEnabled: false,
            recoveryCodes: [],
            createdBy: { type: 'SYSTEM', id: 'test' },
          },
        },
        { upsert: true, returnDocument: 'after' }
      );

      // Create patient
      patient = await Patient.create({
        clinicId,
        patientCode: 'P-RX-001',
        name: 'Prescription Test Patient',
        phone: '9822099881',
        sex: 'Male',
        ageYears: 34,
        medicalHistory: {
          allergies: ['Amoxicillin'],
          conditions: [],
          currentMedications: [],
          habits: [],
        },
        consentAt: clock.now(),
        consentTextVersion: '1.0',
        createdBy: doctorActor,
      });

      // Create visit
      visit = await Visit.create({
        clinicId,
        patientId: patient._id,
        date: '2026-10-25',
        token: 201,
        type: 'WALK_IN',
        status: 'IN_CONSULTATION',
        checkInAt: clock.now(),
        reasonForVisit: 'Severe post-extraction pain',
        version: 1,
        createdBy: doctorActor,
      });
    });
  });

  afterAll(async () => {
    await systemScope(clinicId, async () => {
      await Prescription.deleteMany({ clinicId });
      await Visit.deleteMany({ clinicId });
      await Patient.deleteMany({ clinicId });
      await User.deleteMany({ clinicId, _id: doctorUser._id });
      await Clinic.deleteMany({ _id: clinicId });
      await Counter.deleteMany({ clinicId });
    });
    await disconnectDb();
  });

  it('creates and updates a DRAFT prescription without allocating an RX number', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const draft = await savePrescriptionDraft(
          clinicId,
          visit._id,
          {
            items: [
              {
                name: 'Ketorolac Tromethamine',
                form: 'tablet',
                strength: '10 mg',
                dose: '1 tablet',
                frequency: '1-0-1',
                duration: '3 days',
                instruction: 'After food (SOS for acute pain)',
                note: 'Max 3 days',
              },
            ],
            advice: 'Gargle with warm salt water after 24 hours.',
            followUpDate: '2026-10-28',
            language: 'en',
          },
          doctorActor
        );

        expect(draft).toBeDefined();
        expect(draft.status).toBe('DRAFT');
        expect(draft.rxNumber).toBeUndefined();
        expect(draft.items).toHaveLength(1);
        expect(draft.version).toBe(1);

        // Update the draft with an additional item
        const updatedDraft = await savePrescriptionDraft(
          clinicId,
          visit._id,
          {
            items: [
              {
                name: 'Ketorolac Tromethamine',
                form: 'tablet',
                strength: '10 mg',
                dose: '1 tablet',
                frequency: '1-0-1',
                duration: '3 days',
                instruction: 'After food',
                note: '',
              },
              {
                name: 'Pantoprazole',
                form: 'tablet',
                strength: '40 mg',
                dose: '1 tablet',
                frequency: '1-0-0',
                duration: '3 days',
                instruction: 'Before breakfast',
                note: '',
              },
            ],
            advice: 'Soft diet only.',
            followUpDate: '2026-10-28',
            language: 'en',
          },
          doctorActor
        );

        expect(updatedDraft._id.toString()).toBe(draft._id.toString());
        expect(updatedDraft.items).toHaveLength(2);
        expect(updatedDraft.version).toBe(2);
        expect(updatedDraft.rxNumber).toBeUndefined(); // Still no RX number in draft!
      }
    );
  });

  it('issues prescription inside transaction with gapless numbering and frozen snapshot', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const draft = await Prescription.findOne({ clinicId, visitId: visit._id, status: 'DRAFT' });
        expect(draft).toBeDefined();

        const fy = financialYear(clock.now());
        const expectedRxNumber = `RX/${fy}/0001`;

        const issued = await issuePrescription(clinicId, draft!._id, doctorActor);

        expect(issued.status).toBe('ISSUED');
        expect(issued.rxNumber).toBe(expectedRxNumber);
        expect(issued.snapshot).toBeDefined();
        expect(issued.snapshot?.rxNumber).toBe(expectedRxNumber);
        expect(issued.snapshot?.clinic.name).toContain("Dr. Susheel's Prescription Test Clinic");
        expect(issued.snapshot?.patient.name).toBe('Prescription Test Patient');
        expect(issued.snapshot?.items).toHaveLength(2);

        // Verify Audit Log
        const audit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.PRESCRIPTION_ISSUE,
          entityId: issued._id.toString(),
        });
        expect(audit).toBeDefined();
        expect(audit?.meta?.rxNumber).toBe(expectedRxNumber);

        // Verify Visit is linked to the prescription
        const updatedVisit = await Visit.findById(visit._id);
        expect(updatedVisit?.prescriptionId?.toString()).toBe(issued._id.toString());
      }
    );
  });

  it('enforces immutability: rejects re-issuing or saving draft when already issued', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const issued = await Prescription.findOne({ clinicId, visitId: visit._id, status: 'ISSUED' });
        expect(issued).toBeDefined();

        // Attempting to re-issue must fail
        await expect(issuePrescription(clinicId, issued!._id, doctorActor)).rejects.toThrow(
          'Cannot issue prescription in status ISSUED. Only DRAFT can be issued.'
        );
      }
    );
  });

  it('voids issued prescription with a mandatory doctor reason', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const issued = await Prescription.findOne({ clinicId, visitId: visit._id, status: 'ISSUED' });
        expect(issued).toBeDefined();

        // Reject if voidReason is empty
        await expect(voidPrescription(clinicId, issued!._id, '', doctorActor)).rejects.toThrow(
          'A non-empty void reason is required'
        );

        const voidReason = 'Patient reported mild allergy to component; replaced with alternative NSAID';
        const voided = await voidPrescription(clinicId, issued!._id, voidReason, doctorActor);

        expect(voided.status).toBe('VOID');
        expect(voided.voidReason).toBe(voidReason);
        expect(voided.voidedAt).toBeInstanceOf(Date);
        expect(voided.voidedBy?.id).toBe(doctorActor.id);

        // Verify Audit Log
        const audit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.PRESCRIPTION_VOID,
          entityId: voided._id.toString(),
        });
        expect(audit).toBeDefined();
        expect(audit?.meta?.voidReason).toBe(voidReason);
      }
    );
  });

  it('creates correction prescription pre-populated with replaced items and linked ID', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        // Complete previous visit to satisfy single operatory invariant
        await Visit.updateOne({ _id: visit._id }, { $set: { status: 'COMPLETED' } });

        // First issue a new prescription for another visit
        const newVisit = await Visit.create({
          clinicId,
          patientId: patient._id,
          date: '2026-10-25',
          token: 202,
          type: 'WALK_IN',
          status: 'IN_CONSULTATION',
          checkInAt: clock.now(),
          reasonForVisit: 'Second procedure',
          version: 1,
          createdBy: doctorActor,
        });

        const initialDraft = await savePrescriptionDraft(
          clinicId,
          newVisit._id,
          {
            items: [
              {
                name: 'Ibuprofen',
                form: 'tablet',
                strength: '400 mg',
                dose: '1 tablet',
                frequency: '1-0-1',
                duration: '5 days',
                instruction: 'After food',
                note: '',
              },
            ],
            advice: 'Rest well.',
            followUpDate: '2026-10-29',
            language: 'en',
          },
          doctorActor
        );

        const issuedRx = await issuePrescription(clinicId, initialDraft._id, doctorActor);
        const originalRxNumber = issuedRx.rxNumber;

        // Perform correction
        const correctionReason = 'Adjusted dose from 400 mg to 200 mg for patient comfort';
        const correctedDraft = await createCorrectionPrescription(
          clinicId,
          issuedRx._id,
          correctionReason,
          doctorActor
        );

        expect(correctedDraft.status).toBe('DRAFT');
        expect(correctedDraft.replacesPrescriptionId?.toString()).toBe(issuedRx._id.toString());
        expect(correctedDraft.items[0].name).toBe('Ibuprofen');

        // Original is marked VOID
        const oldRx = await Prescription.findById(issuedRx._id);
        expect(oldRx?.status).toBe('VOID');
        expect(oldRx?.voidReason).toBe(correctionReason);

        // Now issue the corrected draft: should receive next gapless number (RX/.../0003)
        const issuedCorrected = await issuePrescription(clinicId, correctedDraft._id, doctorActor);
        const fy = financialYear(clock.now());
        expect(issuedCorrected.rxNumber).toBe(`RX/${fy}/0003`);
        expect(issuedCorrected.rxNumber).not.toBe(originalRxNumber);
      }
    );
  });

  it('records prescription print and increments printCount with reprint tracking', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const issued = await Prescription.findOne({ clinicId, status: 'ISSUED' });
        expect(issued).toBeDefined();

        const firstPrint = await recordPrescriptionPrint(clinicId, issued!._id, doctorActor);
        expect(firstPrint.printCount).toBe(1);
        expect(firstPrint.lastPrintedAt).toBeInstanceOf(Date);

        const secondPrint = await recordPrescriptionPrint(clinicId, issued!._id, doctorActor);
        expect(secondPrint.printCount).toBe(2);

        // Verify reprint audit log
        const audit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.PRESCRIPTION_PRINT,
          entityId: issued!._id.toString(),
        }).sort({ at: -1 });

        expect(audit).toBeDefined();
        expect(audit?.meta?.printCount).toBe(2);
        expect(audit?.meta?.isReprint).toBe(true);
      }
    );
  });
});
