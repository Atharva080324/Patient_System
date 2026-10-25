import mongoose from 'mongoose';
import { z } from 'zod';
import { CaseSheet, ICaseSheet, ITeethEntry } from '../models/CaseSheet';
import { Visit } from '../models/Visit';
import { Patient } from '../models/Patient';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { TenantActor } from './tenancy';
import { ToothEntrySchema } from './fdi-tooth';
import { clock } from './clock';

export class VersionConflictError extends Error {
  public statusCode = 409;
  public latestCaseSheet: ICaseSheet;

  constructor(message: string, latest: ICaseSheet) {
    super(message);
    this.name = 'VersionConflictError';
    this.latestCaseSheet = latest;
  }
}

export const SaveCaseSheetSchema = z
  .object({
    version: z.number().int().min(1, 'Version number must be at least 1'),
    chiefComplaint: z.string().max(2000).optional(),
    history: z.string().max(5000).optional(),
    medicalHistoryNotes: z.string().max(5000).optional(),
    allergies: z.array(z.string().trim().max(100)).max(50).optional(),
    examinationFindings: z.string().max(5000).optional(),
    diagnosis: z.string().max(2000).optional(),
    treatmentDoneOrAdvised: z.string().max(5000).optional(),
    notes: z.string().max(5000).optional(),
    teethEntries: z.array(ToothEntrySchema).max(60).optional(),
  })
  .strict();

export type SaveCaseSheetInput = z.infer<typeof SaveCaseSheetSchema>;

export async function getOrCreateCaseSheet(
  clinicId: mongoose.Types.ObjectId | string,
  visitId: mongoose.Types.ObjectId | string,
  actor: TenantActor
): Promise<ICaseSheet> {
  const visitObjectId = new mongoose.Types.ObjectId(visitId);
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);

  let sheet = await CaseSheet.findOne({ clinicId: clinicObjectId, visitId: visitObjectId });
  if (sheet) {
    await AuditLog.create({
      clinicId: clinicObjectId,
      action: AuditAction.CASE_SHEET_VIEW,
      entity: 'CaseSheet',
      entityId: sheet._id.toString(),
      actor,
      meta: { visitId: visitObjectId.toString(), patientId: sheet.patientId.toString() },
      at: clock.now(),
      createdBy: actor,
    });
    return sheet;
  }

  // Not found: initialize new CaseSheet based on Visit & Patient
  const visit = await Visit.findOne({ clinicId: clinicObjectId, _id: visitObjectId });
  if (!visit) {
    throw new Error(`Visit not found: ${visitId}`);
  }

  const patient = await Patient.findOne({ clinicId: clinicObjectId, _id: visit.patientId });
  const initialAllergies = patient?.medicalHistory?.allergies || [];

  sheet = await CaseSheet.create({
    clinicId: clinicObjectId,
    visitId: visitObjectId,
    patientId: visit.patientId,
    version: 1,
    chiefComplaint: visit.reasonForVisit || '',
    history: '',
    medicalHistoryNotes: '',
    allergies: initialAllergies,
    examinationFindings: '',
    diagnosis: '',
    treatmentDoneOrAdvised: '',
    notes: '',
    teethEntries: [],
    createdBy: actor,
  });

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.CASE_SHEET_VIEW,
    entity: 'CaseSheet',
    entityId: sheet._id.toString(),
    actor,
    meta: { visitId: visitObjectId.toString(), patientId: visit.patientId.toString() },
    at: clock.now(),
    createdBy: actor,
  });

  return sheet;
}

export async function saveCaseSheet(
  clinicId: mongoose.Types.ObjectId | string,
  visitId: mongoose.Types.ObjectId | string,
  input: SaveCaseSheetInput,
  actor: TenantActor
): Promise<ICaseSheet> {
  const validated = SaveCaseSheetSchema.parse(input);
  const visitObjectId = new mongoose.Types.ObjectId(visitId);
  const clinicObjectId = new mongoose.Types.ObjectId(clinicId);

  const existing = await CaseSheet.findOne({ clinicId: clinicObjectId, visitId: visitObjectId });
  if (!existing) {
    throw new Error(`Case sheet not found for visit ${visitId}`);
  }

  // Optimistic concurrency check
  if (existing.version !== validated.version) {
    throw new VersionConflictError(
      `Conflict: The case sheet was updated by another session (v${existing.version}). Your edit was based on v${validated.version}.`,
      existing
    );
  }

  // Detect which field names changed
  const changedFieldNames: string[] = [];
  const setPayload: Record<string, unknown> = {};

  const fieldsToCheck: Array<keyof Omit<SaveCaseSheetInput, 'version'>> = [
    'chiefComplaint',
    'history',
    'medicalHistoryNotes',
    'allergies',
    'examinationFindings',
    'diagnosis',
    'treatmentDoneOrAdvised',
    'notes',
    'teethEntries',
  ];

  for (const field of fieldsToCheck) {
    if (field in validated && validated[field] !== undefined) {
      const incomingVal = validated[field];
      const existingVal = existing.get(field);

      const isChanged =
        Array.isArray(incomingVal)
          ? JSON.stringify(incomingVal) !== JSON.stringify(existingVal)
          : incomingVal !== existingVal;

      if (isChanged) {
        changedFieldNames.push(field);
        setPayload[field] = incomingVal;
      }
    }
  }

  // If nothing actually changed, return existing
  if (changedFieldNames.length === 0) {
    return existing;
  }

  // Atomically update changed fields and increment version
  const updated = await CaseSheet.findOneAndUpdate(
    {
      clinicId: clinicObjectId,
      visitId: visitObjectId,
      version: validated.version,
    },
    {
      $set: setPayload,
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!updated) {
    // Concurrent update happened between the read and the update
    const fresh = await CaseSheet.findOne({ clinicId: clinicObjectId, visitId: visitObjectId });
    throw new VersionConflictError(
      'Conflict: Another session modified this case sheet simultaneously.',
      fresh || existing
    );
  }

  // If allergies changed, sync with Patient record so future visits also have the latest allergies
  if (changedFieldNames.includes('allergies') && validated.allergies) {
    await Patient.updateOne(
      { clinicId: clinicObjectId, _id: existing.patientId },
      { $set: { 'medicalHistory.allergies': validated.allergies } }
    );
  }

  // Audit log: record field NAMES only, NEVER clinical values or patient PII
  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.CASE_SHEET_UPDATE,
    entity: 'CaseSheet',
    entityId: updated._id.toString(),
    actor,
    meta: {
      visitId: visitObjectId.toString(),
      patientId: existing.patientId.toString(),
      fromVersion: validated.version,
      toVersion: updated.version,
      changedFields: changedFieldNames,
    },
    at: clock.now(),
    createdBy: actor,
  });

  return updated;
}
