import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { publicRoute } from '@/lib/auth';
import { verifyIntegrationHmac, IntegrationAuthError } from '@/lib/hmac';
import { assertPlainInput } from '@/lib/validation';
import { createAppointment, SlotConflictError } from '@/lib/appointment-service';
import { runWithTenantContext } from '@/lib/tenancy';
import { connectDb } from '@/lib/db';
import { RateLimitRules } from '@/lib/rate-limit';

const IntegrationCreateSchema = z
  .object({
    externalId: z.string().trim().min(1, 'externalId is required').max(100),
    source: z.enum(['WEBSITE', 'WHATSAPP']),
    name: z.string().trim().min(1, 'name is required').max(100),
    phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number'),
    start: z.string().datetime({ message: 'start must be a valid ISO instant' }),
    reason: z.string().trim().max(500).optional(),
    treatmentCode: z.string().trim().max(50).optional(),
    language: z.enum(['en', 'hi', 'mr']).optional(),
  })
  .strict();

export const POST = publicRoute(async (req: NextRequest) => {
  await connectDb();

  const url = new URL(req.url);
  const pathAndQuery = url.pathname + url.search;
  const rawBody = await req.text();

  // 1. Verify HMAC
  let context;
  try {
    context = await verifyIntegrationHmac(req.headers, req.method, pathAndQuery, rawBody);
  } catch (err: any) {
    if (err instanceof IntegrationAuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { clinicId, keyId } = context;
  const actor = { type: 'INTEGRATION' as const, id: keyId };

  // 2. Rate limiting per key id & IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const rateLimit = await RateLimitRules.checkIntegrationKey(keyId, ip);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }

  // 3. Parse JSON & check for operator injection
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

  // 4. Validate with strict schema
  const parsed = IntegrationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation Error', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // 5. Create Appointment within tenant scope
  try {
    return await runWithTenantContext({ clinicId, actor }, async () => {
      const res = await createAppointment(
        clinicId,
        {
          contactName: data.name,
          contactPhone: data.phone,
          start: new Date(data.start),
          reason: data.reason || 'Consultation',
          treatmentCode: data.treatmentCode,
          source: data.source,
          externalId: data.externalId,
        },
        actor
      );

      if (res.isExisting) {
        return NextResponse.json(res.appointment, { status: 200 });
      }

      return NextResponse.json(res.appointment, { status: 201 });
    });
  } catch (err: any) {
    if (err instanceof SlotConflictError || err.code === 'SLOT_TAKEN') {
      return NextResponse.json({ error: err.message, code: 'SLOT_TAKEN' }, { status: 409 });
    }
    if (err.code === 'CONFLICT_PAYLOAD_MISMATCH' || err.statusCode === 409) {
      return NextResponse.json({ error: err.message, code: 'EXTERNAL_ID_CONFLICT' }, { status: 409 });
    }
    if (err.statusCode === 422) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
