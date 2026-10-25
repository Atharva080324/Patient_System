import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { reversePayment } from '@/lib/payment-service';

export const POST = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { paymentId } = await (context as any).params;
  const body = await req.json();
  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const { reversalPayment, billBalance } = await reversePayment(
      auth.session.clinicId,
      paymentId,
      body.reason || '',
      actor
    );

    return NextResponse.json({
      success: true,
      payment: reversalPayment,
      billBalance,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to reverse payment' }, { status });
  }
});
