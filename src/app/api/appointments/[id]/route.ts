import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import {
  getAppointment,
  rescheduleAppointment,
  SlotConflictError,
} from '@/lib/appointment-service';
import { Appointment } from '@/models/Appointment';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { clock } from '@/lib/clock';

export const GET = withAuth(async (req: NextRequest, { session }, context) => {
  await connectDb();
  const { id } = await (context?.params as any);
  const appointment = await getAppointment(session.clinicId, id);

  if (!appointment) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }

  return NextResponse.json(appointment);
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });

export const PATCH = withAuth(async (req: NextRequest, { session, user }, context) => {
  await connectDb();
  const { id } = await (context?.params as any);
  const body = await req.json();

  const actor = { type: 'USER' as const, id: user._id.toString() };

  // If start is provided, it's a reschedule
  if (body.start) {
    if (typeof body.version !== 'number') {
      return NextResponse.json(
        { error: 'version is required for rescheduling' },
        { status: 400 }
      );
    }

    try {
      const updated = await rescheduleAppointment(
        session.clinicId,
        id,
        {
          start: new Date(body.start),
          end: body.end ? new Date(body.end) : undefined,
          version: body.version,
        },
        actor
      );

      // If notes or treatmentCode also updated
      if (body.notes !== undefined || body.treatmentCode !== undefined) {
        if (body.notes !== undefined) updated.notes = body.notes;
        if (body.treatmentCode !== undefined) updated.treatmentCode = body.treatmentCode;
        await updated.save();
      }

      return NextResponse.json(updated);
    } catch (err: any) {
      if (err instanceof SlotConflictError || err.code === 'SLOT_TAKEN') {
        return NextResponse.json({ error: err.message, code: 'SLOT_TAKEN' }, { status: 409 });
      }
      return NextResponse.json({ error: err.message }, { status: err.statusCode || 500 });
    }
  }

  // Otherwise updating metadata (notes, treatmentCode)
  const appointment = await Appointment.findOne({
    clinicId: session.clinicId,
    _id: id,
    deletedAt: null,
  });

  if (!appointment) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }

  if (appointment.status !== 'BOOKED') {
    return NextResponse.json(
      { error: `Cannot edit appointment with status ${appointment.status}` },
      { status: 409 }
    );
  }

  if (typeof body.version === 'number' && appointment.version !== body.version) {
    return NextResponse.json(
      { error: 'Conflict: Appointment was modified by another session' },
      { status: 409 }
    );
  }

  const changedFields: string[] = [];
  if (body.notes !== undefined && body.notes !== appointment.notes) {
    appointment.notes = body.notes;
    changedFields.push('notes');
  }
  if (body.treatmentCode !== undefined && body.treatmentCode !== appointment.treatmentCode) {
    appointment.treatmentCode = body.treatmentCode;
    changedFields.push('treatmentCode');
  }

  if (changedFields.length > 0) {
    appointment.version += 1;
    await appointment.save();

    await AuditLog.create({
      clinicId: session.clinicId,
      action: AuditAction.APPOINTMENT_UPDATE,
      entity: 'Appointment',
      entityId: appointment._id.toString(),
      actor,
      meta: {
        appointmentId: appointment._id.toString(),
        changedFields,
      },
      at: clock.now(),
      createdBy: actor,
    });
  }

  return NextResponse.json(appointment);
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });
