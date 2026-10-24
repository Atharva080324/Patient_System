import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { publicRoute, rotateSession, getSessionCookieName } from '@/lib/auth';
import { User } from '@/models/User';
import { verifyTOTPCode } from '@/lib/totp';
import { hashToken } from '@/lib/passwords';
import { RateLimitRules, rateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { AuditAction } from '@/models/AuditLog';
import { assertPlainInput } from '@/lib/validation';
import { env } from '@/lib/env';
import { connectDb } from '@/lib/db';
import { clock } from '@/lib/clock';
import { systemAdminScope } from '@/lib/tenancy';

const Login2FASchema = z
  .object({
    email: z.string().email().toLowerCase().trim(),
    code: z.string().min(6).max(20).trim(),
    isRecoveryCode: z.boolean().default(false),
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

  const parseResult = Login2FASchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid verification request' }, { status: 400 });
  }

  const { email, code, isRecoveryCode } = parseResult.data;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  // Rate limit 2FA attempts: 5 per email per 15 min
  const rl = await rateLimit(`2fa:fail:${email}`, 5, 15 * 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many failed verification attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      }
    );
  }

  const user = await systemAdminScope(async () => User.findOne({ email }));
  if (!user || !user.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 });
  }

  let codeValid = false;

  if (isRecoveryCode) {
    const codeHash = hashToken(code.toUpperCase().trim());
    const updatedUser = await systemAdminScope(async () =>
      User.findOneAndUpdate(
        {
          _id: user._id,
          'recoveryCodes.hash': codeHash,
          'recoveryCodes.usedAt': { $exists: false },
        },
        {
          $set: {
            'recoveryCodes.$.usedAt': clock.now(),
            lastLoginAt: clock.now(),
          },
        },
        { new: true }
      )
    );
    if (updatedUser) {
      codeValid = true;
    }
  } else {
    codeValid = verifyTOTPCode(code, user.totpSecret, user.lastTotpCode);
    if (codeValid) {
      user.lastTotpCode = code;
      user.lastLoginAt = clock.now();
      await user.save();
    }
  }

  if (!codeValid) {
    await audit.record({
      clinicId: user.clinicId,
      action: AuditAction.AUTH_FAIL,
      entity: 'User',
      entityId: user._id.toString(),
      actor: { type: 'USER', id: user._id.toString() },
      ip,
      userAgent,
      meta: { reasonCode: 'BAD_2FA_CODE' },
    });

    return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 });
  }

  // Issue authenticated session with ID rotation
  const existingCookie = req.cookies.get(getSessionCookieName())?.value;
  const { token } = await rotateSession(existingCookie, user._id, user.clinicId, ip, userAgent);

  await audit.record({
    clinicId: user.clinicId,
    action: AuditAction.AUTH_LOGIN,
    entity: 'User',
    entityId: user._id.toString(),
    actor: { type: 'USER', id: user._id.toString() },
    ip,
    userAgent,
    meta: { usedRecoveryCode: isRecoveryCode },
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
