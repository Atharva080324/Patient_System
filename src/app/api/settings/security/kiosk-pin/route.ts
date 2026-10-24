import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, rotateKioskPin } from '@/lib/auth';
import { verifyPassword } from '@/lib/passwords';
import { assertPlainInput } from '@/lib/validation';

const RotatePinSchema = z
  .object({
    password: z.string().min(1),
    newPin: z.string().min(4).max(10),
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

  const parseResult = RotatePinSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  const { password, newPin } = parseResult.data;

  // Confirm password
  const valid = await verifyPassword(auth.user.passwordHash, password);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  await rotateKioskPin(auth.user.clinicId, newPin, {
    type: 'USER',
    id: auth.user._id.toString(),
  });

  return NextResponse.json({
    success: true,
    message: 'Kiosk PIN updated and all existing device sessions revoked',
  });
});
