import { connectDb, disconnectDb } from '../src/lib/db';
import { assertSafeDatabase } from './script-utils';
import { Clinic } from '../src/models/Clinic';
import { Treatment, TreatmentUnit } from '../src/models/Treatment';
import { Medicine, MedicineForm } from '../src/models/Medicine';
import { systemScope } from '../src/lib/tenancy';
import { hashKioskPin } from '../src/lib/passwords';

interface IDATreatmentDef {
  code: string;
  name: string;
  category: string;
  idaMin: number;
  idaMax: number | null;
  unit: TreatmentUnit;
}

export const IDA_28_TREATMENTS: IDATreatmentDef[] = [
  { code: 'TRT-001', name: 'Consultation', category: 'General', idaMin: 200, idaMax: 500, unit: 'per visit' },
  { code: 'TRT-002', name: 'IOPA (Intra Oral Periapical Radiograph)', category: 'Radiology', idaMin: 300, idaMax: 500, unit: 'per tooth' },
  { code: 'TRT-003', name: 'OPG (Orthopantomogram)', category: 'Radiology', idaMin: 700, idaMax: 1000, unit: 'per case' },
  { code: 'TRT-004', name: 'RVG (Digital Radiograph)', category: 'Radiology', idaMin: 300, idaMax: 500, unit: 'per tooth' },
  { code: 'TRT-005', name: 'Composite Restoration (Tooth Coloured Filling)', category: 'Restorative', idaMin: 2000, idaMax: 3500, unit: 'per tooth' },
  { code: 'TRT-006', name: 'GIC Restoration', category: 'Restorative', idaMin: 1500, idaMax: 2500, unit: 'per tooth' },
  { code: 'TRT-007', name: 'Anterior RCT', category: 'Endodontics', idaMin: 6000, idaMax: 8000, unit: 'per tooth' },
  { code: 'TRT-008', name: 'Premolar RCT', category: 'Endodontics', idaMin: 7000, idaMax: 9000, unit: 'per tooth' },
  { code: 'TRT-009', name: 'Molar RCT', category: 'Endodontics', idaMin: 8000, idaMax: 12000, unit: 'per tooth' },
  { code: 'TRT-010', name: 'Re-RCT', category: 'Endodontics', idaMin: 10000, idaMax: 18000, unit: 'per tooth' },
  { code: 'TRT-011', name: 'Post & Core', category: 'Endodontics', idaMin: 4000, idaMax: 8000, unit: 'per tooth' },
  { code: 'TRT-012', name: 'Crown (Based on Material)', category: 'Prosthodontics', idaMin: 6000, idaMax: 18000, unit: 'per tooth' },
  { code: 'TRT-013', name: 'Extraction (Simple)', category: 'Oral Surgery', idaMin: 2000, idaMax: 4000, unit: 'per tooth' },
  { code: 'TRT-014', name: 'Surgical Extraction', category: 'Oral Surgery', idaMin: 4000, idaMax: 8000, unit: 'per tooth' },
  { code: 'TRT-015', name: 'Impacted Third Molar Removal', category: 'Oral Surgery', idaMin: 8000, idaMax: 18000, unit: 'per tooth' },
  { code: 'TRT-016', name: 'Scaling & Polishing', category: 'Periodontics', idaMin: 3000, idaMax: 5000, unit: 'per visit' },
  { code: 'TRT-017', name: 'Root Planing (Per Quadrant)', category: 'Periodontics', idaMin: 3500, idaMax: 6000, unit: 'per quadrant' },
  { code: 'TRT-018', name: 'Full Mouth Flap Surgery (Periodontal)', category: 'Periodontics', idaMin: 30000, idaMax: 60000, unit: 'per case' },
  { code: 'TRT-019', name: 'Bone Grafting', category: 'Periodontics', idaMin: 5000, idaMax: 20000, unit: 'per quadrant' },
  { code: 'TRT-020', name: 'Dental Implant (Without Crown)', category: 'Implantology', idaMin: 30000, idaMax: 60000, unit: 'per tooth' },
  { code: 'TRT-021', name: 'Implant Crown (On Implant)', category: 'Implantology', idaMin: 10000, idaMax: 20000, unit: 'per tooth' },
  { code: 'TRT-022', name: 'Complete Denture (Acrylic)', category: 'Prosthodontics', idaMin: 30000, idaMax: 60000, unit: 'per case' },
  { code: 'TRT-023', name: 'Removable Partial Denture (RPD)', category: 'Prosthodontics', idaMin: 8000, idaMax: null, unit: 'per case' },
  { code: 'TRT-024', name: 'Teeth Whitening (Bleaching)', category: 'Cosmetic', idaMin: 12000, idaMax: 25000, unit: 'per case' },
  { code: 'TRT-025', name: 'Fixed Orthodontics', category: 'Orthodontics', idaMin: 45000, idaMax: 90000, unit: 'per case' },
  { code: 'TRT-026', name: 'Clear Aligners (Per Case)', category: 'Orthodontics', idaMin: 80000, idaMax: 350000, unit: 'per case' },
  { code: 'TRT-027', name: 'Apicectomy (Root End Surgery)', category: 'Endodontics', idaMin: 8000, idaMax: 15000, unit: 'per tooth' },
  { code: 'TRT-028', name: 'Pediatric Pulpotomy + Stainless Steel Crown', category: 'Pedodontics', idaMin: 7000, idaMax: 10000, unit: 'per tooth' },
];

export const SAMPLE_MEDICINES = [
  { genericName: 'Amoxicillin', brandName: 'Mox', form: 'capsule' as MedicineForm, strength: '500mg', route: 'Oral', category: 'Antibiotic' },
  { genericName: 'Amoxicillin + Clavulanic Acid', brandName: 'Augmentin', form: 'tablet' as MedicineForm, strength: '625mg', route: 'Oral', category: 'Antibiotic' },
  { genericName: 'Paracetamol', brandName: 'Dolo', form: 'tablet' as MedicineForm, strength: '650mg', route: 'Oral', category: 'Analgesic / Antipyretic' },
  { genericName: 'Ibuprofen', brandName: 'Brufen', form: 'tablet' as MedicineForm, strength: '400mg', route: 'Oral', category: 'NSAID' },
  { genericName: 'Aceclofenac + Paracetamol', brandName: 'Zerodol-P', form: 'tablet' as MedicineForm, strength: '100mg + 325mg', route: 'Oral', category: 'Analgesic' },
  { genericName: 'Metronidazole', brandName: 'Flagyl', form: 'tablet' as MedicineForm, strength: '400mg', route: 'Oral', category: 'Antibiotic' },
  { genericName: 'Chlorhexidine Gluconate', brandName: 'Hexidine', form: 'mouthwash' as MedicineForm, strength: '0.2%', route: 'Oral Topical', category: 'Antiseptic' },
  { genericName: 'Pantoprazole', brandName: 'Pan-40', form: 'tablet' as MedicineForm, strength: '40mg', route: 'Oral', category: 'Antacid' },
  { genericName: 'Choline Salicylate + Lignocaine', brandName: 'Zytee', form: 'gel' as MedicineForm, strength: '8.7% + 2%', route: 'Topical', category: 'Analgesic Gel' },
  { genericName: 'Ketorolac Tromethamine', brandName: 'Ketorol-DT', form: 'tablet' as MedicineForm, strength: '10mg', route: 'Oral', category: 'NSAID' },
];

async function main() {
  assertSafeDatabase();
  await connectDb();

  let clinic = await Clinic.findOne();
  if (!clinic) {
    console.log('No clinic found. Creating default clinic for base seed...');
    const pinHash = await hashKioskPin('1234');
    clinic = await Clinic.create({
      name: "Dr. Susheel's Advanced Dental Clinic & Implant Center",
      address: 'Shop No 1-4, First Floor, City Pride Complex, Jalna Road, Chhatrapati Sambhajinagar, Maharashtra 431001',
      phone: '9822000000',
      email: 'dr.susheel@example.com',
      registrationNo: 'MH-CS-DEN-2024-001',
      timezone: 'Asia/Kolkata',
      paperSize: 'A5',
      kioskPinHash: pinHash,
      createdBy: { type: 'SYSTEM', id: 'seed' },
    });
  }

  const clinicId = clinic._id;

  await systemScope(clinicId, async () => {
    console.log('Seeding 28 IDA treatments (idempotent)...');
    for (const t of IDA_28_TREATMENTS) {
      await Treatment.findOneAndUpdate(
        { clinicId, code: t.code },
        {
          $set: {
            name: t.name,
            category: t.category,
            idaMin: t.idaMin,
            idaMax: t.idaMax,
            unit: t.unit,
            active: true,
          },
          $setOnInsert: {
            clinicId,
            code: t.code,
            createdBy: { type: 'SYSTEM', id: 'seed' },
          },
        },
        { upsert: true }
      );
    }
    console.log(`✓ 28 IDA Treatments synced for clinic ${clinic.name}`);

    console.log('Seeding SAMPLE medicines (idempotent)...');
    for (const m of SAMPLE_MEDICINES) {
      await Medicine.findOneAndUpdate(
        { clinicId, genericName: m.genericName, form: m.form, strength: m.strength },
        {
          $set: {
            brandName: m.brandName,
            route: m.route,
            category: m.category,
            source: 'SAMPLE',
            verified: false,
            active: true,
          },
          $setOnInsert: {
            clinicId,
            genericName: m.genericName,
            form: m.form,
            strength: m.strength,
            createdBy: { type: 'SYSTEM', id: 'seed' },
          },
        },
        { upsert: true }
      );
    }
    console.log(`✓ 10 SAMPLE Medicines synced for clinic ${clinic.name}`);
  });

  await disconnectDb();
  console.log('Base seed completed successfully.');
}

main().catch((err) => {
  console.error('Fatal error during base seed:', err);
  process.exit(1);
});
