import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { publicRoute, unlockKiosk, getKioskCookieName } from '@/lib/auth';
import { Clinic } from '@/models/Clinic';
import { assertPlainInput } from '@/lib/validation';
import { connectDb } from '@/lib/db';
import { env } from '@/lib/env';
import { verifyCsrf } from '@/lib/csrf';

const KioskUnlockSchema = z
  .object({
    pin: z.string().min(4).max(10),
  })
  .strict();

export const POST = publicRoute(async (req: NextRequest) => {
  await connectDb();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  try {
    assertPlainInput(body);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const parseResult = KioskUnlockSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
  }

  const { pin } = parseResult.data;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  const clinic = await Clinic.findOne();
  if (!clinic) {
    return NextResponse.json({ error: 'Clinic not configured' }, { status: 500 });
  }

  try {
    const { token, expiresAt } = await unlockKiosk(clinic._id, pin, ip, userAgent);

    const response = NextResponse.json({
      success: true,
      expiresAt: expiresAt.toISOString(),
    });

    const isProd = env.NODE_ENV === 'production';
    response.cookies.set(getKioskCookieName(), token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/',
      maxAge: 12 * 3600,
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
});
