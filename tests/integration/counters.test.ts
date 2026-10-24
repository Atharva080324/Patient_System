import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import {
  allocateCounter,
  nextPatientCode,
  nextToken,
  nextRxNumber,
  nextReceiptNo,
  nextEstimateNo,
  withTransaction,
} from '@/lib/counters';

describe('A1 & A2: Atomic Numbering & Concurrency', () => {
  const clinicId = new Types.ObjectId();

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('A1: 100 parallel counter increments produce 100 unique, consecutive numbers', async () => {
    const promises = Array.from({ length: 100 }, () =>
      allocateCounter(clinicId, 'parallel_key')
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(100);
    const sorted = [...results].sort((a, b) => a - b);
    const expected = Array.from({ length: 100 }, (_, i) => i + 1);

    expect(sorted).toEqual(expected);

    // Verify all 100 are unique
    const unique = new Set(results);
    expect(unique.size).toBe(100);
  });

  it('allocates sequential patient codes (P-000001, P-000002, ...)', async () => {
    const code1 = await nextPatientCode(clinicId);
    const code2 = await nextPatientCode(clinicId);
    const code3 = await nextPatientCode(clinicId);

    expect(code1).toBe('P-000001');
    expect(code2).toBe('P-000002');
    expect(code3).toBe('P-000003');
  });

  it('A2: Token counter increments per day and restarts at 1 on a new clinic day', async () => {
    const day1Token1 = await nextToken(clinicId, '2026-10-24');
    const day1Token2 = await nextToken(clinicId, '2026-10-24');
    const day1Token3 = await nextToken(clinicId, '2026-10-24');

    expect(day1Token1).toBe(1);
    expect(day1Token2).toBe(2);
    expect(day1Token3).toBe(3);

    // New clinic day
    const day2Token1 = await nextToken(clinicId, '2026-10-25');
    const day2Token2 = await nextToken(clinicId, '2026-10-25');

    expect(day2Token1).toBe(1);
    expect(day2Token2).toBe(2);
  });

  it('allocates gapless sequential Rx, Receipt, and Estimate numbers inside transactions', async () => {
    await withTransaction(async (session) => {
      const rx = await nextRxNumber(clinicId, session, new Date('2026-10-24T10:00:00Z'));
      const rec = await nextReceiptNo(clinicId, session, new Date('2026-10-24T10:00:00Z'));
      const est = await nextEstimateNo(clinicId, session, new Date('2026-10-24T10:00:00Z'));

      expect(rx).toBe('RX/2026-27/0001');
      expect(rec).toBe('REC/2026-27/0001');
      expect(est).toBe('EST/2026-27/0001');
    });
  });
});

