import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Treatment } from '@/models/Treatment';
import { Types } from 'mongoose';

export const GET = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || '';

  const clinicObjectId = new Types.ObjectId(auth.session.clinicId);
  const query: Record<string, unknown> = {
    clinicId: clinicObjectId,
    active: true,
  };

  if (q) {
    const regex = new RegExp(q, 'i');
    query.$or = [{ name: regex }, { code: regex }, { category: regex }];
  }

  const treatments = await Treatment.find(query).sort({ category: 1, name: 1 }).limit(100);

  return NextResponse.json({
    success: true,
    treatments: treatments.map((t) => ({
      _id: t._id.toString(),
      code: t.code,
      name: t.name,
      category: t.category,
      unit: t.unit,
      clinicPrice: t.clinicPrice ?? (t.idaMin ? t.idaMin * 100 : 0),
      idaMin: t.idaMin,
      idaMax: t.idaMax,
      active: t.active,
    })),
  });
});
