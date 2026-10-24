import { connectDb, disconnectDb } from '../src/lib/db';
import { assertSafeDatabase } from './script-utils';
import { Clinic } from '../src/models/Clinic';
import { Patient } from '../src/models/Patient';
import { Visit } from '../src/models/Visit';
import { systemScope } from '../src/lib/tenancy';
import { clinicDate } from '../src/lib/date';
import { clock } from '../src/lib/clock';

async function main() {
  assertSafeDatabase();
  await connectDb();

  const clinic = await Clinic.findOne();
  if (!clinic) {
    throw new Error('No clinic found. Please run pnpm seed:base first.');
  }

  const clinicId = clinic._id;

  await systemScope(clinicId, async () => {
    console.log('Seeding 30 demo fake patients (idempotent)...');
    const createdPatients = [];

    for (let i = 1; i <= 30; i++) {
      const padNum = i.toString().padStart(2, '0');
      const patientCode = `P-${i.toString().padStart(6, '0')}`;
      const name = `Test Patient ${padNum}`;
      const phone = `90000000${padNum}`;
      const ageYears = 20 + (i % 50);
      const sex = i % 2 === 0 ? 'Female' : 'Male';

      const patient = await Patient.findOneAndUpdate(
        { clinicId, patientCode },
        {
          $set: {
            name,
            ageYears,
            sex,
            phone,
            source: 'WALK_IN',
            medicalHistory: {
              conditions: i % 5 === 0 ? ['Diabetes'] : i % 7 === 0 ? ['Hypertension'] : [],
              allergies: i % 4 === 0 ? ['Penicillin'] : [],
              currentMedications: [],
              habits: [],
            },
            consentAt: clock.now(),
            consentTextVersion: '1.0',
          },
          $setOnInsert: {
            clinicId,
            patientCode,
            createdBy: { type: 'SYSTEM', id: 'seed:demo' },
          },
        },
        { upsert: true, new: true }
      );

      createdPatients.push(patient);
    }
    console.log(`✓ 30 Demo Patients created/updated`);

    console.log('Seeding 60 visits over the last 30 days (idempotent)...');
    const now = clock.now();

    for (let j = 1; j <= 60; j++) {
      const patient = createdPatients[j % createdPatients.length];
      const daysAgo = Math.floor(j / 2);
      const visitDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      const dateStr = clinicDate(visitDate);
      const token = (j % 5) + 1;

      await Visit.findOneAndUpdate(
        { clinicId, date: dateStr, token },
        {
          $set: {
            patientId: patient._id,
            type: j % 3 === 0 ? 'APPOINTMENT' : 'WALK_IN',
            status: j < 50 ? 'COMPLETED' : 'WAITING',
            checkInAt: visitDate,
            reasonForVisit: j % 2 === 0 ? 'Routine Checkup & Cleaning' : 'Toothache and sensitivity',
            caseSheet: {
              chiefComplaint: j % 2 === 0 ? 'Dental checkup' : 'Pain in lower right molar',
              historyOfPresentIllness: 'Pain since 2 days',
              extraOral: 'No facial asymmetry',
              intraOral: 'Mild gingivitis',
              findings: [{ tooth: 46, finding: 'Deep dentinal caries' }],
              investigations: ['IOPA done'],
              diagnosis: 'Irreversible pulpitis 46',
              treatmentPlan: [],
              procedureNotes: 'Consultation conducted',
              advice: 'Warm saline rinses',
            },
            version: 1,
          },
          $setOnInsert: {
            clinicId,
            date: dateStr,
            token,
            createdBy: { type: 'SYSTEM', id: 'seed:demo' },
          },
        },
        { upsert: true }
      );
    }
    console.log(`✓ 60 Demo Visits synced across past 30 days`);
  });

  await disconnectDb();
  console.log('Demo seed completed successfully.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during demo seed:', err);
    process.exit(1);
  });
}
