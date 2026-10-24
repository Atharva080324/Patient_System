import { NextRequest, NextResponse } from 'next/server';
import { withAuth, revokeAllUserSessions, getSessionCookieName } from '@/lib/auth';

export const POST = withAuth(async (req: NextRequest, auth) => {
  await revokeAllUserSessions(auth.user._id, auth.user.clinicId);

  const response = NextResponse.json({
    success: true,
    message: 'All device sessions have been revoked',
  });

  response.cookies.delete(getSessionCookieName());
  return response;
});
