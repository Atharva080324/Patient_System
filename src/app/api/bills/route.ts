import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { createBill, listBills } from '@/lib/bill-service';

export const GET = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const patientId = url.searchParams.get('patientId') || undefined;
  const visitId = url.searchParams.get('visitId') || undefined;
  const status = url.searchParams.get('status') || undefined;

  const bills = await listBills(auth.session.clinicId, { patientId, visitId, status });

  return NextResponse.json({
    success: true,
    bills,
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
    const { bill, payment } = await createBill(auth.session.clinicId, body, actor);
    return NextResponse.json({
      success: true,
      bill,
      payment,
    });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return NextResponse.json({ error: err.message || 'Failed to create bill' }, { status });
  }
});
