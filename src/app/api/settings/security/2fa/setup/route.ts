import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { verifyPassword } from '@/lib/passwords';
import { generateTOTPSetup } from '@/lib/totp';
import { assertPlainInput } from '@/lib/validation';

const Setup2FASchema = z
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

  const parseResult = Setup2FASchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Password confirmation required' }, { status: 400 });
  }

  const { password } = parseResult.data;

  // Verify password before allowing 2FA setup
  const passwordValid = await verifyPassword(auth.user.passwordHash, password);
  if (!passwordValid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const setupData = await generateTOTPSetup(auth.user.email);

  return NextResponse.json({
    secret: setupData.secret,
    otpauthUrl: setupData.otpauthUrl,
    qrCodeDataUrl: setupData.qrCodeDataUrl,
    recoveryCodes: setupData.recoveryCodes,
    hashedRecoveryCodes: setupData.hashedRecoveryCodes,
  });
});
