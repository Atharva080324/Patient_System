import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { toggleMedicineFavorite } from '@/lib/medicine-search';

export const POST = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const medIndex = segments.indexOf('medicines');
  const medicineId = segments[medIndex + 1];

  if (!medicineId) {
    return NextResponse.json({ error: 'Missing medicineId' }, { status: 400 });
  }

  const actor = { type: 'USER' as const, id: auth.user._id.toString() };
  try {
    const res = await toggleMedicineFavorite(auth.session.clinicId, medicineId, actor);
    return NextResponse.json({ success: true, isFavorite: res.isFavorite });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to toggle favorite' },
      { status: 400 }
    );
  }
});
