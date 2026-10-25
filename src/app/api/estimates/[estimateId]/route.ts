import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { getEstimate, updateEstimateDraft } from '@/lib/estimate-service';

export const GET = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { estimateId } = await (context as any).params;

  const estimate = await getEstimate(auth.session.clinicId, estimateId);
  if (!estimate) {
    return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    estimate,
  });
});

export const PUT = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { estimateId } = await (context as any).params;
  const body = await req.json();
  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const updated = await updateEstimateDraft(auth.session.clinicId, estimateId, body, actor);
    return NextResponse.json({
      success: true,
      estimate: updated,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to update estimate' }, { status });
  }
});
