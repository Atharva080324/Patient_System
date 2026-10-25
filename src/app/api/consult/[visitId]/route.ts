import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Visit } from '@/models/Visit';
import { Patient } from '@/models/Patient';
import { CaseSheet } from '@/models/CaseSheet';
import { Prescription } from '@/models/Prescription';
import { getOrCreateCaseSheet, saveCaseSheet, VersionConflictError } from '@/lib/case-sheet-service';
import { transitionVisitStatus } from '@/lib/queue-service';
import { getPrescriptionForVisit } from '@/lib/prescription-service';

export const GET = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const visitId = segments[segments.indexOf('consult') + 1];

  if (!visitId) {
    return NextResponse.json({ error: 'Missing visitId' }, { status: 400 });
  }

  const clinicId = auth.session.clinicId;
  const actor = { type: 'USER' as const, id: auth.user._id.toString() };

  let visit = await Visit.findOne({ clinicId, _id: visitId });
  if (!visit) {
    return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
  }

  // If visit is WAITING, transition to IN_CONSULTATION automatically using P2 state machine
  let autoCalledIn = false;
  if (visit.status === 'WAITING') {
    try {
      visit = await transitionVisitStatus(clinicId, visitId, 'IN_CONSULTATION', visit.version, actor);
      autoCalledIn = true;
    } catch (err: any) {
      // If single-occupancy operatory conflict, continue in read-only or error
      return NextResponse.json(
        {
          error: err.message || 'Cannot call patient into consultation',
          status: visit.status,
          chairOccupied: err.statusCode === 409,
        },
        { status: err.statusCode || 400 }
      );
    }
  }

  const patient = await Patient.findOne({ clinicId, _id: visit.patientId });
  if (!patient) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  }

  // Fetch or initialize CaseSheet
  const caseSheet = await getOrCreateCaseSheet(clinicId, visitId, actor);

  // Fetch past visits for this patient (newest first, excluding current visit)
  const pastVisitsRaw = await Visit.find({
    clinicId,
    patientId: patient._id,
    _id: { $ne: visit._id },
    status: { $in: ['COMPLETED', 'IN_CONSULTATION'] },
  })
    .sort({ date: -1, createdAt: -1 })
    .limit(10)
    .lean();

  // Attach past visit case sheet summary and prescription numbers
  const pastVisits = await Promise.all(
    pastVisitsRaw.map(async (pv: any) => {
      const pastSheet = await CaseSheet.findOne({ clinicId, visitId: pv._id }).lean();
      const pastRx = await Prescription.findOne({ clinicId, visitId: pv._id, status: 'ISSUED' }).lean();
      return {
        _id: pv._id.toString(),
        date: pv.date,
        chiefComplaint: pastSheet?.chiefComplaint || pv.reasonForVisit || 'N/A',
        diagnosis: pastSheet?.diagnosis || 'N/A',
        rxNumber: pastRx?.rxNumber || null,
      };
    })
  );

  // Fetch prescription for current visit
  const prescription = await getPrescriptionForVisit(clinicId, visitId);

  return NextResponse.json({
    success: true,
    visit: {
      _id: visit._id.toString(),
      token: visit.token,
      date: visit.date,
      type: visit.type,
      status: visit.status,
      version: visit.version,
      reasonForVisit: visit.reasonForVisit,
      isReadOnly: visit.status !== 'IN_CONSULTATION',
      autoCalledIn,
    },
    patient: {
      _id: patient._id.toString(),
      patientCode: patient.patientCode,
      name: patient.name,
      ageYears: patient.ageYears,
      sex: patient.sex,
      phone: patient.phone,
      address: patient.address,
      allergies: patient.medicalHistory?.allergies || [],
    },
    caseSheet: {
      _id: caseSheet._id.toString(),
      version: caseSheet.version,
      chiefComplaint: caseSheet.chiefComplaint,
      history: caseSheet.history,
      medicalHistoryNotes: caseSheet.medicalHistoryNotes,
      allergies: caseSheet.allergies,
      examinationFindings: caseSheet.examinationFindings,
      diagnosis: caseSheet.diagnosis,
      treatmentDoneOrAdvised: caseSheet.treatmentDoneOrAdvised,
      notes: caseSheet.notes,
      teethEntries: caseSheet.teethEntries,
      updatedAt: caseSheet.updatedAt,
    },
    prescription: prescription
      ? {
          _id: prescription._id.toString(),
          status: prescription.status,
          rxNumber: prescription.rxNumber,
          items: prescription.items,
          advice: prescription.advice,
          followUpDate: prescription.followUpDate,
          language: prescription.language,
          version: prescription.version,
          printCount: prescription.printCount,
          replacesPrescriptionId: prescription.replacesPrescriptionId?.toString(),
          voidReason: prescription.voidReason,
          snapshot: prescription.snapshot,
        }
      : null,
    pastVisits,
  });
});

export const POST = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const visitId = segments[segments.indexOf('consult') + 1];

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
      { error: `Cannot edit case sheet when visit status is ${visit.status}. Record is read-only.` },
      { status: 403 }
    );
  }

  const body = await req.json();

  try {
    const updated = await saveCaseSheet(clinicId, visitId, body, actor);
    return NextResponse.json({
      success: true,
      caseSheet: {
        _id: updated._id.toString(),
        version: updated.version,
        chiefComplaint: updated.chiefComplaint,
        history: updated.history,
        medicalHistoryNotes: updated.medicalHistoryNotes,
        allergies: updated.allergies,
        examinationFindings: updated.examinationFindings,
        diagnosis: updated.diagnosis,
        treatmentDoneOrAdvised: updated.treatmentDoneOrAdvised,
        notes: updated.notes,
        teethEntries: updated.teethEntries,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err: any) {
    if (err instanceof VersionConflictError) {
      return NextResponse.json(
        {
          error: err.message,
          conflict: true,
          latestVersion: err.latestCaseSheet.version,
          latestCaseSheet: {
            version: err.latestCaseSheet.version,
            chiefComplaint: err.latestCaseSheet.chiefComplaint,
            history: err.latestCaseSheet.history,
            medicalHistoryNotes: err.latestCaseSheet.medicalHistoryNotes,
            allergies: err.latestCaseSheet.allergies,
            examinationFindings: err.latestCaseSheet.examinationFindings,
            diagnosis: err.latestCaseSheet.diagnosis,
            treatmentDoneOrAdvised: err.latestCaseSheet.treatmentDoneOrAdvised,
            notes: err.latestCaseSheet.notes,
            teethEntries: err.latestCaseSheet.teethEntries,
          },
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message || 'Failed to save case sheet' }, { status: 400 });
  }
});
