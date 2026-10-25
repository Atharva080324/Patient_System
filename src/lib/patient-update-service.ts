import { Types } from 'mongoose';
import { z } from 'zod';
import { Patient, IPatient } from '../models/Patient';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { clock } from './clock';
import { getTenantContext, runWithTenantContext, TenantActor } from './tenancy';
import { detectDuplicate } from './duplicate-detector';

export class PatientVersionConflictError extends Error {
  constructor() {
    super('Patient record was modified by another user. Please refresh and try again.');
    this.name = 'PatientVersionConflictError';
  }
}

export class PatientImmutableFieldError extends Error {
  constructor(field: string) {
    super(`Cannot modify immutable patient field: ${field}`);
    this.name = 'PatientImmutableFieldError';
  }
}

export const UpdatePatientSchema = z.object({
  version: z.number().int().min(1),
  name: z.string().min(1).max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
  ageYears: z.number().int().min(0).max(120).optional(),
  dob: z.string().optional(),
  sex: z.enum(['Male', 'Female', 'Other']).optional(),
  allergies: z.array(z.string()).optional(),
  medicalNotes: z.string().max(5000).optional(),
  generalNotes: z.string().max(5000).optional(),
  patientCode: z.any().optional(),
  clinicId: z.any().optional(),
});

export type UpdatePatientInput = z.infer<typeof UpdatePatientSchema>;

export async function updatePatient(
  arg1:
    | {
        clinicId: Types.ObjectId | string;
        patientId: Types.ObjectId | string;
        version?: number;
        updates?: Partial<UpdatePatientInput>;
        doctorActor?: TenantActor;
      }
    | Types.ObjectId
    | string,
  arg2?: Types.ObjectId | string,
  arg3?: UpdatePatientInput,
  arg4?: TenantActor
): Promise<IPatient> {
  let clinicIdRaw: Types.ObjectId | string;
  let patientIdRaw: Types.ObjectId | string;
  let input: UpdatePatientInput;
  let actor: TenantActor;

  if (typeof arg1 === 'object' && 'clinicId' in arg1) {
    clinicIdRaw = arg1.clinicId;
    patientIdRaw = arg1.patientId;
    actor = arg1.doctorActor || { type: 'USER', id: 'system' };
    input = {
      version: arg1.version ?? arg1.updates?.version ?? 1,
      ...arg1.updates,
    } as UpdatePatientInput;
  } else {
    clinicIdRaw = arg1;
    patientIdRaw = arg2!;
    input = arg3!;
    actor = arg4 || { type: 'USER', id: 'system' };
  }

  const clinicObjectId =
    clinicIdRaw instanceof Types.ObjectId ? clinicIdRaw : new Types.ObjectId(String(clinicIdRaw));
  const patientObjectId =
    patientIdRaw instanceof Types.ObjectId ? patientIdRaw : new Types.ObjectId(String(patientIdRaw));

  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      updatePatient(
        { clinicId: clinicObjectId, patientId: patientObjectId, updates: input, doctorActor: actor },
        undefined,
        undefined,
        actor
      )
    );
  }

  // Check for attempts to mutate immutable fields
  if (input.patientCode !== undefined) {
    throw new PatientImmutableFieldError('patientCode');
  }
  if (input.clinicId !== undefined) {
    throw new PatientImmutableFieldError('clinicId');
  }

  const validated = UpdatePatientSchema.parse(input);
  const patient = await Patient.findOne({
    _id: patientObjectId,
    clinicId: clinicObjectId,
    deletedAt: null,
  });

  if (!patient) {
    const notFound = new Error('Patient not found');
    (notFound as any).statusCode = 404;
    throw notFound;
  }

  // Optimistic version check
  if (patient.version !== validated.version) {
    throw new PatientVersionConflictError();
  }

  const changedFields: string[] = [];
  const nameChanged = validated.name !== undefined && validated.name !== patient.name;
  const phoneChanged = validated.phone !== undefined && validated.phone !== patient.phone;

  if (nameChanged) {
    patient.name = validated.name!;
    patient.searchName = validated.name!.toLowerCase().trim().replace(/\s+/g, ' ');
    changedFields.push('name');
  }

  if (phoneChanged) {
    patient.phone = validated.phone!;
    changedFields.push('phone');
  }

  if (validated.ageYears !== undefined && validated.ageYears !== patient.ageYears) {
    patient.ageYears = validated.ageYears;
    patient.dob = undefined;
    changedFields.push('ageYears');
  } else if (validated.dob !== undefined && validated.dob !== patient.dob) {
    patient.dob = validated.dob;
    patient.ageYears = undefined;
    changedFields.push('dob');
  }

  if (validated.sex !== undefined && validated.sex !== patient.sex) {
    patient.sex = validated.sex;
    changedFields.push('sex');
  }

  if (validated.allergies !== undefined) {
    patient.medicalHistory = patient.medicalHistory || {
      conditions: [],
      allergies: [],
      currentMedications: [],
      habits: [],
    };
    patient.medicalHistory.allergies = validated.allergies;
    changedFields.push('allergies');
  }

  if (validated.medicalNotes !== undefined && validated.medicalNotes !== patient.notes) {
    patient.notes = validated.medicalNotes;
    changedFields.push('medicalNotes');
  }

  if (validated.generalNotes !== undefined && validated.generalNotes !== patient.generalNotes) {
    patient.generalNotes = validated.generalNotes;
    changedFields.push('generalNotes');
  }

  // If phone or name changed, re-run duplicate detection
  if (nameChanged || phoneChanged) {
    const dupCheck = await detectDuplicate(clinicObjectId, {
      name: patient.name,
      phone: patient.phone,
      ageYears: patient.ageYears,
      dob: patient.dob,
    });

    if (dupCheck.possibleDuplicateOf && dupCheck.possibleDuplicateOf !== patient._id.toString()) {
      patient.possibleDuplicateOf = new Types.ObjectId(dupCheck.possibleDuplicateOf);
      patient.duplicateDismissed = false;
    } else if (dupCheck.existingPatientId && dupCheck.existingPatientId !== patient._id.toString()) {
      patient.possibleDuplicateOf = new Types.ObjectId(dupCheck.existingPatientId);
      patient.duplicateDismissed = false;
    }
  }

  // Increment version
  patient.version = (patient.version || 1) + 1;
  await patient.save();

  // Audit PATIENT_UPDATE listing ONLY changed field names (F7 requirement)
  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.PATIENT_UPDATE,
    entity: 'Patient',
    entityId: patient._id.toString(),
    actor,
    meta: {
      changedFieldNames: changedFields,
      newVersion: patient.version,
    },
    at: clock.now(),
    createdBy: actor,
  });

  return patient;
}

export async function dismissDuplicate(
  arg1:
    | {
        clinicId: Types.ObjectId | string;
        patientId: Types.ObjectId | string;
        doctorActor?: TenantActor;
      }
    | Types.ObjectId
    | string,
  arg2?: Types.ObjectId | string,
  arg3?: TenantActor
): Promise<IPatient> {
  let clinicIdRaw: Types.ObjectId | string;
  let patientIdRaw: Types.ObjectId | string;
  let actor: TenantActor;

  if (typeof arg1 === 'object' && 'clinicId' in arg1) {
    clinicIdRaw = arg1.clinicId;
    patientIdRaw = arg1.patientId;
    actor = arg1.doctorActor || { type: 'USER', id: 'system' };
  } else {
    clinicIdRaw = arg1;
    patientIdRaw = arg2!;
    actor = arg3 || { type: 'USER', id: 'system' };
  }

  const clinicObjectId =
    clinicIdRaw instanceof Types.ObjectId ? clinicIdRaw : new Types.ObjectId(String(clinicIdRaw));
  const patientObjectId =
    patientIdRaw instanceof Types.ObjectId ? patientIdRaw : new Types.ObjectId(String(patientIdRaw));

  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    return runWithTenantContext({ clinicId: clinicObjectId, actor }, () =>
      dismissDuplicate({ clinicId: clinicObjectId, patientId: patientObjectId, doctorActor: actor })
    );
  }

  const patient = await Patient.findOne({
    _id: patientObjectId,
    clinicId: clinicObjectId,
    deletedAt: null,
  });

  if (!patient) {
    const notFound = new Error('Patient not found');
    (notFound as any).statusCode = 404;
    throw notFound;
  }

  patient.duplicateDismissed = true;
  await patient.save();

  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.DUPLICATE_DISMISS,
    entity: 'Patient',
    entityId: patient._id.toString(),
    actor,
    meta: {
      dismissedDuplicateOf: patient.possibleDuplicateOf?.toString(),
    },
    at: clock.now(),
    createdBy: actor,
  });

  return patient;
}

export async function recordPatientView(
  arg1:
    | {
        clinicId: Types.ObjectId | string;
        patientId: Types.ObjectId | string;
        doctorActor?: TenantActor;
      }
    | Types.ObjectId
    | string,
  arg2?: Types.ObjectId | string,
  arg3?: TenantActor
): Promise<void> {
  let clinicIdRaw: Types.ObjectId | string;
  let patientIdRaw: Types.ObjectId | string;
  let actor: TenantActor;

  if (typeof arg1 === 'object' && 'clinicId' in arg1) {
    clinicIdRaw = arg1.clinicId;
    patientIdRaw = arg1.patientId;
    actor = arg1.doctorActor || { type: 'USER', id: 'system' };
  } else {
    clinicIdRaw = arg1;
    patientIdRaw = arg2!;
    actor = arg3 || { type: 'USER', id: 'system' };
  }

  const clinicObjectId =
    clinicIdRaw instanceof Types.ObjectId ? clinicIdRaw : new Types.ObjectId(String(clinicIdRaw));
  const patientObjectId =
    patientIdRaw instanceof Types.ObjectId ? patientIdRaw : new Types.ObjectId(String(patientIdRaw));

  // Audit PATIENT_VIEW with ID ONLY (no names or PII)
  await AuditLog.create({
    clinicId: clinicObjectId,
    action: AuditAction.PATIENT_VIEW,
    entity: 'Patient',
    entityId: patientObjectId.toString(),
    actor,
    at: clock.now(),
    createdBy: actor,
  });
}
