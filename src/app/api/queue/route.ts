import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getLiveQueue } from '@/lib/queue-service';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { Patient } from '@/models/Patient';
import { Visit } from '@/models/Visit';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';
import { connectDb } from '@/lib/db';

export const GET = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const dateParam = url.searchParams.get('date') || clinicDate(clock.now());

  const queueData = await getLiveQueue(auth.session.clinicId, dateParam);

  await AuditLog.create({
    clinicId: auth.session.clinicId,
    actor: { type: 'USER', id: auth.user._id.toString() },
    action: AuditAction.QUEUE_VIEW,
    entity: 'Queue',
    entityId: dateParam,
    at: clock.now(),
    createdBy: { type: 'USER', id: auth.user._id.toString() },
  });

  return NextResponse.json({
    success: true,
    counters: queueData.counters,
    items: queueData.items,
    data: queueData,
  });
});
