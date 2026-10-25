import { NextRequest, NextResponse } from 'next/server';
import { publicRoute } from '@/lib/auth';
import { verifyIntegrationHmac, IntegrationAuthError } from '@/lib/hmac';
import { getBusyIntervals } from '@/lib/appointment-service';
import { runWithTenantContext } from '@/lib/tenancy';
import { connectDb } from '@/lib/db';
import { RateLimitRules } from '@/lib/rate-limit';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { clock } from '@/lib/clock';

export const GET = publicRoute(async (req: NextRequest) => {
  await connectDb();

  const url = new URL(req.url);
  const pathAndQuery = url.pathname + url.search;

  // 1. Verify HMAC with empty body for GET
  let authContext;
  try {
    authContext = await verifyIntegrationHmac(req.headers, req.method, pathAndQuery, '');
  } catch (err: any) {
    if (err instanceof IntegrationAuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { clinicId, keyId } = authContext;
  const actor = { type: 'INTEGRATION' as const, id: keyId };

  // 2. Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const rateLimit = await RateLimitRules.checkIntegrationKey(keyId, ip);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }

  // 3. Extract and validate from & to
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  if (!fromParam || !toParam) {
    return NextResponse.json({ error: 'Both from and to query parameters are required (ISO strings)' }, { status: 400 });
  }

  const fromDate = new Date(fromParam);
  const toDate = new Date(toParam);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: 'Invalid from or to date format' }, { status: 400 });
  }

  try {
    return await runWithTenantContext({ clinicId, actor }, async () => {
      const intervals = await getBusyIntervals(clinicId, fromDate, toDate);

      // Audit log: ids only, no PII
      await AuditLog.create({
        clinicId,
        action: AuditAction.INTEGRATION_BUSY_READ,
        entity: 'Appointment',
        entityId: 'busy',
        actor,
        meta: { from: fromParam, to: toParam, count: intervals.length },
        at: clock.now(),
        createdBy: actor,
      });

      return NextResponse.json({ intervals, busy: intervals }, { status: 200 });
    });
  } catch (err: any) {
    if (err.statusCode === 400) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
