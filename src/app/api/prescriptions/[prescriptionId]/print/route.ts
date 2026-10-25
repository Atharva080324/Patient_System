import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { recordPrescriptionPrint } from '@/lib/prescription-service';

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
    const rx = await recordPrescriptionPrint(auth.session.clinicId, prescriptionId, actor);
    return NextResponse.json({
      success: true,
      printCount: rx.printCount,
      lastPrintedAt: rx.lastPrintedAt,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to record prescription print' },
      { status: 400 }
    );
  }
});
