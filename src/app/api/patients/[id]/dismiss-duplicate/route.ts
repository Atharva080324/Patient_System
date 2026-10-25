import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Types } from 'mongoose';
import { dismissDuplicate } from '@/lib/patient-update-service';

export const POST = withAuth(
  async (req: NextRequest, { session }, context: any) => {
    await connectDb();
    const resolvedParams = await (context?.params || {});
    const { id } = resolvedParams;

    if (!id || !Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid patient ID' }, { status: 400 });
    }

    try {
      const patient = await dismissDuplicate({
        clinicId: session.clinicId,
        patientId: id,
        doctorActor: { type: 'USER', id: session.userId.toString() },
      });

      return NextResponse.json({ success: true, duplicateDismissed: patient.duplicateDismissed });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Dismiss failed' },
        { status: 400 }
      );
    }
  },
  { roles: ['DOCTOR'] }
);
