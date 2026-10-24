import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { verifyPassword } from '@/lib/passwords';
import { audit } from '@/lib/audit';
import { AuditAction } from '@/models/AuditLog';
import { assertPlainInput } from '@/lib/validation';

const Disable2FASchema = z
  .object({
    password: z.string().min(1),
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

  const parseResult = Disable2FASchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  const { password } = parseResult.data;

  const valid = await verifyPassword(auth.user.passwordHash, password);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  auth.user.totpEnabled = false;
  auth.user.totpSecret = undefined;
  auth.user.recoveryCodes = [];
  await auth.user.save();

  await audit.record({
    clinicId: auth.user.clinicId,
    action: AuditAction.AUTH_2FA_DISABLED,
    entity: 'User',
    entityId: auth.user._id.toString(),
    actor: { type: 'USER', id: auth.user._id.toString() },
  });

  return NextResponse.json({ success: true, message: 'Two-factor authentication disabled' });
});
