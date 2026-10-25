import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { getBill, updateBillDraft } from '@/lib/bill-service';

export const GET = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { billId } = await (context as any).params;

  const result = await getBill(auth.session.clinicId, billId);
  if (!result) {
    return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    bill: result.bill,
    payments: result.payments,
  });
});

export const PUT = withAuth(async (req: NextRequest, auth, context) => {
  await connectDb();
  const { billId } = await (context as any).params;
  const body = await req.json();
  const actor = {
    type: 'USER' as const,
    id: auth.user._id.toString(),
    role: auth.user.role,
  };

  try {
    const updated = await updateBillDraft(auth.session.clinicId, billId, body, actor);
    return NextResponse.json({
      success: true,
      bill: updated,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to update bill' }, { status });
  }
});
