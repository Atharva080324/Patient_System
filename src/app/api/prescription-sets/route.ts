import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { listPrescriptionSets, createPrescriptionSet } from '@/lib/prescription-set-service';

export const GET = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const sets = await listPrescriptionSets(auth.session.clinicId);
  return NextResponse.json({
    success: true,
    sets: sets.map((s) => ({
      _id: s._id.toString(),
      name: s.name,
      items: s.items,
      createdAt: s.createdAt,
    })),
  });
});

export const POST = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const actor = { type: 'USER' as const, id: auth.user._id.toString() };
  const body = await req.json();

  try {
    const set = await createPrescriptionSet(auth.session.clinicId, body, actor);
    return NextResponse.json({
      success: true,
      set: {
        _id: set._id.toString(),
        name: set.name,
        items: set.items,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create prescription set' },
      { status: 400 }
    );
  }
});
