import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, createSession, revokeAllUserSessions, getSessionCookieName } from '@/lib/auth';
import { verifyPassword, hashPassword, validatePasswordStrength } from '@/lib/passwords';
import { audit } from '@/lib/audit';
import { AuditAction } from '@/models/AuditLog';
import { assertPlainInput } from '@/lib/validation';
import { clock } from '@/lib/clock';
import { env } from '@/lib/env';

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12),
  })
  .strict();

export const POST = withAuth(async (req: NextRequest, auth) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  assertPlainInput(body);

  const parseResult = ChangePasswordSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input' },
      { status: 400 }
    );
  }

  const { currentPassword, newPassword } = parseResult.data;

  // Verify current password
  const currentValid = await verifyPassword(auth.user.passwordHash, currentPassword);
  if (!currentValid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
  }

  // Validate new password strength
  const strengthCheck = validatePasswordStrength(newPassword);
  if (!strengthCheck.valid) {
    return NextResponse.json({ error: strengthCheck.error }, { status: 400 });
  }

  // Hash new password
  const newHash = await hashPassword(newPassword);
  auth.user.passwordHash = newHash;
  auth.user.lastPasswordChangeAt = clock.now();
  await auth.user.save();

  // Revoke all existing sessions
  await revokeAllUserSessions(auth.user._id, auth.user.clinicId);

  // Issue new session for current client
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';
  const { token } = await createSession(auth.user._id, auth.user.clinicId, ip, userAgent);

  await audit.record({
    clinicId: auth.user.clinicId,
    action: AuditAction.PASSWORD_CHANGED,
    entity: 'User',
    entityId: auth.user._id.toString(),
    actor: { type: 'USER', id: auth.user._id.toString() },
    ip,
    userAgent,
  });

  const response = NextResponse.json({ success: true, message: 'Password changed successfully' });
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
