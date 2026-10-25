import mongoose from 'mongoose';
import { z } from 'zod';
import { Medicine, IMedicine, MedicineForm } from '../models/Medicine';
import { DoctorMedicine } from '../models/DoctorMedicine';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { TenantActor } from './tenancy';
import { clock } from './clock';

export interface MedicineSearchResult {
  _id: string;
  genericName: string;
  brandName?: string;
  form: MedicineForm;
  strength: string;
  source: string;
  verified: boolean;
  isFavorite: boolean;
  useCount: number;
}

export const CustomMedicineSchema = z
  .object({
    genericName: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    brandName: z.string().trim().max(100).optional(),
    form: z.enum([
      'tablet',
      'capsule',
      'gel',
      'ointment',
      'mouthwash',
      'injection',
      'drops',
      'other',
    ]),
    strength: z.string().trim().min(1, 'Strength is required').max(50),
    category: z.string().trim().max(50).optional().default('Dental Custom'),
  })
  .strict();

export type CustomMedicineInput = z.input<typeof CustomMedicineSchema>;

export async function searchMedicines(
  clinicId: mongoose.Types.ObjectId | string,
  query: string = '',
  limit: number = 20
): Promise<MedicineSearchResult[]> {
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const trimmed = query.trim();

  // Load doctor's favourite/usage metadata
  const doctorMeds = await DoctorMedicine.find({
    clinicId: clinicObjectId,
  }).lean();

  const favMap = new Map<string, { isFavorite: boolean; useCount: number }>();
  for (const dm of doctorMeds) {
    favMap.set(dm.medicineId.toString(), {
      isFavorite: Boolean(dm.isFavorite),
      useCount: dm.useCount || 0,
    });
  }

  // 1. If query is empty, return starred / most used medicines first
  if (!trimmed) {
    const favoriteMeds = await Medicine.find({
      clinicId: clinicObjectId,
      active: true,
      _id: { $in: Array.from(favMap.keys()) },
    })
      .limit(limit)
      .lean();

    const formatted: MedicineSearchResult[] = favoriteMeds.map((med: any) => {
      const meta = favMap.get(med._id.toString()) || { isFavorite: false, useCount: 0 };
      return {
        _id: med._id.toString(),
        genericName: med.genericName,
        brandName: med.brandName,
        form: med.form,
        strength: med.strength,
        source: med.source,
        verified: med.verified,
        isFavorite: meta.isFavorite,
        useCount: meta.useCount,
      };
    });

    // Sort: favorites first, then by useCount desc
    formatted.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
      return b.useCount - a.useCount;
    });

    if (formatted.length >= limit) {
      return formatted.slice(0, limit);
    }

    // If fewer than limit, supplement with default active medicines
    const existingIds = new Set(formatted.map((m) => m._id));
    const extra = await Medicine.find({
      clinicId: clinicObjectId,
      active: true,
      _id: { $nin: Array.from(existingIds) },
    })
      .limit(limit - formatted.length)
      .lean();

    for (const med of extra as any[]) {
      formatted.push({
        _id: med._id.toString(),
        genericName: med.genericName,
        brandName: med.brandName,
        form: med.form,
        strength: med.strength,
        source: med.source,
        verified: med.verified,
        isFavorite: false,
        useCount: 0,
      });
    }

    return formatted;
  }

  // 2. Query is non-empty: prefix match strategy with regex escaping
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefixRegex = new RegExp(`^${escaped}`, 'i');
  const containsRegex = new RegExp(escaped, 'i');

  // Find prefix matches on genericName or brandName
  const prefixMatches = await Medicine.find({
    clinicId: clinicObjectId,
    active: true,
    $or: [{ genericName: prefixRegex }, { brandName: prefixRegex }],
  })
    .limit(limit)
    .lean();

  const resultsMap = new Map<string, MedicineSearchResult>();

  for (const med of prefixMatches as any[]) {
    const meta = favMap.get(med._id.toString()) || { isFavorite: false, useCount: 0 };
    resultsMap.set(med._id.toString(), {
      _id: med._id.toString(),
      genericName: med.genericName,
      brandName: med.brandName,
      form: med.form,
      strength: med.strength,
      source: med.source,
      verified: med.verified,
      isFavorite: meta.isFavorite,
      useCount: meta.useCount,
    });
  }

  // If prefix matches didn't reach limit, search substring contains
  if (resultsMap.size < limit) {
    const substringMatches = await Medicine.find({
      clinicId: clinicObjectId,
      active: true,
      _id: { $nin: Array.from(resultsMap.keys()) },
      $or: [{ genericName: containsRegex }, { brandName: containsRegex }],
    })
      .limit(limit - resultsMap.size)
      .lean();

    for (const med of substringMatches as any[]) {
      const meta = favMap.get(med._id.toString()) || { isFavorite: false, useCount: 0 };
      resultsMap.set(med._id.toString(), {
        _id: med._id.toString(),
        genericName: med.genericName,
        brandName: med.brandName,
        form: med.form,
        strength: med.strength,
        source: med.source,
        verified: med.verified,
        isFavorite: meta.isFavorite,
        useCount: meta.useCount,
      });
    }
  }

  const results = Array.from(resultsMap.values());

  // Rank results: exact prefix match first, then favorites, then usage count
  results.sort((a, b) => {
    const aGenPrefix = a.genericName.toLowerCase().startsWith(trimmed.toLowerCase());
    const bGenPrefix = b.genericName.toLowerCase().startsWith(trimmed.toLowerCase());
    if (aGenPrefix !== bGenPrefix) {
      return aGenPrefix ? -1 : 1;
    }
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    return b.useCount - a.useCount;
  });

  return results.slice(0, limit);
}

export async function toggleMedicineFavorite(
  clinicId: mongoose.Types.ObjectId | string,
  medicineId: mongoose.Types.ObjectId | string,
  actor: TenantActor
): Promise<{ isFavorite: boolean }> {
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const medicineObjectId = new mongoose.Types.ObjectId(medicineId);

  const existing = await DoctorMedicine.findOne({
    clinicId: clinicObjectId,
    medicineId: medicineObjectId,
  });

  const nextState = existing ? !existing.isFavorite : true;

  await DoctorMedicine.findOneAndUpdate(
    { clinicId: clinicObjectId, medicineId: medicineObjectId },
    {
      $set: { isFavorite: nextState, lastUsedAt: clock.now() },
      $setOnInsert: {
        clinicId: clinicObjectId,
        medicineId: medicineObjectId,
        useCount: 0,
        createdBy: actor,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return { isFavorite: nextState };
}

export async function createCustomMedicine(
  clinicId: mongoose.Types.ObjectId | string,
  input: CustomMedicineInput,
  actor: TenantActor
): Promise<IMedicine> {
  const validated = CustomMedicineSchema.parse(input);
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);

  // Prevent case-insensitive duplicate custom names in the same clinic
  const existing = await Medicine.findOne({
    clinicId: clinicObjectId,
    genericName: new RegExp(`^${validated.genericName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    form: validated.form,
    strength: validated.strength,
  });

  if (existing) {
    if (!existing.active) {
      // Reactivate if previously deactivated
      existing.active = true;
      await existing.save();
      return existing;
    }
    throw new Error(
      `A medicine with the name "${validated.genericName}" (${validated.form}, ${validated.strength}) already exists.`
    );
  }

  const med = await Medicine.create({
    clinicId: clinicObjectId,
    genericName: validated.genericName,
    brandName: validated.brandName,
    form: validated.form,
    strength: validated.strength,
    category: validated.category,
    source: 'CUSTOM',
    verified: true,
    active: true,
    createdBy: actor,
  });

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.MEDICINE_CUSTOM_CREATE,
    entity: 'Medicine',
    entityId: med._id.toString(),
    actor,
    meta: {
      name: med.genericName,
      form: med.form,
      strength: med.strength,
      source: 'CUSTOM',
    },
    at: clock.now(),
    createdBy: actor,
  });

  return med;
}

export async function deactivateCustomMedicine(
  clinicId: mongoose.Types.ObjectId | string,
  medicineId: mongoose.Types.ObjectId | string,
  actor: TenantActor
): Promise<IMedicine> {
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);
  const medicineObjectId = new mongoose.Types.ObjectId(medicineId);

  const med = await Medicine.findOne({
    clinicId: clinicObjectId,
    _id: medicineObjectId,
    source: 'CUSTOM',
  });

  if (!med) {
    throw new Error('Custom medicine not found or cannot be deactivated');
  }

  med.active = false;
  await med.save();

  return med;
}
