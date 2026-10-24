import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { verifyTOTPCode } from '@/lib/totp';
import { audit } from '@/lib/audit';
import { AuditAction } from '@/models/AuditLog';
import { assertPlainInput } from '@/lib/validation';

const Enable2FASchema = z
  .object({
    secret: z.string().min(16),
    code: z.string().min(6).max(8),
    hashedRecoveryCodes: z.array(
      z.object({
        hash: z.string(),
      })
    ),
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

  const parseResult = Enable2FASchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  const { secret, code, hashedRecoveryCodes } = parseResult.data;

  const valid = verifyTOTPCode(code, secret);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid verification code. Please try again.' }, { status: 400 });
  }

  auth.user.totpSecret = secret;
  auth.user.totpEnabled = true;
  auth.user.recoveryCodes = hashedRecoveryCodes;
  await auth.user.save();

  await audit.record({
    clinicId: auth.user.clinicId,
    action: AuditAction.AUTH_2FA_ENABLED,
    entity: 'User',
    entityId: auth.user._id.toString(),
    actor: { type: 'USER', id: auth.user._id.toString() },
  });

  return NextResponse.json({ success: true, message: 'Two-factor authentication enabled successfully' });
});
