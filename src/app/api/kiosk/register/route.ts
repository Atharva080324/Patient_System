import { NextRequest, NextResponse } from 'next/server';
import { withKiosk } from '@/lib/auth';
import { verifyCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { registerWalkInPatient } from '@/lib/registration-service';
import { assertPlainInput } from '@/lib/validation';

export const POST = withKiosk(async (req: NextRequest, device) => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';

  // Rate limits: 60 registrations/hour per device and per IP
  const rlDevice = await rateLimit(
    `kiosk:reg:device:${device._id.toString()}`,
    60,
    3600
  );
  if (!rlDevice.allowed) {
    return NextResponse.json(
      { error: 'Registration rate limit exceeded for device. Try again later.' },
      { status: 429 }
    );
  }

  const rlIp = await rateLimit(
    `kiosk:reg:ip:${ip}`,
    60,
    3600
  );
  if (!rlIp.allowed) {
    return NextResponse.json(
      { error: 'Registration rate limit exceeded for IP. Try again later.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    assertPlainInput(body);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  try {
    const result = await registerWalkInPatient(
      device.clinicId,
      device._id.toString(),
      body
    );

    return NextResponse.json({
      success: true,
      token: result.token,
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Validation failed', details: err.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err?.message || 'Failed to register patient' },
      { status: 400 }
    );
  }
});
