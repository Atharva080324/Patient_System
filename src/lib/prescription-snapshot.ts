import {
  IPrescriptionSnapshot,
  IPrescriptionItem,
} from '../models/Prescription';
import { IClinic } from '../models/Clinic';
import { IUser } from '../models/User';
import { IPatient } from '../models/Patient';
import { clock } from './clock';

export interface BuildSnapshotParams {
  clinic: Partial<IClinic>;
  doctor: Partial<IUser> & { qualification?: string; registrationNumber?: string };
  patient: Partial<IPatient>;
  rxNumber: string;
  date: string; // YYYY-MM-DD
  items: IPrescriptionItem[];
  advice?: string;
  followUpDate?: string;
  language?: 'en' | 'hi' | 'mr';
  issuedAt?: Date;
}

export function buildPrescriptionSnapshot(params: BuildSnapshotParams): IPrescriptionSnapshot {
  const {
    clinic,
    doctor,
    patient,
    rxNumber,
    date,
    items,
    advice,
    followUpDate,
    language = 'en',
    issuedAt = clock.now(),
  } = params;

  if (!rxNumber || !rxNumber.trim()) {
    throw new Error('Cannot build snapshot without a valid rxNumber');
  }

  return {
    clinic: {
      name: clinic.name || "Dr. Susheel's Advanced Dental Clinic & Implant Center",
      address: clinic.address || 'Chhatrapati Sambhajinagar, Maharashtra, India',
      phone: clinic.phone || '+91-98220-00000',
      email: clinic.email || 'info@drsusheeldental.com',
      registrationNo: clinic.registrationNo || 'MH-REG-DENT-2024-001',
      logoUrl: clinic.logoUrl,
      workingHours: clinic.workingHours || '09:00 - 20:00',
    },
    doctor: {
      name: doctor.name || 'Dr. Susheel',
      qualification: doctor.qualification || 'BDS, MDS (Prosthodontics & Implantology)',
      registrationNumber: doctor.registrationNumber || 'MH-DC-12345',
    },
    patient: {
      name: patient.name || 'Walk-in Patient',
      patientCode: patient.patientCode || 'P-000000',
      ageYears: patient.ageYears,
      sex: patient.sex || 'Other',
      phone: patient.phone || '',
      address: patient.address,
    },
    rxNumber,
    date,
    items: items.map((item) => ({
      name: item.name.trim(),
      form: item.form.trim(),
      strength: item.strength.trim(),
      dose: (item.dose || '').trim(),
      frequency: item.frequency.trim(),
      duration: item.duration.trim(),
      instruction: (item.instruction || '').trim(),
      note: (item.note || '').trim(),
    })),
    advice: (advice || '').trim(),
    followUpDate: (followUpDate || '').trim(),
    language,
    issuedAt,
  };
}
