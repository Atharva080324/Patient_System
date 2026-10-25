import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { cancelBill } from '@/lib/bill-service';

export const POST = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { billId } = await (context as any).params;
  const body = await req.json();
  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const cancelled = await cancelBill(
      auth.session.clinicId,
      billId,
      body.reason || '',
      actor
    );
    return NextResponse.json({
      success: true,
      bill: cancelled,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to cancel bill' }, { status });
  }
});
