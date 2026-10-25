import mongoose, { ClientSession, Types } from 'mongoose';
import { Counter } from '../models/Counter';
import { clinicDate, financialYear } from './date';
import { clock } from './clock';

export interface TransactionOptions {
  maxRetries?: number;
  initialDelayMs?: number;
}

/**
 * Executes an operation inside a MongoDB transaction with bounded retries and exponential jitter
 * for TransientTransactionError and UnknownTransactionCommitResult.
 *
 * NOTE: Allocating gapless counters inside transactions serializes concurrent transactions
 * for that specific sequence key. In a single-doctor practice, this trade-off guarantees legal gapless
 * sequences with negligible contention.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 30;
  const initialDelayMs = options.initialDelayMs ?? 25;

  const session = await mongoose.startSession();

  try {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        session.startTransaction();
        const result = await fn(session);
        await session.commitTransaction();
        return result;
      } catch (error: any) {
        if (session.inTransaction()) {
          try {
            await session.abortTransaction();
          } catch {
            // Ignore abort errors
          }
        }

        const isTransient =
          error?.hasErrorLabel?.('TransientTransactionError') ||
          error?.hasErrorLabel?.('UnknownTransactionCommitResult') ||
          error?.message?.includes('TransientTransactionError') ||
          error?.message?.includes('UnknownTransactionCommitResult') ||
          error?.message?.toLowerCase().includes('write conflict') ||
          error?.code === 112 ||
          error?.name === 'MongoTransactionError';

        if (isTransient && attempt < maxRetries) {
          attempt++;
          const backoff = initialDelayMs * Math.min(attempt, 15);
          const jitter = Math.floor(Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
          continue;
        }

        throw error;
      }
    }

    throw new Error('Transaction failed after maximum retries');
  } finally {
    await session.endSession();
  }
}

/**
 * Raw counter increment function using findOneAndUpdate with upsert.
 */
export async function allocateCounter(
  clinicId: Types.ObjectId | string,
  key: string,
  session?: ClientSession
): Promise<number> {
  const idStr = `${clinicId.toString()}:${key}`;
  const cId = typeof clinicId === 'string' ? new Types.ObjectId(clinicId) : clinicId;

  const counter = await Counter.findOneAndUpdate(
    { _id: idStr },
    {
      $inc: { seq: 1 },
      $setOnInsert: {
        _id: idStr,
        clinicId: cId,
        key,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      session,
    }
  );

  return counter.seq;
}

/**
 * Allocates next patient code (P-000001). Gaps allowed. Allocated outside transaction.
 */
export async function nextPatientCode(clinicId: Types.ObjectId | string): Promise<string> {
  const seq = await allocateCounter(clinicId, 'patientCode');
  return `P-${seq.toString().padStart(6, '0')}`;
}

/**
 * Allocates next token for the clinic day (integer 1, 2, ...). Gaps allowed. Allocated outside transaction.
 */
export async function nextToken(
  clinicId: Types.ObjectId | string,
  dateStr = clinicDate(clock.now())
): Promise<number> {
  return allocateCounter(clinicId, `token:${dateStr}`);
}

/**
 * Allocates next Prescription number (RX/2026-27/0001).
 * Gapless: MUST be called inside the active document transaction.
 */
export async function nextRxNumber(
  clinicId: Types.ObjectId | string,
  session: ClientSession,
  instant = clock.now()
): Promise<string> {
  const fy = financialYear(instant);
  const seq = await allocateCounter(clinicId, `rx:${fy}`, session);
  return `RX/${fy}/${seq.toString().padStart(4, '0')}`;
}

/**
 * Allocates next Bill number (BILL/2026-27/0001).
 * Gapless: MUST be called inside the active document transaction.
 */
export async function nextBillNo(
  clinicId: Types.ObjectId | string,
  session: ClientSession,
  instant = clock.now()
): Promise<string> {
  const fy = financialYear(instant);
  const seq = await allocateCounter(clinicId, `bill:${fy}`, session);
  return `BILL/${fy}/${seq.toString().padStart(4, '0')}`;
}

/**
 * Allocates next Receipt number (REC/2026-27/0001).
 * Gapless: MUST be called inside the active document transaction.
 */
export async function nextReceiptNo(
  clinicId: Types.ObjectId | string,
  session: ClientSession,
  instant = clock.now()
): Promise<string> {
  const fy = financialYear(instant);
  const seq = await allocateCounter(clinicId, `receipt:${fy}`, session);
  return `REC/${fy}/${seq.toString().padStart(4, '0')}`;
}

/**
 * Allocates next Estimate number (EST/2026-27/0001).
 * Gapless: MUST be called inside the active document transaction.
 */
export async function nextEstimateNo(
  clinicId: Types.ObjectId | string,
  session: ClientSession,
  instant = clock.now()
): Promise<string> {
  const fy = financialYear(instant);
  const seq = await allocateCounter(clinicId, `estimate:${fy}`, session);
  return `EST/${fy}/${seq.toString().padStart(4, '0')}`;
}
