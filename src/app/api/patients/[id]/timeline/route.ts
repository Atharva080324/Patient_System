import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Types } from 'mongoose';
import { buildPatientTimeline } from '@/lib/timeline-builder';

export const GET = withAuth(
  async (req: NextRequest, { session }, context: any) => {
    await connectDb();
    const resolvedParams = await (context?.params || {});
    const { id } = resolvedParams;

    if (!id || !Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid patient ID' }, { status: 400 });
    }

    const url = new URL(req.url);
    const cursor = url.searchParams.get('cursor') || undefined;
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : 15;

    try {
      const timelineResult = await buildPatientTimeline({
        clinicId: session.clinicId,
        patientId: id,
        cursor,
        limit,
      });

      return NextResponse.json(timelineResult);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Timeline error' },
        { status: 500 }
      );
    }
  },
  { roles: ['DOCTOR'] }
);
