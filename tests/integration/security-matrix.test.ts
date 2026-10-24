import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import {
  withAuth,
  withKiosk,
  publicRoute,
  createSession,
  unlockKiosk,
  SESSION_COOKIE_NAME,
  KIOSK_COOKIE_NAME,
  DEV_SESSION_COOKIE_NAME,
  DEV_KIOSK_COOKIE_NAME,
} from '@/lib/auth';
import { setupTestReplSet, teardownTestReplSet } from './test-db-helper';
import { systemScope } from '@/lib/tenancy';
import { User } from '@/models/User';
import { Clinic } from '@/models/Clinic';
import { hashKioskPin } from '@/lib/passwords';

describe('A7: Security Authorization Matrix & Cookie Protection', () => {
  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  const dummyProtectedHandler = withAuth(async () => {
    return NextResponse.json({ success: true, secretData: 'clinical_notes' });
  });

  const dummyKioskHandler = withKiosk(async () => {
    return NextResponse.json({ success: true, kioskIntake: true });
  });

  it('unauthenticated requests without cookies return 401 Unauthorized', async () => {
    const req = new NextRequest('http://localhost:3000/api/protected/dummy');
    const res = await dummyProtectedHandler(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Unauthorized');
  });

  it('requests presenting ONLY a kiosk cookie are strictly rejected on withAuth routes', async () => {
    const req = new NextRequest('http://localhost:3000/api/protected/dummy', {
      headers: {
        cookie: `${KIOSK_COOKIE_NAME}=kiosk_device_token_xyz; ${DEV_KIOSK_COOKIE_NAME}=kiosk_device_token_xyz`,
      },
    });

    const res = await dummyProtectedHandler(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Unauthorized');
  });

  it('requests presenting ONLY a doctor session cookie are rejected on withKiosk routes', async () => {
    const req = new NextRequest('http://localhost:3000/api/kiosk/dummy', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=doctor_session_token_xyz; ${DEV_SESSION_COOKIE_NAME}=doctor_session_token_xyz`,
      },
    });

    const res = await dummyKioskHandler(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Unauthorized: kiosk session required');
  });

  it('allows authenticated doctor session on withAuth and enforces role checks', async () => {
    const clinicId = new Types.ObjectId();
    const user = await systemScope(clinicId, async () => {
      return User.create({
        clinicId,
        name: 'Dr. Role Test',
        email: 'dr.role@clinic.com',
        passwordHash: 'dummy_hash_1234567890',
        role: 'DOCTOR',
        totpEnabled: false,
        createdBy: { type: 'SYSTEM', id: 'test' },
      });
    });

    const { token } = await createSession(user._id, clinicId);

    // 1. Successful access to standard withAuth route
    const req = new NextRequest('http://localhost:3000/api/protected/dummy', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    const res = await dummyProtectedHandler(req);
    expect(res.status).toBe(200);
    const resBody = await res.json();
    expect(resBody.success).toBe(true);

    // 2. Role restriction check: route requiring ADMIN role rejects DOCTOR with 403
    const adminOnlyHandler = withAuth(async () => {
      return NextResponse.json({ success: true, privileged: true });
    }, { roles: ['ADMIN' as any] });

    const forbiddenRes = await adminOnlyHandler(req);
    expect(forbiddenRes.status).toBe(403);
    const forbiddenBody = await forbiddenRes.json();
    expect(forbiddenBody.error).toContain('Forbidden');
  });

  it('allows valid kiosk device token on withKiosk and rejects invalid token', async () => {
    const clinicId = new Types.ObjectId();
    const pinHash = await hashKioskPin('5555');
    await Clinic.create({
      _id: clinicId,
      name: 'Kiosk Matrix Clinic',
      address: 'Sambhajinagar',
      phone: '9822000000',
      email: 'matrix@clinic.com',
      registrationNo: 'REG-MATRIX',
      timezone: 'Asia/Kolkata',
      paperSize: 'A5',
      kioskPinHash: pinHash,
      createdBy: { type: 'SYSTEM', id: 'test' },
    });

    const { token } = await unlockKiosk(clinicId, '5555');

    // 1. Valid kiosk token accesses withKiosk route
    const req = new NextRequest('http://localhost:3000/api/kiosk/dummy', {
      headers: {
        cookie: `${KIOSK_COOKIE_NAME}=${token}`,
      },
    });
    const res = await dummyKioskHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kioskIntake).toBe(true);

    // 2. Invalid kiosk token returns 401
    const badReq = new NextRequest('http://localhost:3000/api/kiosk/dummy', {
      headers: {
        cookie: `${KIOSK_COOKIE_NAME}=bad_invalid_kiosk_token`,
      },
    });
    const badRes = await dummyKioskHandler(badReq);
    expect(badRes.status).toBe(401);
  });

  it('publicRoute executes without authentication', async () => {
    const publicHandler = publicRoute(async () => {
      return NextResponse.json({ public: true });
    });

    const req = new NextRequest('http://localhost:3000/api/public/dummy');
    const res = await publicHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.public).toBe(true);
  });
});
