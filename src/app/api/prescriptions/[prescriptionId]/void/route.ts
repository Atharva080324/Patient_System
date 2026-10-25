import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { voidPrescription } from '@/lib/prescription-service';

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
  const body = await req.json().catch(() => ({}));
  const voidReason = body.voidReason || '';

  if (!voidReason.trim()) {
    return NextResponse.json({ error: 'A void reason is required' }, { status: 400 });
  }

  try {
    const rx = await voidPrescription(auth.session.clinicId, prescriptionId, voidReason, actor);
    return NextResponse.json({
      success: true,
      prescription: {
        _id: rx._id.toString(),
        status: rx.status,
        rxNumber: rx.rxNumber,
        voidReason: rx.voidReason,
        voidedAt: rx.voidedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to void prescription' },
      { status: 400 }
    );
  }
});
