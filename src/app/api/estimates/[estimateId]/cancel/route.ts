import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { cancelEstimate } from '@/lib/estimate-service';

export const POST = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { estimateId } = await (context as any).params;
  const body = await req.json();
  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const cancelled = await cancelEstimate(
      auth.session.clinicId,
      estimateId,
      body.reason || '',
      actor
    );
    return NextResponse.json({
      success: true,
      estimate: cancelled,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to cancel estimate' }, { status });
  }
});
