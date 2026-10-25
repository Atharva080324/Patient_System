import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { issuePrescription } from '@/lib/prescription-service';

export const POST = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const rxIndex = segments.indexOf('prescriptions');
  const prescriptionId = segments[rxIndex + 1];

  if (!prescriptionId) {
    return NextResponse.json({ error: 'Missing prescriptionId' }, { status: 400 });
  }

  const actor = { type: 'USER' as const, id: auth.user._id.toString() };

  try {
    const rx = await issuePrescription(auth.session.clinicId, prescriptionId, actor);
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
        snapshot: rx.snapshot,
        version: rx.version,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to issue prescription' },
      { status: 400 }
    );
  }
});
