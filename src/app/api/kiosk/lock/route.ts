import { NextRequest, NextResponse } from 'next/server';
import { withKiosk, getKioskCookieName } from '@/lib/auth';
import { clock } from '@/lib/clock';
import { verifyCsrf } from '@/lib/csrf';

export const POST = withKiosk(async (req: NextRequest, device) => {
  device.revokedAt = clock.now();
  await device.save();

  const response = NextResponse.json({ success: true, message: 'Kiosk locked' });
  response.cookies.delete(getKioskCookieName());

  return response;
});
