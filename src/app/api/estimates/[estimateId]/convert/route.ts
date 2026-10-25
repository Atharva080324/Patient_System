import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { convertEstimateToBill } from '@/lib/estimate-to-bill';

export const POST = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { estimateId } = await (context as any).params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // optional body
  }

  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const { bill, payment } = await convertEstimateToBill(
      auth.session.clinicId,
      estimateId,
      actor,
      body.initialPayment
    );

    return NextResponse.json({
      success: true,
      bill,
      payment,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to convert estimate' }, { status });
  }
});
