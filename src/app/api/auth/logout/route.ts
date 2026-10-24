import { NextRequest, NextResponse } from 'next/server';
import { withAuth, revokeSession, getSessionCookieName } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { AuditAction } from '@/models/AuditLog';

export const POST = withAuth(async (req: NextRequest, auth) => {
  const cookieName = getSessionCookieName();
  const token = req.cookies.get(cookieName)?.value;

  if (token) {
    await revokeSession(token);
  }

  await audit.record({
    clinicId: auth.user.clinicId,
    action: AuditAction.AUTH_LOGOUT,
    entity: 'User',
    entityId: auth.user._id.toString(),
    actor: { type: 'USER', id: auth.user._id.toString() },
  });

  const response = NextResponse.json({ success: true });
  response.cookies.delete(cookieName);

  return response;
});
