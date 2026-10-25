import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Types } from 'mongoose';
import { Patient } from '@/models/Patient';
import { Bill } from '@/models/Bill';
import {
  updatePatient,
  recordPatientView,
  PatientVersionConflictError,
} from '@/lib/patient-update-service';

export const GET = withAuth(
  async (req: NextRequest, { session }, context: any) => {
    await connectDb();
    const resolvedParams = await (context?.params || {});
    const { id } = resolvedParams;

    if (!id || !Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid patient ID' }, { status: 400 });
    }

    const patientObjectId = new Types.ObjectId(id);
    const clinicObjectId = new Types.ObjectId(session.clinicId);

    const patient = await Patient.findOne({
      _id: patientObjectId,
      clinicId: clinicObjectId,
      deletedAt: null,
    }).lean();

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Record audit PATIENT_VIEW (id only)
    await recordPatientView({
      clinicId: session.clinicId,
      patientId: id,
      doctorActor: { type: 'USER', id: session.userId.toString() },
    });

    // Check duplicate candidate
    let duplicatePatient = null;
    if (patient.possibleDuplicateOf && !patient.duplicateDismissed) {
      duplicatePatient = await Patient.findOne({
        _id: patient.possibleDuplicateOf,
        clinicId: clinicObjectId,
        deletedAt: null,
      })
        .select('_id name phone patientCode')
        .lean();
    }

    // Fetch active bills for Billing section
    const bills = await Bill.find({
      clinicId: clinicObjectId,
      patientId: patientObjectId,
      status: { $ne: 'CANCELLED' },
    })
      .sort({ createdAt: -1 })
      .lean();

    let totalBilled = 0;
    let totalPaid = 0;
    let outstandingBalance = 0;

    const formattedBills = bills.map((b) => {
      totalBilled += b.total || 0;
      totalPaid += b.paid || 0;
      outstandingBalance += b.balance || 0;
      return {
        _id: b._id.toString(),
        billNumber: b.billNo,
        billDate: b.createdAt ? b.createdAt.toISOString() : '',
        status: b.status,
        grandTotal: b.total,
        paidAmount: b.paid,
        balanceAmount: b.balance,
      };
    });

    return NextResponse.json({
      patient: {
        _id: patient._id.toString(),
        name: patient.name,
        phone: patient.phone,
        patientCode: patient.patientCode,
        sex: patient.sex,
        ageYears: patient.ageYears,
        dob: patient.dob,
        source: patient.source,
        allergies: patient.medicalHistory?.allergies || [],
        medicalNotes: patient.notes || '',
        generalNotes: patient.generalNotes || '',
        registeredAt: patient.createdAt ? patient.createdAt.toISOString() : '',
        version: patient.version || 1,
        duplicateDismissed: !!patient.duplicateDismissed,
      },
      duplicateCandidate: duplicatePatient
        ? {
            _id: duplicatePatient._id.toString(),
            name: duplicatePatient.name,
            phone: duplicatePatient.phone,
            patientCode: duplicatePatient.patientCode,
          }
        : null,
      billingSummary: {
        totalBilled,
        totalPaid,
        outstandingBalance,
        bills: formattedBills,
      },
    });
  },
  { roles: ['DOCTOR'] }
);

export const PATCH = withAuth(
  async (req: NextRequest, { session }, context: any) => {
    await connectDb();
    const resolvedParams = await (context?.params || {});
    const { id } = resolvedParams;

    if (!id || !Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid patient ID' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    try {
      const updated = await updatePatient({
        clinicId: session.clinicId,
        patientId: id,
        version: body.version,
        updates: {
          name: body.name,
          phone: body.phone,
          ageYears: body.ageYears,
          dob: body.dob,
          sex: body.sex,
          allergies: body.allergies,
          medicalNotes: body.medicalNotes,
          generalNotes: body.generalNotes,
        },
        doctorActor: { type: 'USER', id: session.userId.toString() },
      });

      return NextResponse.json({
        patient: {
          _id: updated._id.toString(),
          name: updated.name,
          phone: updated.phone,
          patientCode: updated.patientCode,
          sex: updated.sex,
          ageYears: updated.ageYears,
          dob: updated.dob,
          source: updated.source,
          allergies: updated.medicalHistory?.allergies || [],
          medicalNotes: updated.notes || '',
          generalNotes: updated.generalNotes || '',
          version: updated.version,
        },
      });
    } catch (err) {
      if (err instanceof PatientVersionConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Update failed' },
        { status: 400 }
      );
    }
  },
  { roles: ['DOCTOR'] }
);
