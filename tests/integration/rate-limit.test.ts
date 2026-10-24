import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import { rateLimit, RateLimitRules } from '@/lib/rate-limit';
import { FakeClock, setClock, resetClock } from '@/lib/clock';

describe('MongoDB-Backed Fixed Window Rate Limiting', () => {
  let fakeClock: FakeClock;

  beforeAll(async () => {
    await setupTestReplSet();
    fakeClock = new FakeClock('2026-10-24T12:00:00.000Z');
    setClock(fakeClock);
  });

  afterAll(async () => {
    resetClock();
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('allows requests within limit and rejects the limit + 1 attempt', async () => {
    const key = 'test_key';
    const limit = 5;
    const windowSeconds = 60;

    for (let i = 1; i <= limit; i++) {
      const res = await rateLimit(key, limit, windowSeconds);
      expect(res.allowed).toBe(true);
      expect(res.count).toBe(i);
      expect(res.remaining).toBe(limit - i);
    }

    // 6th attempt exceeds limit
    const exceeded = await rateLimit(key, limit, windowSeconds);
    expect(exceeded.allowed).toBe(false);
    expect(exceeded.count).toBe(6);
    expect(exceeded.remaining).toBe(0);
    expect(exceeded.retryAfterSeconds).toBeGreaterThan(0);
    expect(exceeded.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('resets window after windowSeconds elapse', async () => {
    const key = 'window_reset_key';
    const limit = 3;
    const windowSeconds = 60;

    for (let i = 1; i <= limit; i++) {
      await rateLimit(key, limit, windowSeconds);
    }

    // Attempt at limit is allowed, next rejected
    expect((await rateLimit(key, limit, windowSeconds)).allowed).toBe(false);

    // Advance clock past the 60s window
    fakeClock.advance(65000);

    // New window begins: request should now be allowed with count 1
    const newWindowRes = await rateLimit(key, limit, windowSeconds);
    expect(newWindowRes.allowed).toBe(true);
    expect(newWindowRes.count).toBe(1);
    expect(newWindowRes.remaining).toBe(limit - 1);
  });

  it('applies standard rule presets correctly', async () => {
    const emailRes = await RateLimitRules.loginEmailFailure('doctor@test.com');
    expect(emailRes.allowed).toBe(true);
    expect(emailRes.remaining).toBe(4); // limit is 5

    const ipRes = await RateLimitRules.kioskUnlockIp('192.168.1.100');
    expect(ipRes.allowed).toBe(true);
    expect(ipRes.remaining).toBe(4); // limit is 5

    const loginIpRes = await RateLimitRules.loginIpFailure('192.168.1.101');
    expect(loginIpRes.allowed).toBe(true);
    expect(loginIpRes.remaining).toBe(19); // limit is 20

    const apiRes = await RateLimitRules.defaultApi('192.168.1.102');
    expect(apiRes.allowed).toBe(true);
    expect(apiRes.remaining).toBe(119); // limit is 120
  });
});
