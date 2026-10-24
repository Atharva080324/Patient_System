import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import {
  createSession,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  unlockKiosk,
  rotateKioskPin,
  validateKioskToken,
} from '@/lib/auth';
import {
  hashPassword,
  hashKioskPin,
  verifyPassword,
  dummyVerify,
  validatePasswordStrength,
  hashToken,
} from '@/lib/passwords';
import { generateTOTPSetup, verifyTOTPCode, generateTOTPCode } from '@/lib/totp';
import { User } from '@/models/User';
import { Clinic } from '@/models/Clinic';
import { DeviceToken } from '@/models/DeviceToken';
import { FakeClock, setClock, resetClock } from '@/lib/clock';
import { systemScope } from '@/lib/tenancy';
import { RateLimitRules } from '@/lib/rate-limit';

describe('Auth Core Integration (A11, A12, A13, A14)', () => {
  const clinicId = new Types.ObjectId();
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

  describe('A11: Login Credential Verification & Timing Tolerance', () => {
    it('validates password strength rules (min 12 chars, no common passwords)', () => {
      expect(validatePasswordStrength('short').valid).toBe(false);
      expect(validatePasswordStrength('password123456').valid).toBe(false);
      expect(validatePasswordStrength('StrongSecurePassword2026!').valid).toBe(true);
    });

    it('dummyVerify executes within bounded timing tolerance of real verification (20 runs non-flaky)', async () => {
      const password = 'RealPassword1234!';
      const hash = await hashPassword(password);

      // Warm up JIT and thread pool
      await dummyVerify('WarmUpPassword123!');
      await verifyPassword(hash, 'WarmUpPassword123!');

      const ratios: number[] = [];

      for (let i = 0; i < 20; i++) {
        const startReal = performance.now();
        await verifyPassword(hash, 'WrongPassword1234!');
        const realDuration = performance.now() - startReal;

        const startDummy = performance.now();
        await dummyVerify('WrongPassword1234!');
        const dummyDuration = performance.now() - startDummy;

        const ratio = Math.max(realDuration, dummyDuration) / Math.max(0.1, Math.min(realDuration, dummyDuration));
        ratios.push(ratio);
      }

      // Median ratio across 20 runs must be tightly bounded within bounded tolerance
      const sortedRatios = [...ratios].sort((a, b) => a - b);
      const medianRatio = sortedRatios[Math.floor(sortedRatios.length / 2)];
      expect(medianRatio).toBeLessThan(2.5);
    });

    it('enforces lockout after 5 failed attempts per email and IP', async () => {
      const email = 'target@clinic.com';
      for (let i = 1; i <= 5; i++) {
        const res = await RateLimitRules.loginEmailFailure(email);
        expect(res.allowed).toBe(true);
      }
      const sixthAttempt = await RateLimitRules.loginEmailFailure(email);
      expect(sixthAttempt.allowed).toBe(false);
    });
  });

  describe('A12: Session Lifetime, Rotation, Server-Side Logout, and Token Hashing', () => {
    it('stores session tokens strictly hashed and never in raw plaintext', async () => {
      const { Session } = await import('@/models/Session');
      const userId = new Types.ObjectId();
      const { token, session } = await createSession(userId, clinicId);

      expect(token).toBeDefined();
      expect(session.tokenHash).toBe(hashToken(token));

      // Direct search by raw plaintext token returns null
      const foundByRaw = await systemScope(clinicId, () => Session.findOne({ tokenHash: token }));
      expect(foundByRaw).toBeNull();

      // Search by SHA-256 hash succeeds
      const foundByHash = await systemScope(clinicId, () => Session.findOne({ tokenHash: hashToken(token) }));
      expect(foundByHash).not.toBeNull();
      expect((foundByHash as any).token).toBeUndefined();
    });

    it('rotates session ID at login, invalidating the previous session', async () => {
      const { rotateSession } = await import('@/lib/auth');
      const passwordHash = await hashPassword('DoctorPassword1234');
      const user = await systemScope(clinicId, async () => {
        return User.create({
          clinicId,
          name: 'Dr. Rotate',
          email: 'dr.rotate@clinic.com',
          passwordHash,
          role: 'DOCTOR',
          createdBy: { type: 'SYSTEM', id: 'test' },
        });
      });

      // Session 1 created
      const { token: session1 } = await createSession(user._id, clinicId);
      expect(await validateSession(session1)).not.toBeNull();

      // Session rotated (e.g. at login or 2FA step)
      const { token: session2 } = await rotateSession(session1, user._id, clinicId);
      expect(session2).not.toBe(session1);

      // Old session is revoked server-side
      expect(await validateSession(session1)).toBeNull();

      // New rotated session is valid
      const validatedNew = await validateSession(session2);
      expect(validatedNew).not.toBeNull();
      expect(validatedNew?.user.email).toBe('dr.rotate@clinic.com');
    });

    it('enforces immediate server-side session invalidation on logout', async () => {
      const { Session } = await import('@/models/Session');
      const passwordHash = await hashPassword('DoctorPassword1234');
      const user = await systemScope(clinicId, async () => {
        return User.create({
          clinicId,
          name: 'Dr. Logout',
          email: 'dr.logout@clinic.com',
          passwordHash,
          role: 'DOCTOR',
          createdBy: { type: 'SYSTEM', id: 'test' },
        });
      });

      const { token } = await createSession(user._id, clinicId);
      expect(await validateSession(token)).not.toBeNull();

      // Simulate logout: revoke session
      await revokeSession(token);

      // Verify revokedAt is set on server-side document
      const doc = await systemScope(clinicId, () => Session.findOne({ tokenHash: hashToken(token) }));
      expect(doc?.revokedAt).toBeDefined();

      // Subsequent session validation fails immediately
      expect(await validateSession(token)).toBeNull();
    });

    it('session expires on idle timeout (4 hours) or absolute timeout (12 hours)', async () => {
      const passwordHash = await hashPassword('DoctorPassword1234');
      const user = await systemScope(clinicId, async () => {
        return User.create({
          clinicId,
          name: 'Dr. Test',
          email: 'dr.test@clinic.com',
          passwordHash,
          role: 'DOCTOR',
          createdBy: { type: 'SYSTEM', id: 'test' },
        });
      });

      const { token } = await createSession(user._id, clinicId);

      // 1. Immediately valid
      let sessionRes = await validateSession(token);
      expect(sessionRes).not.toBeNull();
      expect(sessionRes?.user.email).toBe('dr.test@clinic.com');

      // 2. Advance 2 hours (less than 4h idle limit) -> valid
      fakeClock.advance(2 * 60 * 60 * 1000);
      sessionRes = await validateSession(token);
      expect(sessionRes).not.toBeNull();

      // 3. Advance 4 hours and 1 minute without activity -> expired by idle timeout
      fakeClock.advance(4 * 60 * 60 * 1000 + 60 * 1000);
      sessionRes = await validateSession(token);
      expect(sessionRes).toBeNull();

      // 4. Create new session and test absolute expiry (12 hours)
      const { token: token2 } = await createSession(user._id, clinicId);
      expect(await validateSession(token2)).not.toBeNull();

      // Keep touching session every 2 hours until 13 hours total
      for (let i = 0; i < 6; i++) {
        fakeClock.advance(2 * 60 * 60 * 1000);
        await validateSession(token2);
      }
      // Total elapsed > 12 hours absolute lifetime
      fakeClock.advance(60 * 1000);
      expect(await validateSession(token2)).toBeNull();
    });

    it('password change revokes all existing sessions', async () => {
      const passwordHash = await hashPassword('OldPassword1234');
      const user = await systemScope(clinicId, async () => {
        return User.create({
          clinicId,
          name: 'Dr. Test 2',
          email: 'dr.test2@clinic.com',
          passwordHash,
          role: 'DOCTOR',
          createdBy: { type: 'SYSTEM', id: 'test' },
        });
      });

      const { token: session1 } = await createSession(user._id, clinicId);
      const { token: session2 } = await createSession(user._id, clinicId);

      expect(await validateSession(session1)).not.toBeNull();
      expect(await validateSession(session2)).not.toBeNull();

      const { token: session3 } = await createSession(user._id, clinicId);
      expect(await validateSession(session3)).not.toBeNull();
      await revokeSession(session3);
      expect(await validateSession(session3)).toBeNull();

      // Revoke all sessions (as done during password reset/change)
      await revokeAllUserSessions(user._id, clinicId);

      expect(await validateSession(session1)).toBeNull();
      expect(await validateSession(session2)).toBeNull();
    });
  });

  describe('A13: Two-Factor Authentication, Replay Prevention, and Recovery Code Race', () => {
    it('prevents TOTP code replay (the same code accepted only once)', async () => {
      const email = 'doctor.replay@clinic.com';
      const setup = await generateTOTPSetup(email);
      const code = generateTOTPCode(setup.secret);

      // First verification passes
      const firstTry = verifyTOTPCode(code, setup.secret);
      expect(firstTry).toBe(true);

      // Record code as last used
      const lastCode = code;

      // Replay of exact same code within valid time window is rejected
      const replayTry = verifyTOTPCode(code, setup.secret, lastCode);
      expect(replayTry).toBe(false);

      // Different code or subsequent code is accepted
      const otherSecret = (await generateTOTPSetup('other@clinic.com')).secret;
      const otherCode = generateTOTPCode(otherSecret);
      expect(verifyTOTPCode(otherCode, otherSecret, lastCode)).toBe(true);
    });

    it('recovery code race: two parallel redemptions result in exactly one success', async () => {
      const recoveryCode = 'RACE123456';
      const codeHash = hashToken(recoveryCode);

      const user = await systemScope(clinicId, async () => {
        return User.create({
          clinicId,
          name: 'Dr. Race',
          email: 'dr.race@clinic.com',
          passwordHash: await hashPassword('RacePassword1234'),
          role: 'DOCTOR',
          totpEnabled: true,
          totpSecret: (await generateTOTPSetup('dr.race@clinic.com')).secret,
          recoveryCodes: [{ hash: codeHash }],
          createdBy: { type: 'SYSTEM', id: 'test' },
        });
      });

      // Function to atomically redeem recovery code within tenant context
      const redeemCode = async () => {
        return systemScope(clinicId, async () => {
          return User.findOneAndUpdate(
            {
              _id: user._id,
              'recoveryCodes.hash': codeHash,
              'recoveryCodes.usedAt': { $exists: false },
            },
            {
              $set: {
                'recoveryCodes.$.usedAt': fakeClock.now(),
                lastLoginAt: fakeClock.now(),
              },
            },
            { returnDocument: 'after' }
          );
        });
      };

      // Launch two simultaneous parallel redemptions
      const [res1, res2] = await Promise.all([redeemCode(), redeemCode()]);

      // Exactly one succeeds and one returns null (fails)
      const successCount = [res1, res2].filter((r) => r !== null).length;
      const failureCount = [res1, res2].filter((r) => r === null).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify recovery code is marked used in DB
      const updatedUser = await systemScope(clinicId, () => User.findById(user._id));
      expect(updatedUser?.recoveryCodes[0].usedAt).toBeDefined();
    });

    it('enrolls TOTP, validates authenticator codes, and single-use recovery codes', async () => {
      const email = 'doctor.totp@clinic.com';
      const setup = await generateTOTPSetup(email);

      expect(setup.secret).toBeDefined();
      expect(setup.recoveryCodes).toHaveLength(10);
      expect(setup.hashedRecoveryCodes).toHaveLength(10);

      // Verify authentic TOTP code
      const currentOtp = generateTOTPCode(setup.secret);
      expect(verifyTOTPCode(currentOtp, setup.secret)).toBe(true);
      expect(verifyTOTPCode('000000', setup.secret)).toBe(false);

      // Verify recovery code hashing
      const testRecoveryCode = setup.recoveryCodes[0];
      const testCodeHash = hashToken(testRecoveryCode);
      expect(setup.hashedRecoveryCodes[0].hash).toBe(testCodeHash);
    });
  });

  describe('CSRF Protection: Origin and Sec-Fetch-Site Checks', () => {
    it('rejects cross-site requests (Sec-Fetch-Site: cross-site) on state-changing routes', async () => {
      const { verifyCsrf } = await import('@/lib/csrf');
      const { NextRequest } = await import('next/server');

      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: {
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
        },
      });

      const result = verifyCsrf(req);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/cross-site/i);
    });

    it('rejects requests with untrusted Origin header', async () => {
      const { verifyCsrf } = await import('@/lib/csrf');
      const { NextRequest } = await import('next/server');

      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: {
          origin: 'https://evil-attacker.com',
          host: 'localhost:3000',
        },
      });

      const result = verifyCsrf(req);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/does not match host/i);
    });

    it('allows same-origin state-changing requests and non-mutating GET requests', async () => {
      const { verifyCsrf } = await import('@/lib/csrf');
      const { NextRequest } = await import('next/server');

      // Valid same-origin POST
      const postReq = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          'sec-fetch-site': 'same-origin',
        },
      });
      expect(verifyCsrf(postReq).valid).toBe(true);

      // Safe GET request
      const getReq = new NextRequest('http://localhost:3000/api/health', {
        method: 'GET',
        headers: {
          origin: 'https://evil-attacker.com', // GET requests not blocked by CSRF
        },
      });
      expect(verifyCsrf(getReq).valid).toBe(true);
    });
  });

  describe('A14: Kiosk Device Authentication & PIN Rotation', () => {
    it('correct PIN issues 12h device token, stored only as hash', async () => {
      const pinHash = await hashKioskPin('4321');
      const clinic = await Clinic.create({
        name: 'Kiosk Clinic',
        address: 'Chhatrapati Sambhajinagar',
        phone: '9822000000',
        email: 'kiosk@clinic.com',
        registrationNo: 'REG-100',
        timezone: 'Asia/Kolkata',
        paperSize: 'A5',
        kioskPinHash: pinHash,
        createdBy: { type: 'SYSTEM', id: 'test' },
      });

      // 1. Correct PIN unlocks kiosk
      const { token, expiresAt } = await unlockKiosk(clinic._id, '4321', '192.168.1.50');
      expect(token).toBeDefined();
      expect(expiresAt.getTime() - fakeClock.now().getTime()).toBe(12 * 60 * 60 * 1000);

      // Verify token is stored as SHA-256 hash in database
      const tokenHash = hashToken(token);
      const stored = await systemScope(clinic._id, () => DeviceToken.findOne({ tokenHash }));
      expect(stored).not.toBeNull();
      expect(stored?.tokenHash).toBe(tokenHash);

      // Token validates successfully
      const validated = await validateKioskToken(token);
      expect(validated).not.toBeNull();

      // 2. PIN Rotation revokes existing device tokens
      await rotateKioskPin(clinic._id, '9999', { type: 'USER', id: 'admin' });

      // Previously issued token is now revoked
      const afterRotate = await validateKioskToken(token);
      expect(afterRotate).toBeNull();

      // New PIN works, old PIN fails
      await expect(unlockKiosk(clinic._id, '4321', '192.168.1.51')).rejects.toThrow();
      const newUnlock = await unlockKiosk(clinic._id, '9999', '192.168.1.51');
      expect(newUnlock.token).toBeDefined();
    });
  });
});
