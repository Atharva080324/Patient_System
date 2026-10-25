import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Prescription } from '@/models/Prescription';
import { AuditLog, AuditAction } from '@/models/AuditLog';
import { clock } from '@/lib/clock';

export const GET = withAuth(async (req: NextRequest, auth) => {
  await connectDb();
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const rxIndex = segments.indexOf('prescriptions');
  const prescriptionId = segments[rxIndex + 1];

  if (!prescriptionId) {
    return NextResponse.json({ error: 'Missing prescriptionId' }, { status: 400 });
  }

  const clinicId = auth.session.clinicId;
  const rx = await Prescription.findOne({ clinicId, _id: prescriptionId });

  if (!rx) {
    return NextResponse.json({ error: 'Prescription not found' }, { status: 404 });
  }

  // Audit PRESCRIPTION_VIEW
  await AuditLog.create({
    clinicId,
    action: AuditAction.PRESCRIPTION_VIEW,
    entity: 'Prescription',
    entityId: rx._id.toString(),
    actor: { type: 'USER', id: auth.user._id.toString() },
    meta: { rxNumber: rx.rxNumber, status: rx.status },
    at: clock.now(),
    createdBy: { type: 'USER', id: auth.user._id.toString() },
  });

  return NextResponse.json({
    success: true,
    prescription: {
      _id: rx._id.toString(),
      status: rx.status,
      rxNumber: rx.rxNumber,
      date: rx.date,
      items: rx.items,
      advice: rx.advice,
      followUpDate: rx.followUpDate,
      language: rx.language,
      replacesPrescriptionId: rx.replacesPrescriptionId?.toString(),
      voidReason: rx.voidReason,
      voidedAt: rx.voidedAt,
      snapshot: rx.snapshot,
      printCount: rx.printCount,
      lastPrintedAt: rx.lastPrintedAt,
      version: rx.version,
    },
  });
});
