import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { publicRoute, RouteContext } from '@/lib/auth';
import { verifyIntegrationHmac, IntegrationAuthError } from '@/lib/hmac';
import { assertPlainInput } from '@/lib/validation';
import {
  rescheduleAppointment,
  cancelAppointment,
  SlotConflictError,
} from '@/lib/appointment-service';
import { Appointment } from '@/models/Appointment';
import { runWithTenantContext } from '@/lib/tenancy';
import { connectDb } from '@/lib/db';
import { RateLimitRules } from '@/lib/rate-limit';

const IntegrationPatchSchema = z
  .object({
    action: z.enum(['RESCHEDULE', 'CANCEL']),
    start: z.string().datetime({ message: 'start must be a valid ISO instant' }).optional(),
    version: z.number().int().min(1, 'version must be at least 1').optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const PATCH = publicRoute(async (req: NextRequest, context?: RouteContext) => {
  await connectDb();

  const url = new URL(req.url);
  const pathAndQuery = url.pathname + url.search;
  const rawBody = await req.text();

  // 1. Verify HMAC
  let authContext;
  try {
    authContext = await verifyIntegrationHmac(req.headers, req.method, pathAndQuery, rawBody);
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

  // 3. Resolve params
  const resolvedParams = context?.params ? await context.params : undefined;
  const externalId = resolvedParams?.externalId;
  if (!externalId) {
    return NextResponse.json({ error: 'Missing externalId route parameter' }, { status: 400 });
  }

  // 4. Parse & validate body
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  try {
    assertPlainInput(body);
  } catch {
    return NextResponse.json({ error: 'Invalid payload keys' }, { status: 400 });
  }

  const parsed = IntegrationPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation Error', details: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;

  try {
    return await runWithTenantContext({ clinicId, actor }, async () => {
      const appointment = await Appointment.findOne({
        clinicId,
        externalId,
        deletedAt: null,
      });

      if (!appointment) {
        return NextResponse.json({ error: `Appointment not found for externalId: ${externalId}` }, { status: 404 });
      }

      if (data.action === 'CANCEL') {
        const cancelled = await cancelAppointment(
          clinicId,
          appointment._id,
          data.reason || 'Cancelled via integration',
          actor,
          true
        );
        return NextResponse.json(cancelled, { status: 200 });
      }

      if (data.action === 'RESCHEDULE') {
        if (!data.start) {
          return NextResponse.json({ error: 'start is required for RESCHEDULE action' }, { status: 400 });
        }
        if (data.version === undefined) {
          return NextResponse.json({ error: 'version is required for RESCHEDULE action' }, { status: 400 });
        }

        const rescheduled = await rescheduleAppointment(
          clinicId,
          appointment._id,
          {
            start: new Date(data.start),
            version: data.version,
          },
          actor,
          true
        );
        return NextResponse.json(rescheduled, { status: 200 });
      }

      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    });
  } catch (err: any) {
    if (err instanceof SlotConflictError || err.code === 'SLOT_TAKEN') {
      return NextResponse.json({ error: err.message, code: 'SLOT_TAKEN' }, { status: 409 });
    }
    if (err.statusCode === 409) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err.statusCode === 422) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
