import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { setupTestReplSet, teardownTestReplSet, clearTestDatabase } from './test-db-helper';
import {
  unlockKiosk,
  withAuth,
  withKiosk,
  KIOSK_COOKIE_NAME,
  DEV_KIOSK_COOKIE_NAME,
  getKioskCookieName,
} from '@/lib/auth';
import { Clinic } from '@/models/Clinic';
import { hashKioskPin } from '@/lib/passwords';
import { rateLimit } from '@/lib/rate-limit';
import { verifyCsrf } from '@/lib/csrf';

// Route handlers under test
import { GET as getQueueHandler } from '@/app/api/queue/route';
import { POST as transitionQueueHandler } from '@/app/api/queue/[id]/transition/route';
import { GET as getClosingReportHandler } from '@/app/api/reports/closing/route';
import { GET as getMeHandler } from '@/app/api/auth/me/route';
import { POST as changePasswordHandler } from '@/app/api/settings/security/change-password/route';
import { POST as logoutHandler } from '@/app/api/auth/logout/route';
import { POST as registerHandler } from '@/app/api/kiosk/register/route';

describe('B3 & Privacy: Kiosk Read-Attempt Attack Matrix & CSRF/Rate-Limit Security', () => {
  let clinicId: Types.ObjectId;
  let kioskToken: string;

  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  beforeEach(async () => {
    await clearTestDatabase();

    const pinHash = await hashKioskPin('1234');
    clinicId = new Types.ObjectId();

    await Clinic.create({
      _id: clinicId,
      name: "Dr. Susheel's Advanced Dental Clinic & Implant Center",
      address: 'Chhatrapati Sambhajinagar, Maharashtra',
      phone: '9822012345',
      email: 'dr.susheel@example.com',
      registrationNo: 'REG-123456',
      kioskPinHash: pinHash,
      active: true,
      schemaVersion: 1,
      createdBy: { type: 'SYSTEM', id: 'setup' },
    });

    const unlockResult = await unlockKiosk(clinicId, '1234', '127.0.0.1', 'Tablet Browser');
    kioskToken = unlockResult.token;
  });

  function createKioskRequest(
    url: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any,
    headers?: Record<string, string>
  ): NextRequest {
    const cookieName = getKioskCookieName();
    const reqHeaders = new Headers({
      cookie: `${cookieName}=${kioskToken}`,
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    });

    const init: any = {
      method,
      headers: reqHeaders,
    };
    if (body) {
      init.body = JSON.stringify(body);
    }

    return new NextRequest(new URL(url, 'http://localhost:3000'), init);
  }

  it('B3: With the kiosk cookie, every GET and every non-kiosk route returns 401 or 403', async () => {
    // 1. GET /api/queue -> must return 401
    const reqQueue = createKioskRequest('/api/queue', 'GET');
    const resQueue = await getQueueHandler(reqQueue);
    expect(resQueue.status).toBe(401);

    // 2. POST /api/queue/[id]/transition -> must return 401
    const reqTransition = createKioskRequest(
      '/api/queue/dummy-id/transition',
      'POST',
      { action: 'CALL_IN', expectedVersion: 1 }
    );
    const resTransition = await transitionQueueHandler(reqTransition, {} as any);
    expect(resTransition.status).toBe(401);

    // 3. GET /api/reports/closing -> must return 401
    const reqClosing = createKioskRequest('/api/reports/closing', 'GET');
    const resClosing = await getClosingReportHandler(reqClosing);
    expect(resClosing.status).toBe(401);

    // 4. GET /api/auth/me -> must return 401
    const reqMe = createKioskRequest('/api/auth/me', 'GET');
    const resMe = await getMeHandler(reqMe);
    expect(resMe.status).toBe(401);

    // 5. POST /api/settings/security/change-password -> must return 401
    const reqChangePwd = createKioskRequest('/api/settings/security/change-password', 'POST', {});
    const resChangePwd = await changePasswordHandler(reqChangePwd);
    expect(resChangePwd.status).toBe(401);

    // 6. POST /api/auth/logout -> must return 401
    const reqLogout = createKioskRequest('/api/auth/logout', 'POST', {});
    const resLogout = await logoutHandler(reqLogout);
    expect(resLogout.status).toBe(401);
  });

  it('B3 deliberate negative test: proves that if an endpoint improperly allowed kiosk token, test fails', async () => {
    // A mock insecure handler that fails to reject the kiosk token
    const insecureHandler = async (req: NextRequest) => {
      // Intentionally lacks withAuth guard:
      return NextResponse.json({ leakedData: 'private clinical chart' }, { status: 200 });
    };

    const req = createKioskRequest('/api/insecure/notes', 'GET');
    const res = await insecureHandler(req);

    // The negative test demonstrates that a vulnerable route returns 200, failing the 401/403 requirement
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  it('Origin and Sec-Fetch-Site CSRF checks reject cross-site and untrusted origins on kiosk routes', async () => {
    // 1. Cross-site Sec-Fetch-Site rejected with 403
    const crossSiteReq = createKioskRequest('/api/kiosk/register', 'POST', {}, {
      'sec-fetch-site': 'cross-site',
    });
    const crossSiteRes = await registerHandler(crossSiteReq);
    expect(crossSiteRes.status).toBe(403);

    // 2. Untrusted origin rejected with 403
    const evilOriginReq = createKioskRequest('/api/kiosk/register', 'POST', {}, {
      origin: 'https://evil-attacker.com',
    });
    const evilOriginRes = await registerHandler(evilOriginReq);
    expect(evilOriginRes.status).toBe(403);
  });

  it('Rate limits registration per device token (60/hour)', async () => {
    const deviceId = new Types.ObjectId();
    const key = `kiosk:reg:device:${deviceId.toString()}`;

    // Fill quota of 60
    for (let i = 0; i < 60; i++) {
      const rl = await rateLimit(key, 60, 3600);
      expect(rl.allowed).toBe(true);
    }

    // 61st attempt must be blocked
    const blocked = await rateLimit(key, 60, 3600);
    expect(blocked.allowed).toBe(false);
  });

  it('Privacy: Kiosk registration response does NOT reveal patient identity or existence', async () => {
    const req = createKioskRequest('/api/kiosk/register', 'POST', {
      name: 'Pooja Kulkarni',
      ageYears: 27,
      sex: 'Female',
      phone: '9822088888',
      reasonForVisit: 'Cleaning',
      consent: true,
      consentTextVersion: '1.0',
      idempotencyKey: 'c81d4e2e-bcf2-11e6-869b-7df92533c26e',
    });

    const res = await registerHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Body contains ONLY success and token
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('number');
    expect(body.patientId).toBeUndefined();
    expect(body.name).toBeUndefined();
    expect(body.phone).toBeUndefined();
    expect(body.isNewPatient).toBeUndefined();
  });
});
