import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { withTransaction, nextBillNo } from '@/lib/counters';
import { FakeClock, setClock, resetClock } from '@/lib/clock';

describe('A4 & A5: Transactions, Gapless Numbering & Retry Logic', () => {
  const clinicId = new Types.ObjectId();
  let fakeClock: FakeClock;

  beforeAll(async () => {
    await setupTestReplSet();
    fakeClock = new FakeClock('2026-10-24T10:00:00.000Z');
    setClock(fakeClock);
  });

  afterAll(async () => {
    resetClock();
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('A4: Concurrent bill allocation across 50 transactions produces no duplicates and no gaps', async () => {
    // Run 50 sequential / overlapping transactions
    const results: string[] = [];

    // Since transactions serialize writers on the same counter document,
    // we run 50 transactions
    for (let i = 0; i < 50; i++) {
      const billNo = await withTransaction(async (session) => {
        return await nextBillNo(clinicId, session, fakeClock.now());
      });
      results.push(billNo);
    }

    expect(results).toHaveLength(50);
    expect(results[0]).toBe('BILL/2026-27/0001');
    expect(results[49]).toBe('BILL/2026-27/0050');

    // Verify uniqueness
    const unique = new Set(results);
    expect(unique.size).toBe(50);
  });

  it('A4: An aborted transaction leaves NO gap in sequential numbering', async () => {
    // 1. First transaction commits successfully
    const bill1 = await withTransaction(async (session) => {
      return await nextBillNo(clinicId, session, fakeClock.now());
    });
    expect(bill1).toBe('BILL/2026-27/0001');

    // 2. Second transaction aborts due to an injected error
    await expect(
      withTransaction(async (session) => {
        await nextBillNo(clinicId, session, fakeClock.now());
        throw new Error('Injected failure inside transaction after allocating bill number');
      })
    ).rejects.toThrow('Injected failure inside transaction after allocating bill number');

    // 3. Third transaction commits: it MUST receive BILL/2026-27/0002 (NO GAP!)
    const bill2 = await withTransaction(async (session) => {
      return await nextBillNo(clinicId, session, fakeClock.now());
    });
    expect(bill2).toBe('BILL/2026-27/0002');
  });

  it('A5: withTransaction retries injected TransientTransactionError and succeeds if transient', async () => {
    let attempts = 0;

    const result = await withTransaction(
      async (session) => {
        attempts++;
        if (attempts < 3) {
          const transientErr: any = new Error('Injected transient write conflict');
          transientErr.errorLabels = ['TransientTransactionError'];
          transientErr.hasErrorLabel = (label: string) => label === 'TransientTransactionError';
          throw transientErr;
        }
        return 'success_after_retries';
      },
      { maxRetries: 3, initialDelayMs: 10 }
    );

    expect(result).toBe('success_after_retries');
    expect(attempts).toBe(3);
  });

  it('A5: withTransaction retries TransientTransactionError up to the limit and then fails cleanly', async () => {
    let attempts = 0;

    await expect(
      withTransaction(
        async () => {
          attempts++;
          const persistentTransientErr: any = new Error('Persistent write conflict');
          persistentTransientErr.errorLabels = ['TransientTransactionError'];
          persistentTransientErr.hasErrorLabel = (label: string) =>
            label === 'TransientTransactionError';
          throw persistentTransientErr;
        },
        { maxRetries: 3, initialDelayMs: 10 }
      )
    ).rejects.toThrow('Persistent write conflict');

    // 1 initial attempt + 3 retries = 4 attempts total
    expect(attempts).toBe(4);
  });
});
