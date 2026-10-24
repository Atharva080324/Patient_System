import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clinicDate,
  startOfClinicDay,
  endOfClinicDay,
  financialYear,
  CLINIC_TIMEZONE,
} from '@/lib/date';
import { FakeClock, setClock, resetClock, clock } from '@/lib/clock';

describe('Date & Clock Primitives (Asia/Kolkata)', () => {
  let fakeClock: FakeClock;

  beforeEach(() => {
    fakeClock = new FakeClock('2026-10-24T12:00:00.000Z');
    setClock(fakeClock);
  });

  afterEach(() => {
    resetClock();
  });

  it('clock interface provides predictable time and can advance', () => {
    expect(clock.now().toISOString()).toBe('2026-10-24T12:00:00.000Z');
    fakeClock.advance(5000);
    expect(clock.now().toISOString()).toBe('2026-10-24T12:00:05.000Z');
  });

  it('clinicDate evaluates date strictly in Asia/Kolkata (+05:30)', () => {
    // 2026-10-24 19:00:00 UTC is 2026-10-25 00:30:00 in Asia/Kolkata (+05:30)
    const lateUtc = new Date('2026-10-24T19:00:00.000Z');
    expect(clinicDate(lateUtc)).toBe('2026-10-25');

    // 2026-10-24 02:00:00 UTC is 2026-10-24 07:30:00 in Asia/Kolkata
    const morningUtc = new Date('2026-10-24T02:00:00.000Z');
    expect(clinicDate(morningUtc)).toBe('2026-10-24');
  });

  it('startOfClinicDay and endOfClinicDay produce exact UTC boundaries', () => {
    const start = startOfClinicDay('2026-10-24');
    const end = endOfClinicDay('2026-10-24');

    // 2026-10-24 00:00:00 IST -> 2026-10-23 18:30:00 UTC
    expect(start.toISOString()).toBe('2026-10-23T18:30:00.000Z');
    // 2026-10-24 23:59:59.999 IST -> 2026-10-24 18:29:59.999 UTC
    expect(end.toISOString()).toBe('2026-10-24T18:29:59.999Z');
  });

  describe('A2: Financial-Year Roll-Over at 1 April 00:00:00 Asia/Kolkata', () => {
    it('evaluates to 2025-26 at 31 March 2026 23:59:59 IST', () => {
      // 31 March 2026 23:59:59 IST is 31 March 2026 18:29:59 UTC
      const lastSecondOfFY = new Date('2026-03-31T18:29:59.000Z');
      expect(financialYear(lastSecondOfFY)).toBe('2025-26');
      expect(clinicDate(lastSecondOfFY)).toBe('2026-03-31');
    });

    it('evaluates to 2026-27 at 1 April 2026 00:00:00 IST', () => {
      // 1 April 2026 00:00:00 IST is 31 March 2026 18:30:00 UTC
      const firstSecondOfNewFY = new Date('2026-03-31T18:30:00.000Z');
      expect(financialYear(firstSecondOfNewFY)).toBe('2026-27');
      expect(clinicDate(firstSecondOfNewFY)).toBe('2026-04-01');
    });

    it('evaluates mid-year dates correctly', () => {
      expect(financialYear(new Date('2026-10-24T10:00:00.000Z'))).toBe('2026-27');
      expect(financialYear(new Date('2027-01-15T10:00:00.000Z'))).toBe('2026-27');
    });
  });
});
