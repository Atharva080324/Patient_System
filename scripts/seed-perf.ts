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
          const name = `Performance Test Patient ${i}`;
          batch.push({
            clinicId,
            patientCode: `PERF-${i.toString().padStart(6, '0')}`,
            name,
            searchName: name.toLowerCase().replace(/\s+/g, ' ').trim(),
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
            version: 1,
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

    // Seed 5,000 FAKE-NAMED medicines for search performance benchmark
    const Medicine = (await import('../src/models/Medicine')).Medicine;
    const existingMeds = await Medicine.countDocuments({ clinicId, source: 'SAMPLE' });
    const targetMedCount = isSmoke ? 100 : 5000;
    if (existingMeds >= targetMedCount) {
      console.log(`Perf medicines already seeded (${existingMeds}). Skipping.`);
    } else {
      console.log(`Generating ${targetMedCount} synthetic FAKE-NAMED medicines (source SAMPLE, verified=false)...`);
      const forms = ['tablet', 'capsule', 'gel', 'ointment', 'mouthwash', 'drops'];
      const prefixes = [
        'Amoxi', 'Cipro', 'Paracet', 'Ibu', 'Metron', 'Clinda', 'Azithro',
        'Diclo', 'Omepra', 'Doxy', 'Cepha', 'Erythro', 'Ketorol', 'Tramadol',
        'Chlorhex', 'Povidone', 'Lidocaine', 'Articaine', 'Predni', 'Dexameth'
      ];
      const suffixes = [
        'cillin', 'flox', 'amol', 'profen', 'idazole', 'mycin', 'fenac',
        'zole', 'cycline', 'lexin', 'ac', 'idine', 'stat', 'quine', 'pine'
      ];
      const strengths = ['100 mg', '250 mg', '500 mg', '650 mg', '10 mg', '0.2%', '1%', '2%'];

      const medBatch = [];
      for (let m = 1; m <= targetMedCount; m++) {
        const p = prefixes[m % prefixes.length];
        const s = suffixes[Math.floor(m / prefixes.length) % suffixes.length];
        const genericName = `${p}${s}-${m}`;
        const brandName = `Brand-${p}${m}`;
        const form = forms[m % forms.length];
        const strength = strengths[m % strengths.length];

        medBatch.push({
          clinicId,
          genericName,
          brandName,
          form,
          strength,
          category: 'Dental Sample Benchmark',
          source: 'SAMPLE',
          verified: false,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'seed:perf' },
        });

        if (medBatch.length === 1000 || m === targetMedCount) {
          await Medicine.insertMany(medBatch);
          console.log(`Inserted medicines up to ${m}...`);
          medBatch.length = 0;
        }
      }
      console.log(`✓ ${targetMedCount} Synthetic medicines seeded for clinic.`);
    }

    // Seed Appointments, Bills, Payments (with reversals), Follow-ups for Phase 6
    const Appointment = (await import('../src/models/Appointment')).Appointment;
    const Bill = (await import('../src/models/Bill')).Bill;
    const Payment = (await import('../src/models/Payment')).Payment;
    const FollowUp = (await import('../src/models/FollowUp')).FollowUp;

    const samplePatients = await Patient.find({ clinicId }).limit(200).select('_id name phone');
    const todayStr = clinicDate(clock.now());

    // 1. Appointments
    const existingAppts = await Appointment.countDocuments({ clinicId });
    if (existingAppts < (isSmoke ? 20 : 500)) {
      const apptBatch = [];
      const apptCount = isSmoke ? 20 : 500;
      for (let k = 1; k <= apptCount; k++) {
        const p = samplePatients[k % samplePatients.length];
        const isToday = k % 5 === 0;
        const apptDate = isToday ? todayStr : clinicDate(new Date(clock.now().getTime() + (k % 14) * 86400000));
        apptBatch.push({
          clinicId,
          patientId: p._id,
          contactName: p.name,
          contactPhone: p.phone,
          start: new Date(clock.now().getTime() + (k * 1800000) % 28800000),
          end: new Date(clock.now().getTime() + (k * 1800000) % 28800000 + 1800000),
          clinicDate: apptDate,
          status: k % 4 === 0 ? 'CHECKED_IN' : k % 7 === 0 ? 'CANCELLED' : 'BOOKED',
          reason: 'Routine checkup and dental cleaning',
          source: 'MANUAL',
          version: 1,
          createdBy: { type: 'SYSTEM', id: 'seed:perf' },
        });
      }
      await Appointment.insertMany(apptBatch);
      console.log(`✓ Seeded ${apptCount} appointments.`);
    }

    // 2. Follow-ups
    const existingFUs = await FollowUp.countDocuments({ clinicId });
    if (existingFUs < (isSmoke ? 20 : 300)) {
      const fuBatch = [];
      const fuCount = isSmoke ? 20 : 300;
      for (let f = 1; f <= fuCount; f++) {
        const p = samplePatients[f % samplePatients.length];
        const isDueToday = f % 4 === 0;
        const isOverdue = f % 6 === 0;
        const dueDate = isDueToday
          ? todayStr
          : isOverdue
          ? clinicDate(new Date(clock.now().getTime() - (f % 5 + 1) * 86400000))
          : clinicDate(new Date(clock.now().getTime() + (f % 10 + 1) * 86400000));

        fuBatch.push({
          clinicId,
          patientId: p._id,
          dueDate,
          status: f % 5 === 0 ? 'DONE' : 'PENDING',
          reason: 'Post-op crown seating and sensitivity check',
          notes: 'Check occlusion',
          version: 1,
          createdBy: { type: 'SYSTEM', id: 'seed:perf' },
        });
      }
      await FollowUp.insertMany(fuBatch);
      console.log(`✓ Seeded ${fuCount} follow-ups.`);
    }

    // 3. Bills and Payments with reversals
    const existingBills = await Bill.countDocuments({ clinicId });
    if (existingBills < (isSmoke ? 50 : 1000)) {
      const billCount = isSmoke ? 50 : 1000;
      const billBatch = [];
      for (let b = 1; b <= billCount; b++) {
        const p = samplePatients[b % samplePatients.length];
        const isToday = b % 4 === 0;
        const billDate = isToday ? clock.now() : new Date(clock.now().getTime() - (b % 30) * 86400000);
        const grandTotal = 1500 + (b % 10) * 500;
        const paidAmount = b % 3 === 0 ? grandTotal : b % 3 === 1 ? grandTotal / 2 : 0;
        const balanceAmount = grandTotal - paidAmount;
        const status = balanceAmount === 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'DUE';

        billBatch.push({
          clinicId,
          patientId: p._id,
          billNumber: `BILL-PERF-${b.toString().padStart(5, '0')}`,
          billDate,
          items: [
            {
              treatmentName: 'Composite Restoration',
              treatmentCode: 'T-COMP',
              quantity: 1,
              unitPrice: grandTotal,
              discountAmount: 0,
              finalAmount: grandTotal,
            },
          ],
          totalAmount: grandTotal,
          discountAmount: 0,
          grandTotal,
          paidAmount,
          balanceAmount,
          status,
          version: 1,
          createdBy: { type: 'SYSTEM', id: 'seed:perf' },
        });
      }
      const insertedBills = await Bill.insertMany(billBatch);
      console.log(`✓ Seeded ${billCount} bills.`);

      // Seed matching Payments
      const paymentBatch = [];
      for (let pi = 0; pi < insertedBills.length; pi++) {
        const bill = insertedBills[pi];
        if (bill.paidAmount > 0) {
          const isReversed = pi % 10 === 0;
          const methods = ['CASH', 'UPI', 'CARD', 'NET_BANKING'] as const;
          paymentBatch.push({
            clinicId,
            patientId: bill.patientId,
            billId: bill._id,
            receiptNumber: `RCP-PERF-${(pi + 1).toString().padStart(5, '0')}`,
            paymentDate: bill.billDate,
            amount: bill.paidAmount,
            method: methods[pi % methods.length],
            status: isReversed ? 'REVERSED' : 'COMPLETED',
            reversedAt: isReversed ? bill.billDate : undefined,
            reversalReason: isReversed ? 'Accidental duplicate transaction entry' : undefined,
            createdBy: { type: 'SYSTEM', id: 'seed:perf' },
          });
        }
      }
      if (paymentBatch.length > 0) {
        await Payment.insertMany(paymentBatch);
        console.log(`✓ Seeded ${paymentBatch.length} matching payments with reversals.`);
      }
    }
  });

  await disconnectDb();
  console.log('Performance seed completed.');
}

if (process.argv[1]?.replace(/\\/g, '/').includes('scripts/seed-perf')) {
  main().catch((err) => {
    console.error('Fatal error during perf seed:', err);
    process.exit(1);
  });
}
