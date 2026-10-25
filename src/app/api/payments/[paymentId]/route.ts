import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Payment } from '@/models/Payment';
import { Types } from 'mongoose';

export const GET = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { paymentId } = await (context as any).params;
  const clinicObjectId = new Types.ObjectId(auth.session.clinicId);
  const paymentObjectId = new Types.ObjectId(paymentId);

  const payment = await Payment.findOne({
    clinicId: clinicObjectId,
    _id: paymentObjectId,
  });

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    payment,
  });
});
