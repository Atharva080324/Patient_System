import { Types } from 'mongoose';
import { z } from 'zod';
import { Patient, IPatient } from '../models/Patient';
import { Visit, IVisit } from '../models/Visit';
import { IdempotencyKey } from '../models/IdempotencyKey';
import { AuditLog, AuditAction } from '../models/AuditLog';
import { indianMobile, personName, assertPlainInput } from './validation';
import { clock } from './clock';
import { clinicDate } from './date';
import { nextPatientCode, nextToken, withTransaction } from './counters';
import { evaluateDuplicate, normalizePhone } from './duplicate-detector';

export const RegistrationInputSchema = z
  .object({
    name: personName,
    ageYears: z.number().int().min(0).max(120).optional(),
    dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be in YYYY-MM-DD format')
      .optional(),
    sex: z.enum(['Male', 'Female', 'Other']),
    phone: indianMobile,
    reasonForVisit: z.string().trim().min(1).max(200),
    consent: z.literal(true, { message: 'Consent must be accepted' }),
    consentTextVersion: z.string().min(1).default('1.0'),
    idempotencyKey: z.string().uuid(),
    confirm_hp: z.string().optional(), // Honeypot field
  })
  .strict()
  .refine(
    (data) => {
      const hasAge = data.ageYears !== undefined && data.ageYears !== null;
      const hasDob = !!data.dob;
      return (hasAge || hasDob) && !(hasAge && hasDob);
    },
    {
      message: 'Provide exactly one of ageYears or dob',
      path: ['ageYears'],
    }
  );

export type RegistrationInput = z.infer<typeof RegistrationInputSchema>;

export interface RegistrationResult {
  ok: boolean;
  token: number;
}

export interface RegisterPatientOptions {
  injectFailure?: 'VISIT_CREATION' | 'PATIENT_CREATION';
}

export async function registerWalkInPatient(
  clinicId: Types.ObjectId | string,
  deviceTokenId: string,
  rawInput: unknown,
  options: RegisterPatientOptions = {}
): Promise<RegistrationResult> {
  assertPlainInput(rawInput);
  const validated = RegistrationInputSchema.parse(rawInput);
  const cId = typeof clinicId === 'string' ? new Types.ObjectId(clinicId) : clinicId;

  // 1. Honeypot check: if filled, act like success, create nothing, write audit entry
  if (validated.confirm_hp && validated.confirm_hp.trim().length > 0) {
    await AuditLog.create({
      clinicId: cId,
      actor: { type: 'KIOSK', id: deviceTokenId },
      action: AuditAction.HONEYPOT_TRIGGERED,
      entity: 'Kiosk',
      entityId: deviceTokenId,
      meta: { reason: 'Honeypot field filled by client' },
      at: clock.now(),
      createdBy: { type: 'KIOSK', id: deviceTokenId },
    });
    return { ok: true, token: 0 };
  }

  // 2. Idempotency management via MongoDB unique key
  try {
    await IdempotencyKey.create({
      clinicId: cId,
      key: validated.idempotencyKey,
      status: 'PROCESSING',
    });
  } catch (error: any) {
    if (error?.code === 11000 || error?.message?.includes('duplicate key')) {
      // Key exists: wait for result or return cached
      for (let attempt = 0; attempt < 40; attempt++) {
        const existing = await IdempotencyKey.findOne({
          clinicId: cId,
          key: validated.idempotencyKey,
        }).lean();

        if (existing?.status === 'COMPLETED' && existing.response) {
          return existing.response as RegistrationResult;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Concurrent registration request with the same idempotency key timed out');
    }
    throw error;
  }

  try {
    // 3. Duplicate detection
    const normalizedPhone = normalizePhone(validated.phone);
    const existingPatients = await Patient.find({
      clinicId: cId,
      phone: normalizedPhone,
      deletedAt: { $exists: false },
    })
      .select('_id patientCode name phone ageYears dob')
      .lean();

    const decision = evaluateDuplicate(
      {
        name: validated.name,
        phone: validated.phone,
        ageYears: validated.ageYears,
        dob: validated.dob,
      },
      existingPatients.map((p) => ({
        _id: p._id.toString(),
        patientCode: p.patientCode,
        name: p.name,
        phone: p.phone,
        ageYears: p.ageYears,
        dob: p.dob,
      }))
    );

    // 4. Counters allocated outside transaction (gappable)
    const dateStr = clinicDate(clock.now());
    const token = await nextToken(cId, dateStr);

    let patientId: Types.ObjectId;
    let isNewPatient = false;

    if (decision.action === 'RETURNING_PATIENT' && decision.matchedPatientId) {
      patientId = new Types.ObjectId(decision.matchedPatientId);
    } else {
      isNewPatient = true;
      patientId = new Types.ObjectId();
    }

    let allocatedPatientCode: string | undefined;
    if (isNewPatient) {
      let code = await nextPatientCode(cId);
      while (await Patient.exists({ clinicId: cId, patientCode: code })) {
        code = await nextPatientCode(cId);
      }
      allocatedPatientCode = code;
    }

    // 5. Execute atomic creation inside transaction
    let createdVisitId: any = null;

    await withTransaction(async (session) => {
      if (options.injectFailure === 'PATIENT_CREATION') {
        throw new Error('Injected failure: PATIENT_CREATION');
      }

      if (isNewPatient) {
        await Patient.create(
          [
            {
              _id: patientId,
              clinicId: cId,
              patientCode: allocatedPatientCode,
              name: validated.name,
              ageYears: validated.ageYears,
              dob: validated.dob,
              sex: validated.sex,
              phone: normalizedPhone,
              source: 'WALK_IN',
              consentAt: clock.now(),
              consentTextVersion: validated.consentTextVersion,
              possibleDuplicateOf: decision.possibleDuplicateOfId
                ? new Types.ObjectId(decision.possibleDuplicateOfId)
                : undefined,
              createdBy: { type: 'KIOSK', id: deviceTokenId },
            },
          ],
          { session }
        );
      }

      if (options.injectFailure === 'VISIT_CREATION') {
        throw new Error('Injected failure: VISIT_CREATION');
      }

      const [visit] = await Visit.create(
        [
          {
            clinicId: cId,
            patientId,
            date: dateStr,
            token,
            type: 'WALK_IN',
            status: 'WAITING',
            checkInAt: clock.now(),
            reasonForVisit: validated.reasonForVisit,
            caseSheet: {
              chiefComplaint: validated.reasonForVisit,
              historyOfPresentIllness: '',
              extraOral: '',
              intraOral: '',
              findings: [],
              investigations: [],
              diagnosis: '',
              treatmentPlan: [],
              procedureNotes: '',
              advice: '',
            },
            version: 1,
            createdBy: { type: 'KIOSK', id: deviceTokenId },
          },
        ],
        { session }
      );

      createdVisitId = visit._id;
    });

    // 6. Write Audit Log
    if (createdVisitId) {
      await AuditLog.create({
        clinicId: cId,
        actor: { type: 'KIOSK', id: deviceTokenId },
        action: AuditAction.KIOSK_REGISTER,
        entity: 'Visit',
        entityId: createdVisitId.toString(),
        meta: {
          patientId: patientId.toString(),
          token,
          date: dateStr,
          isNewPatient,
          duplicateFlag: decision.reason === 'POSSIBLE_DUPLICATE_FLAG',
        },
        at: clock.now(),
        createdBy: { type: 'KIOSK', id: deviceTokenId },
      });
    }

    const result: RegistrationResult = {
      ok: true,
      token,
    };

    // 7. Complete idempotency key with cached response
    await IdempotencyKey.updateOne(
      { clinicId: cId, key: validated.idempotencyKey },
      { status: 'COMPLETED', response: result }
    );

    return result;
  } catch (error) {
    // If registration failed, delete idempotency key so client can retry
    try {
      await IdempotencyKey.deleteOne({ clinicId: cId, key: validated.idempotencyKey });
    } catch {
      // Ignore cleanup error
    }
    throw error;
  }
}
