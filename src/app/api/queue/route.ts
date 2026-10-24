import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getLiveQueue } from '@/lib/queue-service';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';

export const GET = withAuth(async (req: NextRequest, session) => {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get('date') || clinicDate(clock.now());

  const queueData = await getLiveQueue(session.clinicId, dateParam);

  await AuditLog.create({
    clinicId: session.clinicId,
    actor: { type: 'USER', id: session.userId.toString() },
    action: AuditAction.QUEUE_VIEW,
    entity: 'Queue',
    entityId: dateParam,
    at: clock.now(),
    createdBy: { type: 'USER', id: session.userId.toString() },
  });

  return NextResponse.json({
    success: true,
    data: queueData,
  });
});
