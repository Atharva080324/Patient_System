import { describe, it, expect } from 'vitest';
import { buildPrescriptionSnapshot } from '@/lib/prescription-snapshot';

describe('Prescription Snapshot Builder', () => {
  it('freezes clinic, doctor, patient, date, items, advice and language', () => {
    const clinic = {
      name: "Dr. Susheel's Advanced Dental Clinic & Implant Center",
      address: 'Plot 12, Station Road, Chhatrapati Sambhajinagar',
      phone: '+91-98220-11223',
      email: 'dr.susheel@example.com',
      registrationNo: 'MH-REG-2024-099',
      logoUrl: 'https://example.com/logo.png',
      workingHours: '10:00 - 20:00',
    };

    const doctor = {
      name: 'Dr. Susheel Shinde',
      qualification: 'BDS, MDS (Prosthodontics & Implantology)',
      registrationNumber: 'MH-DC-99887',
    };

    const patient = {
      name: 'Rameshwar Patil',
      patientCode: 'P-000123',
      ageYears: 42,
      sex: 'Male' as const,
      phone: '9822012345',
      address: 'CIDCO N-4, Chhatrapati Sambhajinagar',
    };

    const items = [
      {
        name: 'Amoxicillin + Potassium Clavulanate',
        form: 'tablet',
        strength: '625 mg',
        dose: '1 tablet',
        frequency: '1-0-1',
        duration: '5 days',
        instruction: 'After food',
        note: 'Complete full course',
      },
      {
        name: 'Aceclofenac + Paracetamol',
        form: 'tablet',
        strength: '100 mg / 325 mg',
        dose: '1 tablet',
        frequency: '1-0-1',
        duration: '3 days',
        instruction: 'After food (SOS for pain)',
        note: '',
      },
    ];

    const snapshot = buildPrescriptionSnapshot({
      clinic,
      doctor,
      patient,
      rxNumber: 'RX/2026-27/0001',
      date: '2026-10-25',
      items,
      advice: 'Avoid hard and chewy food on the right side.\nMaintain oral hygiene.',
      followUpDate: '2026-10-30',
      language: 'en',
    });

    expect(snapshot.rxNumber).toBe('RX/2026-27/0001');
    expect(snapshot.date).toBe('2026-10-25');
    expect(snapshot.clinic.name).toBe("Dr. Susheel's Advanced Dental Clinic & Implant Center");
    expect(snapshot.clinic.registrationNo).toBe('MH-REG-2024-099');
    expect(snapshot.doctor.name).toBe('Dr. Susheel Shinde');
    expect(snapshot.doctor.qualification).toBe('BDS, MDS (Prosthodontics & Implantology)');
    expect(snapshot.patient.name).toBe('Rameshwar Patil');
    expect(snapshot.patient.patientCode).toBe('P-000123');
    expect(snapshot.patient.phone).toBe('9822012345');
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0].name).toBe('Amoxicillin + Potassium Clavulanate');
    expect(snapshot.items[0].frequency).toBe('1-0-1');
    expect(snapshot.items[0].duration).toBe('5 days');
    expect(snapshot.advice).toContain('Avoid hard and chewy food');
    expect(snapshot.followUpDate).toBe('2026-10-30');
    expect(snapshot.language).toBe('en');
    expect(snapshot.issuedAt).toBeInstanceOf(Date);
  });

  it('populates robust fallback defaults when optional fields are omitted', () => {
    const snapshot = buildPrescriptionSnapshot({
      clinic: {},
      doctor: {},
      patient: {},
      rxNumber: 'RX/2026-27/0002',
      date: '2026-10-25',
      items: [],
    });

    expect(snapshot.clinic.name).toContain('Dr. Susheel');
    expect(snapshot.doctor.name).toContain('Dr. Susheel');
    expect(snapshot.patient.name).toBe('Walk-in Patient');
    expect(snapshot.patient.patientCode).toBe('P-000000');
    expect(snapshot.items).toHaveLength(0);
    expect(snapshot.language).toBe('en');
  });

  it('rejects construction without a valid rxNumber', () => {
    expect(() =>
      buildPrescriptionSnapshot({
        clinic: {},
        doctor: {},
        patient: {},
        rxNumber: '',
        date: '2026-10-25',
        items: [],
      })
    ).toThrow('Cannot build snapshot without a valid rxNumber');

    expect(() =>
      buildPrescriptionSnapshot({
        clinic: {},
        doctor: {},
        patient: {},
        rxNumber: '   ',
        date: '2026-10-25',
        items: [],
      })
    ).toThrow('Cannot build snapshot without a valid rxNumber');
  });
});
