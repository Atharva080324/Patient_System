import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import {
  createAppointment,
  listAppointments,
  CreateAppointmentSchema,
  SlotConflictError,
} from '@/lib/appointment-service';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { clock } from '@/lib/clock';

export const GET = withAuth(async (req: NextRequest, { session, user }) => {
  await connectDb();
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('dateFrom') || undefined;
  const dateTo = url.searchParams.get('dateTo') || undefined;
  const status = url.searchParams.get('status') as any || undefined;
  const source = url.searchParams.get('source') as any || undefined;
  const search = url.searchParams.get('search') || undefined;
  const page = url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!, 10) : undefined;
  const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;

  const result = await listAppointments(session.clinicId, {
    dateFrom,
    dateTo,
    status,
    source,
    search,
    page,
    limit,
  });

  await AuditLog.create({
    clinicId: session.clinicId,
    action: AuditAction.APPOINTMENT_VIEW_LIST,
    entity: 'Appointment',
    entityId: 'list',
    actor: { type: 'USER', id: user._id.toString() },
    meta: { count: result.appointments.length },
    at: clock.now(),
    createdBy: { type: 'USER', id: user._id.toString() },
  });

  return NextResponse.json(result);
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });

export const POST = withAuth(async (req: NextRequest, { session, user }) => {
  await connectDb();
  const body = await req.json();
  const parsed = CreateAppointmentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation Error', details: parsed.error.issues }, { status: 400 });
  }

  const actor = { type: 'USER' as const, id: user._id.toString() };

  try {
    const { appointment } = await createAppointment(session.clinicId, parsed.data, actor);
    return NextResponse.json(appointment, { status: 201 });
  } catch (err: any) {
    if (err instanceof SlotConflictError || err.code === 'SLOT_TAKEN') {
      return NextResponse.json({ error: err.message, code: 'SLOT_TAKEN' }, { status: 409 });
    }
    if (err.statusCode === 422) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: err.statusCode || 500 });
  }
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });
