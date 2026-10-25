import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { searchMedicines, createCustomMedicine } from '@/lib/medicine-search';

export const GET = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  const limitParam = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.min(Math.max(1, limitParam), 50);

  const startTime = performance.now();
  const results = await searchMedicines(auth.session.clinicId, q, limit);
  const elapsedMs = performance.now() - startTime;

  return NextResponse.json({
    success: true,
    results,
    count: results.length,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
  });
});

export const POST = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const body = await req.json();
  const actor = { type: 'USER' as const, id: auth.user._id.toString() };

  try {
    const med = await createCustomMedicine(auth.session.clinicId, body, actor);
    return NextResponse.json({
      success: true,
      medicine: {
        _id: med._id.toString(),
        genericName: med.genericName,
        brandName: med.brandName,
        form: med.form,
        strength: med.strength,
        source: med.source,
        verified: med.verified,
        active: med.active,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create custom medicine' },
      { status: 400 }
    );
  }
});
