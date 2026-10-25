import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { getDashboardData } from '@/lib/dashboard-service';

export const GET = withAuth(
  async (req: NextRequest, { session }) => {
    await connectDb();
    const data = await getDashboardData(session.clinicId);
    return NextResponse.json(data);
  },
  { roles: ['DOCTOR'] }
);
