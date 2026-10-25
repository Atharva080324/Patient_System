import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { updatePrescriptionSet, softDeletePrescriptionSet } from '@/lib/prescription-set-service';

export const PUT = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const setIndex = segments.indexOf('prescription-sets');
  const setId = segments[setIndex + 1];

  if (!setId) {
    return NextResponse.json({ error: 'Missing setId' }, { status: 400 });
  }

  const actor = { type: 'USER' as const, id: auth.user._id.toString() };
  const body = await req.json();

  try {
    const updated = await updatePrescriptionSet(auth.session.clinicId, setId, body, actor);
    return NextResponse.json({
      success: true,
      set: {
        _id: updated._id.toString(),
        name: updated.name,
        items: updated.items,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update prescription set' },
      { status: 400 }
    );
  }
});

export const DELETE = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const setIndex = segments.indexOf('prescription-sets');
  const setId = segments[setIndex + 1];

  if (!setId) {
    return NextResponse.json({ error: 'Missing setId' }, { status: 400 });
  }

  const actor = { type: 'USER' as const, id: auth.user._id.toString() };

  try {
    await softDeletePrescriptionSet(auth.session.clinicId, setId, actor);
    return NextResponse.json({ success: true, message: 'Prescription set deleted' });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete prescription set' },
      { status: 400 }
    );
  }
});
