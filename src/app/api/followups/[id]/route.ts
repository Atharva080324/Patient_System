import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  updateFollowUp,
  softDeleteFollowUp,
  UpdateFollowUpSchema,
} from '@/lib/followup-service';

export const PATCH = withAuth(async (req: NextRequest, { session, user }, context) => {
  const { id } = await (context?.params as any);
  const body = await req.json();

  const parsed = UpdateFollowUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation Error', details: parsed.error.issues }, { status: 400 });
  }

  const actor = { type: 'USER' as const, id: user._id.toString() };

  try {
    const updated = await updateFollowUp(session.clinicId, id, parsed.data, actor);
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode || 500 });
  }
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });

export const DELETE = withAuth(async (req: NextRequest, { session, user }, context) => {
  const { id } = await (context?.params as any);
  const actor = { type: 'USER' as const, id: user._id.toString() };

  try {
    const deleted = await softDeleteFollowUp(session.clinicId, id, actor);
    return NextResponse.json(deleted);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode || 500 });
  }
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });
