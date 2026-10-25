import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { recordPayment } from '@/lib/payment-service';

export const POST = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { billId } = await (context as any).params;
  const body = await req.json();

  const idempotencyKey =
    body.idempotencyKey || req.headers.get('idempotency-key') || undefined;

  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const { payment, billBalance } = await recordPayment(
      auth.session.clinicId,
      {
        ...body,
        billId,
        idempotencyKey,
      },
      actor
    );

    return NextResponse.json({
      success: true,
      payment,
      billBalance,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to record payment' }, { status });
  }
});
