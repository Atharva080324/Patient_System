import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { syncDatabaseIndexes, getLiveAndDeclaredIndexes } from '@/lib/sync-indexes';
import { Patient } from '@/models/Patient';
import { Bill } from '@/models/Bill';
import { Payment } from '@/models/Payment';
import { Prescription } from '@/models/Prescription';
import { Visit } from '@/models/Visit';
import { Appointment } from '@/models/Appointment';
import { runWithTenantContext } from '@/lib/tenancy';
import { clock } from '@/lib/clock';

describe('A15: Index Synchronization & Unique Index Enforcements', () => {
  const clinicId = new Types.ObjectId();
  const actor = { type: 'USER' as const, id: 'doc_1' };

  beforeAll(async () => {
    await setupTestReplSet();
    // Synchronize all declared indexes onto the MongoDB test replica set
    await syncDatabaseIndexes();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('matches declared indexes with live indexes in the database', async () => {
    const patientIndexes = await getLiveAndDeclaredIndexes(Patient);
    expect(patientIndexes.live.length).toBeGreaterThanOrEqual(patientIndexes.declared.length);

    const billIndexes = await getLiveAndDeclaredIndexes(Bill);
    expect(billIndexes.live.length).toBeGreaterThanOrEqual(billIndexes.declared.length);
  });

  it('unique index rejects duplicate patientCode within same clinic', async () => {
    await runWithTenantContext({ clinicId, actor }, async () => {
      await Patient.create({
        name: 'First Patient',
        patientCode: 'P-000001',
        ageYears: 30,
        sex: 'Male',
        phone: '9822000001',
        source: 'WALK_IN',
        consentAt: clock.now(),
        consentTextVersion: '1.0',
      });

      // Duplicate patientCode
      await expect(
        Patient.create({
          name: 'Second Patient with Same Code',
          patientCode: 'P-000001',
          ageYears: 28,
          sex: 'Female',
          phone: '9822000002',
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
        })
      ).rejects.toThrow(/duplicate key/i);
    });
  });

  it('unique index rejects duplicate billNo within same clinic', async () => {
    await runWithTenantContext({ clinicId, actor }, async () => {
      const patient = await Patient.create({
        name: 'Patient One',
        patientCode: 'P-000001',
        ageYears: 30,
        sex: 'Male',
        phone: '9822000001',
        source: 'WALK_IN',
        consentAt: clock.now(),
        consentTextVersion: '1.0',
      });

      await Bill.create({
        billNo: 'BILL/2026-27/0001',
        patientId: patient._id,
        items: [{ description: 'RCT', qty: 1, unitPrice: 800000, amount: 800000 }],
        discount: 0,
        total: 800000,
        paid: 0,
        balance: 800000,
        status: 'UNPAID',
      });

      // Duplicate billNo
      await expect(
        Bill.create({
          billNo: 'BILL/2026-27/0001',
          patientId: patient._id,
          items: [{ description: 'Crown', qty: 1, unitPrice: 600000, amount: 600000 }],
          discount: 0,
          total: 600000,
          paid: 0,
          balance: 600000,
          status: 'UNPAID',
        })
      ).rejects.toThrow(/duplicate key/i);
    });
  });

  it('unique index rejects duplicate receiptNo within same clinic', async () => {
    await runWithTenantContext({ clinicId, actor }, async () => {
      const patient = await Patient.create({
        name: 'Patient Two',
        patientCode: 'P-000002',
        ageYears: 30,
        sex: 'Male',
        phone: '9822000002',
        source: 'WALK_IN',
        consentAt: clock.now(),
        consentTextVersion: '1.0',
      });

      const bill = await Bill.create({
        billNo: 'BILL/2026-27/0002',
        patientId: patient._id,
        items: [{ description: 'Scaling', qty: 1, unitPrice: 300000, amount: 300000 }],
        discount: 0,
        total: 300000,
        paid: 300000,
        balance: 0,
        status: 'PAID',
      });

      await Payment.create({
        billId: bill._id,
        receiptNo: 'REC/2026-27/0001',
        amount: 300000,
        method: 'CASH',
        isReversal: false,
        receivedAt: clock.now(),
      });

      // Duplicate receiptNo
      await expect(
        Payment.create({
          billId: bill._id,
          receiptNo: 'REC/2026-27/0001',
          amount: 300000,
          method: 'UPI',
          isReversal: false,
          receivedAt: clock.now(),
        })
      ).rejects.toThrow(/duplicate key/i);
    });
  });

  it('unique index rejects duplicate rxNumber within same clinic', async () => {
    await runWithTenantContext({ clinicId, actor }, async () => {
      const patient = await Patient.create({
        name: 'Patient Three',
        patientCode: 'P-000003',
        ageYears: 30,
        sex: 'Male',
        phone: '9822000003',
        source: 'WALK_IN',
        consentAt: clock.now(),
        consentTextVersion: '1.0',
      });

      const visit = await Visit.create({
        patientId: patient._id,
        date: '2026-10-24',
        token: 1,
        type: 'WALK_IN',
        status: 'IN_CONSULTATION',
        checkInAt: clock.now(),
        reasonForVisit: 'Toothache',
        caseSheet: {
          chiefComplaint: 'Pain',
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
      });

      await Prescription.create({
        rxNumber: 'RX/2026-27/0001',
        visitId: visit._id,
        patientId: patient._id,
        date: clock.now(),
        items: [
          {
            medicineSnapshot: { name: 'Amoxicillin', form: 'capsule', strength: '500mg' },
            frequency: '1-0-1',
            duration: '5 days',
          },
        ],
      });

      // Duplicate rxNumber
      await expect(
        Prescription.create({
          rxNumber: 'RX/2026-27/0001',
          visitId: visit._id,
          patientId: patient._id,
          date: clock.now(),
          items: [],
        })
      ).rejects.toThrow(/duplicate key/i);
    });
  });

  it('unique index rejects duplicate visit token on the same clinic date', async () => {
    await runWithTenantContext({ clinicId, actor }, async () => {
      const patient = await Patient.create({
        name: 'Patient Four',
        patientCode: 'P-000004',
        ageYears: 30,
        sex: 'Male',
        phone: '9822000004',
        source: 'WALK_IN',
        consentAt: clock.now(),
        consentTextVersion: '1.0',
      });

      await Visit.create({
        patientId: patient._id,
        date: '2026-10-24',
        token: 5,
        type: 'WALK_IN',
        status: 'WAITING',
        checkInAt: clock.now(),
        reasonForVisit: 'Consultation',
        caseSheet: {
          chiefComplaint: '',
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
      });

      // Duplicate token on same date
      await expect(
        Visit.create({
          patientId: patient._id,
          date: '2026-10-24',
          token: 5,
          type: 'WALK_IN',
          status: 'WAITING',
          checkInAt: clock.now(),
          reasonForVisit: 'Consultation 2',
          caseSheet: {
            chiefComplaint: '',
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
        })
      ).rejects.toThrow(/duplicate key/i);
    });
  });

  it('unique sparse index rejects duplicate appointment externalId for same source', async () => {
    await runWithTenantContext({ clinicId, actor }, async () => {
      await Appointment.create({
        contact: { name: 'Ext Booking', phone: '9822000005' },
        start: new Date('2026-10-25T10:00:00.000Z'),
        end: new Date('2026-10-25T10:30:00.000Z'),
        status: 'REQUESTED',
        reason: 'Consultation',
        source: 'WEBSITE',
        externalId: 'WEB-BOOKING-999',
      });

      // Duplicate externalId from same source
      await expect(
        Appointment.create({
          contact: { name: 'Ext Booking 2', phone: '9822000006' },
          start: new Date('2026-10-25T11:00:00.000Z'),
          end: new Date('2026-10-25T11:30:00.000Z'),
          status: 'REQUESTED',
          reason: 'Consultation 2',
          source: 'WEBSITE',
          externalId: 'WEB-BOOKING-999',
        })
      ).rejects.toThrow(/duplicate key/i);
    });
  });
});
