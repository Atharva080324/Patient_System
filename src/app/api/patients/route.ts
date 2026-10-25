import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { searchPatients, PatientSearchOptions } from '@/lib/patient-search-service';

export const GET = withAuth(
  async (req: NextRequest, { session }) => {
    await connectDb();
    const url = new URL(req.url);

    const q = url.searchParams.get('q') || undefined;
    const page = url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!, 10) : undefined;
    const pageSize = url.searchParams.get('pageSize') ? parseInt(url.searchParams.get('pageSize')!, 10) : undefined;
    const sortBy = (url.searchParams.get('sortBy') as PatientSearchOptions['sortBy']) || undefined;
    const sortOrder = (url.searchParams.get('sortOrder') as PatientSearchOptions['sortOrder']) || undefined;
    const hasBalance = url.searchParams.get('hasBalance') === 'true' ? true : undefined;
    const hasFollowUpDue = url.searchParams.get('hasFollowUpDue') === 'true' ? true : undefined;
    const source = (url.searchParams.get('source') as PatientSearchOptions['source']) || undefined;
    const lastVisitFrom = url.searchParams.get('lastVisitFrom') || undefined;
    const lastVisitTo = url.searchParams.get('lastVisitTo') || undefined;

    const result = await searchPatients({
      clinicId: session.clinicId,
      q,
      page,
      pageSize,
      sortBy,
      sortOrder,
      hasBalance,
      hasFollowUpDue,
      source,
      lastVisitFrom,
      lastVisitTo,
    });

    return NextResponse.json(result);
  },
  { roles: ['DOCTOR'] }
);

export const POST = withAuth(
  async (req: NextRequest, { session }) => {
    await connectDb();
    const body = await req.json().catch(() => ({}));

    const result = await searchPatients({
      clinicId: session.clinicId,
      q: body.q,
      page: body.page,
      pageSize: body.pageSize,
      sortBy: body.sortBy,
      sortOrder: body.sortOrder,
      hasBalance: body.hasBalance,
      hasFollowUpDue: body.hasFollowUpDue,
      source: body.source,
      lastVisitFrom: body.lastVisitFrom,
      lastVisitTo: body.lastVisitTo,
    });

    return NextResponse.json(result);
  },
  { roles: ['DOCTOR'] }
);
