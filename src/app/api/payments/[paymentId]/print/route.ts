import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { recordReceiptPrint } from '@/lib/payment-service';

export const POST = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { paymentId } = await (context as any).params;
  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const updated = await recordReceiptPrint(auth.session.clinicId, paymentId, actor);
    return NextResponse.json({
      success: true,
      payment: updated,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to record receipt print' }, { status });
  }
});
