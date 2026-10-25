import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { cancelFollowUp } from '@/lib/followup-service';

export const POST = withAuth(async (req: NextRequest, { session, user }, context) => {
  await connectDb();
  const { id } = await (context?.params as any);
  const actor = { type: 'USER' as const, id: user._id.toString() };

  try {
    const updated = await cancelFollowUp(session.clinicId, id, actor);
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode || 500 });
  }
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });
