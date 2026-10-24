import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { publicRoute, createSession, getSessionCookieName } from '@/lib/auth';
import { User } from '@/models/User';
import { verifyPassword, dummyVerify } from '@/lib/passwords';
import { RateLimitRules } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { AuditAction } from '@/models/AuditLog';
import { assertPlainInput } from '@/lib/validation';
import { env } from '@/lib/env';
import { connectDb } from '@/lib/db';
import { clock } from '@/lib/clock';

const LoginSchema = z
  .object({
    email: z.string().email().toLowerCase().trim(),
    password: z.string().min(1, 'Password is required'),
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

  const parseResult = LoginSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
  }

  const { email, password } = parseResult.data;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  // Rate limit checks
  const emailLimit = await RateLimitRules.loginEmailFailure(email);
  const ipLimit = await RateLimitRules.loginIpFailure(ip);

  if (!emailLimit.allowed || !ipLimit.allowed) {
    const retryAfter = Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
    return NextResponse.json(
      { error: 'Too many failed login attempts. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
        },
      }
    );
  }

  // Find user across system scope for initial login
  const user = await User.findOne({ email });

  if (!user) {
    // Constant-time execution to prevent email enumeration
    await dummyVerify(password);

    return NextResponse.json(
      { error: 'Invalid email or password' },
      { status: 401 }
    );
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);
  if (!passwordValid) {
    await audit.record({
      clinicId: user.clinicId,
      action: AuditAction.AUTH_FAIL,
      entity: 'User',
      entityId: user._id.toString(),
      actor: { type: 'USER', id: user._id.toString() },
      ip,
      userAgent,
      meta: { reasonCode: 'BAD_PASSWORD' },
    });

    return NextResponse.json(
      { error: 'Invalid email or password' },
      { status: 401 }
    );
  }

  // If 2FA is enabled, do not issue session yet
  if (user.totpEnabled) {
    return NextResponse.json({
      requires2FA: true,
      email: user.email,
    });
  }

  // Issue session
  const { token } = await createSession(user._id, user.clinicId, ip, userAgent);

  user.lastLoginAt = clock.now();
  await user.save();

  await audit.record({
    clinicId: user.clinicId,
    action: AuditAction.AUTH_LOGIN,
    entity: 'User',
    entityId: user._id.toString(),
    actor: { type: 'USER', id: user._id.toString() },
    ip,
    userAgent,
  });

  const response = NextResponse.json({
    success: true,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });

  const isProd = env.NODE_ENV === 'production';
  response.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_ABSOLUTE_HOURS * 3600,
  });

  return response;
});
