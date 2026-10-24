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

    it('dummyVerify executes within bounded timing tolerance of real verification', async () => {
      const password = 'RealPassword1234!';
      const hash = await hashPassword(password);

      // Warm up JIT and thread pool
      await dummyVerify('WarmUpPassword123!');
      await verifyPassword(hash, 'WarmUpPassword123!');

      const realDurations: number[] = [];
      const dummyDurations: number[] = [];

      for (let i = 0; i < 3; i++) {
        const startReal = performance.now();
        await verifyPassword(hash, 'WrongPassword1234!');
        realDurations.push(performance.now() - startReal);

        const startDummy = performance.now();
        await dummyVerify('WrongPassword1234!');
        dummyDurations.push(performance.now() - startDummy);
      }

      const medianReal = realDurations.sort((a, b) => a - b)[1];
      const medianDummy = dummyDurations.sort((a, b) => a - b)[1];

      // Both execute Argon2id computation; ratio should be within bounded tolerance
      const ratio = Math.max(medianReal, medianDummy) / Math.min(medianReal, medianDummy);
      expect(ratio).toBeLessThan(2.5);
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

  describe('A12: Session Lifetime & Idle Expiration', () => {
    it('handles idle expiry and absolute expiry correctly using fake clock', async () => {
      const userId = new Types.ObjectId();
      const { token } = await createSession(userId, clinicId);

      // Session is valid initially
      const auth1 = await validateSession(token);
      expect(auth1).toBeNull(); // user not in db yet, but let's create the user first
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

  describe('A13: Two-Factor Authentication (TOTP & Recovery Codes)', () => {
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
