import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { savePrescriptionDraft } from '@/lib/prescription-service';

export const POST = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const rxIndex = segments.indexOf('prescriptions');
  const visitId = segments[rxIndex + 1];

  if (!visitId) {
    return NextResponse.json({ error: 'Missing visitId' }, { status: 400 });
  }

  const actor = { type: 'USER' as const, id: auth.user._id.toString() };
  const body = await req.json();

  try {
    const rx = await savePrescriptionDraft(auth.session.clinicId, visitId, body, actor);
    return NextResponse.json({
      success: true,
      prescription: {
        _id: rx._id.toString(),
        status: rx.status,
        rxNumber: rx.rxNumber,
        items: rx.items,
        advice: rx.advice,
        followUpDate: rx.followUpDate,
        language: rx.language,
        version: rx.version,
        updatedAt: rx.updatedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to save prescription draft' },
      { status: 400 }
    );
  }
});
