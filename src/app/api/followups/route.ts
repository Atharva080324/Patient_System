import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  listFollowUps,
  createFollowUp,
  CreateFollowUpSchema,
  FollowUpTab,
} from '@/lib/followup-service';

export const GET = withAuth(async (req: NextRequest, { session }) => {
  const url = new URL(req.url);
  const tab = (url.searchParams.get('tab') as FollowUpTab) || undefined;
  const patientId = url.searchParams.get('patientId') || undefined;

  const result = await listFollowUps(session.clinicId, { tab, patientId });
  return NextResponse.json(result);
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });

export const POST = withAuth(async (req: NextRequest, { session, user }) => {
  const body = await req.json();
  const parsed = CreateFollowUpSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation Error', details: parsed.error.issues }, { status: 400 });
  }

  const actor = { type: 'USER' as const, id: user._id.toString() };

  try {
    const followUp = await createFollowUp(session.clinicId, parsed.data, actor);
    return NextResponse.json(followUp, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode || 500 });
  }
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });
