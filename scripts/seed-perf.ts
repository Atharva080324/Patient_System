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
  const isSmoke = process.argv.includes('--smoke');
  const patientCount = isSmoke ? 100 : 5000;
  const visitCount = isSmoke ? 300 : 20000;

  console.log(`Starting performance seed (${patientCount} patients, ${visitCount} visits)...`);

  await systemScope(clinicId, async () => {
    const existing = await Patient.countDocuments({ clinicId });
    if (existing >= patientCount) {
      console.log(`Patients already exist (${existing}). Skipping patient bulk insertion.`);
    } else {
      console.log(`Generating ${patientCount} synthetic patients in batches...`);
      const batchSize = 1000;
      for (let b = 0; b < patientCount; b += batchSize) {
        const batch = [];
        const limit = Math.min(b + batchSize, patientCount);
        for (let i = b + 1; i <= limit; i++) {
          batch.push({
            clinicId,
            patientCode: `PERF-${i.toString().padStart(6, '0')}`,
            name: `Performance Test Patient ${i}`,
            ageYears: 18 + (i % 65),
            sex: i % 2 === 0 ? 'Female' : 'Male',
            phone: `91000${(10000 + (i % 90000)).toString()}`,
            source: 'WALK_IN',
            medicalHistory: {
              conditions: [],
              allergies: [],
              currentMedications: [],
              habits: [],
            },
            consentAt: clock.now(),
            consentTextVersion: '1.0',
            createdBy: { type: 'SYSTEM', id: 'seed:perf' },
          });
        }
        await Patient.insertMany(batch);
        console.log(`Inserted patients batch up to ${limit}...`);
      }
    }

    const existingVisits = await Visit.countDocuments({ clinicId });
    if (existingVisits >= visitCount) {
      console.log(`Visits already exist (${existingVisits}). Skipping visit bulk insertion.`);
    } else {
      console.log(`Generating ${visitCount} synthetic visits in batches...`);
      const samplePatients = await Patient.find({ clinicId }).limit(100).select('_id');
      const now = clock.now();
      const batchSize = 2000;

      for (let b = 0; b < visitCount; b += batchSize) {
        const batch = [];
        const limit = Math.min(b + batchSize, visitCount);
        for (let j = b + 1; j <= limit; j++) {
          const patientId = samplePatients[j % samplePatients.length]._id;
          const daysAgo = Math.floor(j / 50);
          const dateStr = clinicDate(new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000));
          const token = (j % 50) + 1;

          batch.push({
            clinicId,
            patientId,
            date: dateStr,
            token,
            type: 'WALK_IN',
            status: 'COMPLETED',
            checkInAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
            reasonForVisit: 'Performance Benchmark Visit',
            caseSheet: {
              chiefComplaint: 'Routine evaluation',
              historyOfPresentIllness: '',
              extraOral: '',
              intraOral: '',
              findings: [],
              investigations: [],
              diagnosis: 'Normal oral health',
              treatmentPlan: [],
              procedureNotes: '',
              advice: '',
            },
            version: 1,
            createdBy: { type: 'SYSTEM', id: 'seed:perf' },
          });
        }
        await Visit.insertMany(batch);
        console.log(`Inserted visits batch up to ${limit}...`);
      }
    }
  });

  await disconnectDb();
  console.log('Performance seed completed.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during perf seed:', err);
    process.exit(1);
  });
}
