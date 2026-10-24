import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest, NextResponse } from 'next/server';
import { setupTestReplSet, teardownTestReplSet } from '../integration/test-db-helper';
import {
  getSessionCookieName,
  getKioskCookieName,
  withAuth,
  withKiosk,
  publicRoute,
  validateSession,
  validateKioskToken,
  unlockKiosk,
  SESSION_COOKIE_NAME,
  KIOSK_COOKIE_NAME,
  DEV_SESSION_COOKIE_NAME,
  DEV_KIOSK_COOKIE_NAME,
} from '@/lib/auth';
import {
  validatePasswordStrength,
  hashPassword,
  hashKioskPin,
  verifyPassword,
  dummyVerify,
  hashToken,
} from '@/lib/passwords';
import {
  generateTOTPSecret,
  getTOTPUrl,
  generateTOTPSetup,
  verifyTOTPCode,
  generateTOTPCode,
} from '@/lib/totp';
import { generateQRCodeSVG, generateQRCodeDataURL } from '@/lib/qr';
import { verifyCsrf } from '@/lib/csrf';
import { FakeClock, SystemClock, clock, setClock, resetClock } from '@/lib/clock';
import {
  asPaise,
  subtractPaise,
  allocateAcrossItems,
  amountInWordsINR,
  MAX_PAISE,
} from '@/lib/money';
import {
  requireTenantContext,
  getTenantContext,
  runWithTenantContext,
  systemScope,
  TenantContextMissingError,
} from '@/lib/tenancy';
import { env } from '@/lib/env';

describe('Exhaustive Per-File Core Coverage Test Suite', () => {
  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });
  describe('Clock Primitives (clock.ts)', () => {
    it('exercises SystemClock and FakeClock set method', () => {
      const sysClock = new SystemClock();
      expect(sysClock.now()).toBeInstanceOf(Date);

      const fakeClock = new FakeClock('2026-01-01T00:00:00.000Z');
      expect(fakeClock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');

      fakeClock.set('2026-06-15T10:30:00.000Z');
      expect(fakeClock.now().toISOString()).toBe('2026-06-15T10:30:00.000Z');

      fakeClock.advance(1000);
      expect(fakeClock.now().toISOString()).toBe('2026-06-15T10:30:01.000Z');

      setClock(fakeClock);
      expect(clock.now().toISOString()).toBe('2026-06-15T10:30:01.000Z');

      resetClock();
      expect(clock.now()).toBeInstanceOf(Date);
    });
  });

  describe('Money Primitives (money.ts)', () => {
    it('throws error for invalid non-safe integer in asPaise', () => {
      expect(() => asPaise(1.5)).toThrow(/not a safe integer/);
      expect(() => asPaise(NaN)).toThrow(/not a safe integer/);
    });

    it('throws error on paise arithmetic overflow', () => {
      expect(() => subtractPaise(asPaise(MAX_PAISE), asPaise(-1000))).toThrow(/arithmetic overflow/);
    });

    it('allocates discount across line items using Largest Remainder', () => {
      expect(allocateAcrossItems(asPaise(0), [asPaise(100), asPaise(200)])).toEqual([0, 0]);
      expect(allocateAcrossItems(asPaise(100), [])).toEqual([]);
      expect(allocateAcrossItems(asPaise(100), [asPaise(0), asPaise(0)])).toEqual([0, 0]);

      // Distribute 100 paise across 3 equal items (33.33 each -> 34, 33, 33)
      const allocated = allocateAcrossItems(asPaise(100), [asPaise(1000), asPaise(1000), asPaise(1000)]);
      expect(allocated.reduce((a, b) => a + b, 0)).toBe(100);
      expect(allocated).toEqual([34, 33, 33]);
    });

    it('converts negative amounts to words', () => {
      expect(amountInWordsINR(asPaise(-50000))).toBe('Minus Rupees Five Hundred Only');
    });
  });

  describe('Tenancy Primitives (tenancy.ts)', () => {
    it('requireTenantContext throws when outside context', () => {
      expect(getTenantContext()).toBeUndefined();
      expect(() => requireTenantContext()).toThrow(TenantContextMissingError);
    });

    it('requireTenantContext returns store when inside context', async () => {
      const clinicId = new mongoose.Types.ObjectId();
      await runWithTenantContext({ clinicId, actor: { type: 'USER', id: 'u1' } }, () => {
        const ctx = requireTenantContext();
        expect(ctx.clinicId).toBe(clinicId);
      });
    });
  });

  describe('Password Primitives (passwords.ts)', () => {
    it('validates common passwords and strength', async () => {
      expect(validatePasswordStrength('password123456').valid).toBe(false);
      expect(validatePasswordStrength('drsusheel123').valid).toBe(false);
      expect(validatePasswordStrength('').valid).toBe(false);

      await expect(hashPassword('short')).rejects.toThrow(/at least 12 characters/);
      await expect(hashKioskPin('12')).rejects.toThrow(/between 4 and 10 digits/);
      await expect(hashKioskPin('1234567890123')).rejects.toThrow(/between 4 and 10 digits/);

      const pinHash = await hashKioskPin('1234');
      expect(await verifyPassword(pinHash, '1234')).toBe(true);
      expect(await verifyPassword(pinHash, '0000')).toBe(false);
      expect(await verifyPassword('malformed-hash', '1234')).toBe(false);

      expect(await dummyVerify('RandomWrongPassword123!')).toBe(false);
      expect(hashToken('test-token')).toHaveLength(64);
    });
  });

  describe('TOTP Primitives (totp.ts)', () => {
    it('generates secret, URI, setup and validates codes', async () => {
      const secret = generateTOTPSecret();
      expect(secret).toBeDefined();

      const uri = getTOTPUrl('doc@clinic.com', secret);
      expect(uri).toContain('otpauth://totp/');

      const setup = await generateTOTPSetup('doc@clinic.com');
      expect(setup.qrCodeDataUrl).toContain('data:image/svg+xml;base64,');

      const code = generateTOTPCode(secret);
      expect(verifyTOTPCode(code, secret)).toBe(true);
      expect(verifyTOTPCode('invalid', secret)).toBe(false);
    });
  });

  describe('QR Code Generation (qr.ts)', () => {
    it('generates valid SVG and data URLs across small and medium inputs', () => {
      const svg1 = generateQRCodeSVG('test');
      expect(svg1).toContain('<svg');
      expect(svg1).toContain('</svg>');

      const dataUrl = generateQRCodeDataURL('otpauth://totp/Test:user@example.com?secret=JBSWY3DPEHPK3PXP');
      expect(dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
    });
  });

  describe('CSRF Validation (csrf.ts)', () => {
    it('handles referer fallback and invalid URLs', () => {
      // Missing Origin, Referer matching host
      const req1 = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: {
          referer: 'http://localhost:3000/settings/security',
          host: 'localhost:3000',
        },
      });
      expect(verifyCsrf(req1).valid).toBe(true);

      // Referer cross-site mismatch
      const req2 = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: {
          referer: 'https://malicious.com/attack',
          host: 'localhost:3000',
        },
      });
      expect(verifyCsrf(req2).valid).toBe(false);

      // Malformed Origin
      const req3 = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'not-a-valid-url' },
      });
      expect(verifyCsrf(req3).valid).toBe(false);

      // Malformed Referer
      const req4 = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: { referer: 'not-a-valid-url', host: 'localhost:3000' },
      });
      expect(verifyCsrf(req4).valid).toBe(false);
    });
  });

  describe('Auth Wrappers & Cookie Names (auth.ts)', () => {
    it('returns production or development cookie names depending on NODE_ENV', () => {
      const originalNodeEnv = env.NODE_ENV;

      (env as any).NODE_ENV = 'production';
      expect(getSessionCookieName()).toBe(SESSION_COOKIE_NAME);
      expect(getKioskCookieName()).toBe(KIOSK_COOKIE_NAME);

      (env as any).NODE_ENV = 'development';
      expect(getSessionCookieName()).toBe(DEV_SESSION_COOKIE_NAME);
      expect(getKioskCookieName()).toBe(DEV_KIOSK_COOKIE_NAME);

      (env as any).NODE_ENV = originalNodeEnv;
    });

    it('handles withAuth error propagation, CSRF, and role mismatch', async () => {
      const { createSession } = await import('@/lib/auth');
      const { User } = await import('@/models/User');
      const { hashPassword } = await import('@/lib/passwords');
      const clinicId = new mongoose.Types.ObjectId();

      const user = await systemScope(clinicId, async () => {
        return User.create({
          clinicId,
          name: 'Dr. Coverage',
          email: 'dr.coverage@clinic.com',
          passwordHash: await hashPassword('CoverPassword1234'),
          role: 'DOCTOR',
          createdBy: { type: 'SYSTEM', id: 'test' },
        });
      });

      const { token } = await createSession(user._id, clinicId);

      // 1. Role mismatch (user is DOCTOR, route requires ADMIN) -> 403
      const doctorHandler = withAuth(async () => NextResponse.json({ ok: true }), { roles: ['ADMIN'] });
      const reqRole = new NextRequest('http://localhost:3000/api/doctor-only');
      reqRole.cookies.set(DEV_SESSION_COOKIE_NAME, token);
      const resRole = await doctorHandler(reqRole);
      expect(resRole.status).toBe(403);

      // 2. CSRF rejection on state-changing route -> 403
      const reqCsrf = new NextRequest('http://localhost:3000/api/protected', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      reqCsrf.cookies.set(DEV_SESSION_COOKIE_NAME, token);
      const resCsrf = await doctorHandler(reqCsrf);
      expect(resCsrf.status).toBe(403);

      // 3. Exception in handler -> 500 catch block
      const failingHandler = withAuth(async () => {
        throw new Error('Explosion');
      });
      const reqThrow = new NextRequest('http://localhost:3000/api/protected');
      reqThrow.cookies.set(DEV_SESSION_COOKIE_NAME, token);
      const resThrow = await failingHandler(reqThrow);
      expect(resThrow.status).toBe(500);

      // 4. Request without session -> 401
      const reqNoSession = new NextRequest('http://localhost:3000/api/protected');
      const res1 = await failingHandler(reqNoSession);
      expect(res1.status).toBe(401);

      // 5. Invalid session token -> 401
      const reqInvalidSession = new NextRequest('http://localhost:3000/api/protected');
      reqInvalidSession.cookies.set(SESSION_COOKIE_NAME, 'nonexistent-session-token');
      const resInvalid = await doctorHandler(reqInvalidSession);
      expect(resInvalid.status).toBe(401);

      // 6. Production session cookie name matching -> 200
      const okHandler = withAuth(async () => NextResponse.json({ ok: true }));
      const reqProdCookie = new NextRequest('http://localhost:3000/api/protected');
      reqProdCookie.cookies.set(SESSION_COOKIE_NAME, token);
      const resProd = await okHandler(reqProdCookie);
      expect(resProd.status).toBe(200);
    });

    it('handles withKiosk CSRF rejection and error propagation', async () => {
      const { unlockKiosk } = await import('@/lib/auth');
      const { Clinic } = await import('@/models/Clinic');
      const { hashKioskPin } = await import('@/lib/passwords');

      const clinic = await Clinic.create({
        name: 'Cover Clinic',
        address: 'Chhatrapati Sambhajinagar',
        phone: '9822000000',
        email: 'cover@clinic.com',
        registrationNo: 'REG-COVER',
        timezone: 'Asia/Kolkata',
        paperSize: 'A5',
        kioskPinHash: await hashKioskPin('4321'),
        createdBy: { type: 'SYSTEM', id: 'test' },
      });

      const { token } = await unlockKiosk(clinic._id, '4321');

      // 1. CSRF rejection on state-changing route -> 403
      const kioskHandler = withKiosk(async () => NextResponse.json({ ok: true }));
      const reqCsrf = new NextRequest('http://localhost:3000/api/kiosk-action', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      reqCsrf.cookies.set(DEV_KIOSK_COOKIE_NAME, token);
      const resCsrf = await kioskHandler(reqCsrf);
      expect(resCsrf.status).toBe(403);

      // 2. Exception in handler -> 500 catch block
      const failingKiosk = withKiosk(async () => {
        throw new Error('Kiosk Explosion');
      });
      const reqThrow = new NextRequest('http://localhost:3000/api/kiosk-action');
      reqThrow.cookies.set(DEV_KIOSK_COOKIE_NAME, token);
      const resThrow = await failingKiosk(reqThrow);
      expect(resThrow.status).toBe(500);

      // 3. Request without kiosk cookie -> 401
      const reqNoCookie = new NextRequest('http://localhost:3000/api/kiosk-protected');
      const resNoCookie = await failingKiosk(reqNoCookie);
      expect(resNoCookie.status).toBe(401);

      // 4. Invalid kiosk cookie token -> 401
      const reqInvalidKiosk = new NextRequest('http://localhost:3000/api/kiosk-action');
      reqInvalidKiosk.cookies.set(KIOSK_COOKIE_NAME, 'nonexistent-kiosk-token');
      const resInvalidKiosk = await kioskHandler(reqInvalidKiosk);
      expect(resInvalidKiosk.status).toBe(401);

      // 5. Production kiosk cookie name matching -> 200
      const reqProdKiosk = new NextRequest('http://localhost:3000/api/kiosk-action');
      reqProdKiosk.cookies.set(KIOSK_COOKIE_NAME, token);
      const resProdKiosk = await kioskHandler(reqProdKiosk);
      expect(resProdKiosk.status).toBe(200);
    });

    it('handles publicRoute CSRF and error propagation', async () => {
      const failingPublic = publicRoute(async () => {
        throw new Error('Public Explosion');
      });

      // CSRF check
      const reqCsrf = new NextRequest('http://localhost:3000/api/public', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      const resCsrf = await failingPublic(reqCsrf);
      expect(resCsrf.status).toBe(403);

      // Internal error
      const req = new NextRequest('http://localhost:3000/api/public');
      const res = await failingPublic(req);
      expect(res.status).toBe(500);
    });

    it('returns null when validateSession encounters nonexistent user', async () => {
      const { createSession } = await import('@/lib/auth');
      const clinicId = new mongoose.Types.ObjectId();
      const ghostUserId = new mongoose.Types.ObjectId();

      const { token } = await createSession(ghostUserId, clinicId);
      const res = await validateSession(token);
      expect(res).toBeNull();
    });

    it('returns null for empty tokens in validateSession and validateKioskToken', async () => {
      expect(await validateSession('')).toBeNull();
      expect(await validateKioskToken('')).toBeNull();
    });

    it('handles unlockKiosk edge cases (invalid clinic, invalid pin, rate limiting)', async () => {
      const { Clinic } = await import('@/models/Clinic');
      const { hashKioskPin } = await import('@/lib/passwords');

      const nonExistentClinicId = new mongoose.Types.ObjectId();
      await expect(unlockKiosk(nonExistentClinicId, '1234', '10.0.0.1')).rejects.toThrow(/Clinic not found/);

      const clinic = await Clinic.create({
        name: 'Kiosk Pin Test Clinic',
        address: 'Chhatrapati Sambhajinagar',
        phone: '9822000000',
        email: 'pin@clinic.com',
        registrationNo: 'REG-PIN',
        timezone: 'Asia/Kolkata',
        paperSize: 'A5',
        kioskPinHash: await hashKioskPin('1234'),
        createdBy: { type: 'SYSTEM', id: 'test' },
      });

      // Wrong PIN
      await expect(unlockKiosk(clinic._id, '9999', '10.0.0.2')).rejects.toThrow(/Invalid kiosk PIN/);

      // Rate limit lockout
      const testIp = '10.99.99.99';
      for (let i = 0; i < 5; i++) {
        await expect(unlockKiosk(clinic._id, '9999', testIp)).rejects.toThrow(/Invalid kiosk PIN/);
      }
      // 6th attempt is rate-limited
      await expect(unlockKiosk(clinic._id, '1234', testIp)).rejects.toThrow(/Too many unlock attempts/);
    });
  });
});
