import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/lib/db';
import { systemScope, runWithTenantContext, TenantActor } from '@/lib/tenancy';
import { Clinic } from '@/models/Clinic';
import { Medicine } from '@/models/Medicine';
import { DoctorMedicine } from '@/models/DoctorMedicine';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import {
  searchMedicines,
  toggleMedicineFavorite,
  createCustomMedicine,
  deactivateCustomMedicine,
} from '@/lib/medicine-search';

describe('Medicine Search, Favourites & Custom Medicine Management', () => {
  let clinicId: mongoose.Types.ObjectId;
  const doctorActor: TenantActor = { type: 'USER', id: 'doc_susheel_meds_test' };

  beforeAll(async () => {
    await connectDb();

    // Setup clinic
    const clinic = await Clinic.findOneAndUpdate(
      { name: "Dr. Susheel's Medicine Search Test Clinic" },
      {
        $setOnInsert: {
          address: 'Station Road, Chhatrapati Sambhajinagar',
          phone: '+91-98220-77889',
          email: 'meds.test@clinic.com',
          registrationNo: 'MH-MEDS-TEST-001',
          kioskPinHash: 'dummy',
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    clinicId = clinic._id;

    await systemScope(clinicId, async () => {
      // Seed initial base formulary medicines
      await Medicine.insertMany([
        {
          clinicId,
          genericName: 'Amoxicillin',
          brandName: 'Mox 500',
          form: 'capsule',
          strength: '500 mg',
          category: 'Antibiotic',
          source: 'NLEM2022',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
        {
          clinicId,
          genericName: 'Amoxicillin + Potassium Clavulanate',
          brandName: 'Augmentin 625',
          form: 'tablet',
          strength: '625 mg',
          category: 'Antibiotic',
          source: 'NLEM2022',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
        {
          clinicId,
          genericName: 'Paracetamol',
          brandName: 'Crocin 650',
          form: 'tablet',
          strength: '650 mg',
          category: 'Analgesic',
          source: 'NLEM2022',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
        {
          clinicId,
          genericName: 'Ketorolac Tromethamine',
          brandName: 'Ketorol-DT',
          form: 'tablet',
          strength: '10 mg',
          category: 'NSAID',
          source: 'FORMULARY',
          verified: true,
          active: true,
          createdBy: { type: 'SYSTEM', id: 'test' },
        },
      ]);
    });
  });

  afterAll(async () => {
    await systemScope(clinicId, async () => {
      await Medicine.deleteMany({ clinicId });
      await DoctorMedicine.deleteMany({ clinicId });
      await Clinic.deleteMany({ _id: clinicId });
    });
    await disconnectDb();
  });

  it('searches medicines with prefix matching and returns verified markers', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const results = await searchMedicines(clinicId, 'Amox', 10);
        expect(results.length).toBeGreaterThanOrEqual(2);

        const mox = results.find((r) => r.brandName === 'Mox 500');
        expect(mox).toBeDefined();
        expect(mox?.genericName).toBe('Amoxicillin');
        expect(mox?.verified).toBe(true);
        expect(mox?.form).toBe('capsule');
        expect(mox?.strength).toBe('500 mg');
      }
    );
  });

  it('toggles medicine favorite and ranks favorites first on empty query', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const ketorol = await Medicine.findOne({ clinicId, genericName: 'Ketorolac Tromethamine' });
        expect(ketorol).toBeDefined();

        // 1. Star Ketorolac as favorite
        const toggleRes = await toggleMedicineFavorite(clinicId, ketorol!._id, doctorActor);
        expect(toggleRes.isFavorite).toBe(true);

        // 2. Search with empty query: favorite should be the first item returned
        const results = await searchMedicines(clinicId, '', 10);
        expect(results[0].genericName).toBe('Ketorolac Tromethamine');
        expect(results[0].isFavorite).toBe(true);

        // 3. Unstar favorite
        const toggleOff = await toggleMedicineFavorite(clinicId, ketorol!._id, doctorActor);
        expect(toggleOff.isFavorite).toBe(false);
      }
    );
  });

  it('creates custom clinic medicine, prevents case-insensitive duplicates, and handles deactivation', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        const customInput = {
          genericName: 'Chlorhexidine Gluconate',
          brandName: 'Hexidine Mouthwash',
          form: 'mouthwash' as const,
          strength: '0.2% w/v',
        };

        // 1. Create custom medicine
        const customMed = await createCustomMedicine(clinicId, customInput, doctorActor);
        expect(customMed.source).toBe('CUSTOM');
        expect(customMed.verified).toBe(true);
        expect(customMed.active).toBe(true);

        // Verify Audit Log
        const audit = await AuditLog.findOne({
          clinicId,
          action: AuditAction.MEDICINE_CUSTOM_CREATE,
          entityId: customMed._id.toString(),
        });
        expect(audit).toBeDefined();
        expect(audit?.meta?.name).toBe('Chlorhexidine Gluconate');

        // 2. Reject duplicate creation (case-insensitive)
        await expect(
          createCustomMedicine(
            clinicId,
            {
              genericName: 'chlorhexidine gluconate', // lowercase
              form: 'mouthwash',
              strength: '0.2% w/v',
            },
            doctorActor
          )
        ).rejects.toThrow('already exists');

        // 3. Deactivate custom medicine
        const deactivated = await deactivateCustomMedicine(clinicId, customMed._id, doctorActor);
        expect(deactivated.active).toBe(false);

        // It should no longer appear in search results
        const searchAfterDeactivate = await searchMedicines(clinicId, 'Chlorhexidine', 10);
        expect(searchAfterDeactivate.find((m) => m._id === customMed._id.toString())).toBeUndefined();
      }
    );
  });

  it('Requirement 6 Performance Benchmark: Search across 5,000 medicines achieves p95 < 50ms', async () => {
    await runWithTenantContext(
      { clinicId: clinicId.toString(), actor: doctorActor },
      async () => {
        // Bulk insert 5,000 synthetic fake medicines (SAMPLE, verified: false)
        const totalSampleMeds = 5000;
        const batch = [];
        const prefixes = ['Amoxi', 'Cipro', 'Paracet', 'Ibu', 'Metron', 'Clinda', 'Azithro', 'Diclo', 'Omepra', 'Doxy'];
        const suffixes = ['cillin', 'flox', 'amol', 'profen', 'idazole', 'mycin', 'fenac', 'zole', 'cycline', 'lexin'];
        const forms = ['tablet', 'capsule', 'gel', 'drops'];
        const strengths = ['100 mg', '250 mg', '500 mg', '650 mg'];

        for (let i = 1; i <= totalSampleMeds; i++) {
          const p = prefixes[i % prefixes.length];
          const s = suffixes[Math.floor(i / prefixes.length) % suffixes.length];
          batch.push({
            clinicId,
            genericName: `${p}${s}-${i}`,
            brandName: `Brand-${p}-${i}`,
            form: forms[i % forms.length],
            strength: strengths[i % strengths.length],
            category: 'Benchmark Sample',
            source: 'SAMPLE',
            verified: false,
            active: true,
            createdBy: { type: 'SYSTEM', id: 'perf-test' },
          });
        }

        await Medicine.insertMany(batch);
        const count = await Medicine.countDocuments({ clinicId });
        expect(count).toBeGreaterThanOrEqual(5000);

        // Execute 40 timed search queries
        const queryTerms = ['Amox', 'Cipro', 'Parac', 'Ibu', 'Metron', 'Clinda', 'Azith', 'Diclo', 'Omep', 'Doxy'];
        const durations: number[] = [];

        for (let q = 0; q < 40; q++) {
          const term = queryTerms[q % queryTerms.length];
          const t0 = performance.now();
          const results = await searchMedicines(clinicId, term, 20);
          const t1 = performance.now();
          durations.push(t1 - t0);
          expect(results.length).toBeGreaterThan(0);
        }

        durations.sort((a, b) => a - b);
        const p50 = durations[Math.floor(durations.length * 0.5)];
        const p95Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
        const p95 = durations[p95Index];

        console.log(`[Medicine Search Benchmark] 5,000 items: p50 = ${p50.toFixed(2)} ms, p95 = ${p95.toFixed(2)} ms`);

        // Assert requirement: p95 is strictly under 50 ms
        expect(p95).toBeLessThan(50);
      }
    );
  });
});
