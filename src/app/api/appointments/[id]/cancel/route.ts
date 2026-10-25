import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { cancelAppointment } from '@/lib/appointment-service';

export const POST = withAuth(async (req: NextRequest, { session, user }, context) => {
  const { id } = await (context?.params as any);
  const body = await req.json().catch(() => ({}));

  if (!body.reason || typeof body.reason !== 'string' || !body.reason.trim()) {
    return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 422 });
  }

  const actor = { type: 'USER' as const, id: user._id.toString() };

  try {
    const cancelled = await cancelAppointment(session.clinicId, id, body.reason, actor);
    return NextResponse.json(cancelled);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode || 500 });
  }
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });
