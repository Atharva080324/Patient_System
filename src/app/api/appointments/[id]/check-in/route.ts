import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { checkInAppointment } from '@/lib/appointment-service';

export const POST = withAuth(async (req: NextRequest, { session, user }, context) => {
  const { id } = await (context?.params as any);
  const body = await req.json().catch(() => ({}));
  const actor = { type: 'USER' as const, id: user._id.toString() };

  try {
    const result = await checkInAppointment(
      session.clinicId,
      id,
      body.ageYears !== undefined || body.dob || body.sex
        ? { ageYears: body.ageYears, dob: body.dob, sex: body.sex }
        : undefined,
      actor
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.statusCode || 500 }
    );
  }
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });
