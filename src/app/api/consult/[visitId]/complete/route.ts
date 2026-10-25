import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Visit } from '@/models/Visit';
import { CaseSheet } from '@/models/CaseSheet';
import { transitionVisitStatus } from '@/lib/queue-service';

export const POST = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const consultIndex = segments.indexOf('consult');
  const visitId = segments[consultIndex + 1];

  if (!visitId) {
    return NextResponse.json({ error: 'Missing visitId' }, { status: 400 });
  }

  const clinicId = auth.session.clinicId;
  const actor = { type: 'USER' as const, id: auth.user._id.toString() };

  const visit = await Visit.findOne({ clinicId, _id: visitId });
  if (!visit) {
    return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
  }

  if (visit.status !== 'IN_CONSULTATION') {
    return NextResponse.json(
      { error: `Cannot complete visit in status ${visit.status}. Only IN_CONSULTATION can be completed.` },
      { status: 400 }
    );
  }

  // Enforce rule: case sheet must exist and be saved
  const caseSheet = await CaseSheet.findOne({ clinicId, visitId });
  if (!caseSheet) {
    return NextResponse.json(
      { error: 'Cannot complete visit: Case sheet has not been saved.' },
      { status: 400 }
    );
  }

  // Check that at least some clinical assessment exists (chiefComplaint, findings, diagnosis, treatment, or teethEntries)
  const hasContent =
    Boolean(caseSheet.chiefComplaint?.trim()) ||
    Boolean(caseSheet.examinationFindings?.trim()) ||
    Boolean(caseSheet.diagnosis?.trim()) ||
    Boolean(caseSheet.treatmentDoneOrAdvised?.trim()) ||
    Boolean(caseSheet.teethEntries && caseSheet.teethEntries.length > 0);

  if (!hasContent) {
    return NextResponse.json(
      { error: 'Cannot complete visit: Please record findings, diagnosis, or tooth entries in the case sheet before completing.' },
      { status: 400 }
    );
  }

  try {
    const updatedVisit = await transitionVisitStatus(clinicId, visitId, 'COMPLETED', visit.version, actor);
    return NextResponse.json({
      success: true,
      visit: {
        _id: updatedVisit._id.toString(),
        status: updatedVisit.status,
        version: updatedVisit.version,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to complete visit' },
      { status: err.statusCode || 500 }
    );
  }
});
