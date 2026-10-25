import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestReplSet, teardownTestReplSet } from './test-db-helper';
import { KIOSK_COOKIE_NAME, DEV_KIOSK_COOKIE_NAME } from '@/lib/auth';
import { GET as getTreatments } from '@/app/api/treatments/route';
import { GET as getEstimates, POST as postEstimates } from '@/app/api/estimates/route';
import { GET as getBills, POST as postBills } from '@/app/api/bills/route';
import { POST as reversePaymentRoute } from '@/app/api/payments/[paymentId]/reverse/route';

describe('D16: Authorization & Route Security Matrix for Phase 4 Routes', () => {
  beforeAll(async () => {
    await setupTestReplSet();
  });

  afterAll(async () => {
    await teardownTestReplSet();
  });

  it('unauthenticated requests without cookies return 401 Unauthorized', async () => {
    // 1. /api/treatments
    const res1 = await getTreatments(new NextRequest('http://localhost:3000/api/treatments'));
    expect(res1.status).toBe(401);

    // 2. /api/estimates (GET & POST)
    const res2 = await getEstimates(new NextRequest('http://localhost:3000/api/estimates'));
    expect(res2.status).toBe(401);

    const res3 = await postEstimates(
      new NextRequest('http://localhost:3000/api/estimates', {
        method: 'POST',
        body: JSON.stringify({ patientId: 'dummy' }),
      })
    );
    expect(res3.status).toBe(401);

    // 3. /api/bills (GET & POST)
    const res4 = await getBills(new NextRequest('http://localhost:3000/api/bills'));
    expect(res4.status).toBe(401);

    const res5 = await postBills(
      new NextRequest('http://localhost:3000/api/bills', {
        method: 'POST',
        body: JSON.stringify({ patientId: 'dummy' }),
      })
    );
    expect(res5.status).toBe(401);

    // 4. /api/payments/[id]/reverse
    const res6 = await reversePaymentRoute(
      new NextRequest('http://localhost:3000/api/payments/123/reverse', {
        method: 'POST',
        body: JSON.stringify({ reason: 'test' }),
      }),
      { params: Promise.resolve({ paymentId: '123' }) } as any
    );
    expect(res6.status).toBe(401);
  });

  it('kiosk-only authenticated requests return 401 Unauthorized on all billing routes', async () => {
    const kioskHeaders = {
      cookie: `${KIOSK_COOKIE_NAME}=kiosk_dummy; ${DEV_KIOSK_COOKIE_NAME}=kiosk_dummy`,
    };

    const res1 = await getTreatments(
      new NextRequest('http://localhost:3000/api/treatments', { headers: kioskHeaders })
    );
    expect(res1.status).toBe(401);

    const res2 = await getEstimates(
      new NextRequest('http://localhost:3000/api/estimates', { headers: kioskHeaders })
    );
    expect(res2.status).toBe(401);

    const res3 = await getBills(
      new NextRequest('http://localhost:3000/api/bills', { headers: kioskHeaders })
    );
    expect(res3.status).toBe(401);

    const res4 = await reversePaymentRoute(
      new NextRequest('http://localhost:3000/api/payments/123/reverse', {
        method: 'POST',
        headers: kioskHeaders,
        body: JSON.stringify({ reason: 'test' }),
      }),
      { params: Promise.resolve({ paymentId: '123' }) } as any
    );
    expect(res4.status).toBe(401);
  });
});
