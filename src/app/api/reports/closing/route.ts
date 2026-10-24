import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { generateClosingReport } from '@/lib/closing-report-service';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';

export const GET = withAuth(async (req: NextRequest, session) => {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get('date') || clinicDate(clock.now());

  const report = await generateClosingReport(session.clinicId, dateParam);

  await AuditLog.create({
    clinicId: session.clinicId,
    actor: { type: 'USER', id: session.userId.toString() },
    action: AuditAction.CLOSING_REPORT_VIEW,
    entity: 'ClosingReport',
    entityId: dateParam,
    at: clock.now(),
    createdBy: { type: 'USER', id: session.userId.toString() },
  });

  return NextResponse.json({
    success: true,
    data: report,
  });
});
