import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { createEstimateDraft, listEstimates } from '@/lib/estimate-service';
import { EstimateStatus } from '@/lib/estimate-state-machine';

export const GET = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const patientId = url.searchParams.get('patientId') || undefined;
  const status = (url.searchParams.get('status') as EstimateStatus) || undefined;

  const estimates = await listEstimates(auth.session.clinicId, { patientId, status });

  return NextResponse.json({
    success: true,
    estimates,
  });
});

export const POST = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const body = await req.json();
  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const estimate = await createEstimateDraft(auth.session.clinicId, body, actor);
    return NextResponse.json({
      success: true,
      estimate,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to create estimate' }, { status });
  }
});
