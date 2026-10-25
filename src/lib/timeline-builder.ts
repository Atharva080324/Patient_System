import { Types } from 'mongoose';
import { Visit } from '../models/Visit';
import { CaseSheet } from '../models/CaseSheet';
import { Prescription } from '../models/Prescription';
import { Estimate } from '../models/Estimate';
import { Bill } from '../models/Bill';
import { Payment } from '../models/Payment';
import { Appointment } from '../models/Appointment';
import { FollowUp } from '../models/FollowUp';
import { getTenantContext, runWithTenantContext, TenantActor } from './tenancy';
import { clock } from './clock';

export type TimelineItemType =
  | 'VISIT'
  | 'CASE_SHEET'
  | 'PRESCRIPTION'
  | 'ESTIMATE'
  | 'BILL'
  | 'PAYMENT'
  | 'REVERSAL'
  | 'APPOINTMENT'
  | 'FOLLOW_UP';

export interface TimelineItem {
  id: string;
  type: TimelineItemType;
  timestamp: string; // ISO string
  date: string; // alias for UI & tests
  title: string;
  subtitle?: string;
  summary: string; // alias for UI & tests
  status?: string;
  badge?: string; // alias for UI & tests
  isVoid?: boolean;
  isReversal?: boolean;
  amountPaise?: number;
  linkUrl?: string;
  link?: string; // alias for UI & tests
  metadata?: Record<string, unknown>;
}

export interface TimelineOptions {
  limit?: number;
  cursor?: string;
}

export interface TimelineResponse {
  items: TimelineItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function buildPatientTimeline(
  arg1:
    | {
        clinicId: Types.ObjectId | string;
        patientId: Types.ObjectId | string;
        cursor?: string;
        limit?: number;
      }
    | Types.ObjectId
    | string,
  arg2?: Types.ObjectId | string,
  arg3?: TimelineOptions,
  arg4?: TenantActor
): Promise<TimelineResponse> {
  let clinicIdRaw: Types.ObjectId | string;
  let patientIdRaw: Types.ObjectId | string;
  let cursor: string | undefined;
  let limit = 15;
  const actor: TenantActor | undefined = arg4;

  if (typeof arg1 === 'object' && 'clinicId' in arg1) {
    clinicIdRaw = arg1.clinicId;
    patientIdRaw = arg1.patientId;
    cursor = arg1.cursor;
    if (arg1.limit) limit = arg1.limit;
  } else {
    clinicIdRaw = arg1;
    patientIdRaw = arg2!;
    cursor = arg3?.cursor;
    if (arg3?.limit) limit = arg3.limit;
  }

  const clinicObjectId =
    clinicIdRaw instanceof Types.ObjectId ? clinicIdRaw : new Types.ObjectId(String(clinicIdRaw));
  const patientObjectId =
    patientIdRaw instanceof Types.ObjectId ? patientIdRaw : new Types.ObjectId(String(patientIdRaw));

  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    const act = actor || { type: 'USER' as const, id: 'timeline-builder' };
    return runWithTenantContext({ clinicId: clinicObjectId, actor: act }, () =>
      buildPatientTimeline(
        { clinicId: clinicObjectId, patientId: patientObjectId, cursor, limit },
        undefined,
        undefined,
        act
      )
    );
  }

  limit = Math.max(1, Math.min(100, limit));

  // 1. Fetch records across collections in parallel
  const [
    visits,
    caseSheets,
    prescriptions,
    estimates,
    bills,
    appointments,
    followUps,
  ] = await Promise.all([
    Visit.find({ clinicId: clinicObjectId, patientId: patientObjectId }).lean(),
    CaseSheet.find({ clinicId: clinicObjectId, patientId: patientObjectId }).lean(),
    Prescription.find({ clinicId: clinicObjectId, patientId: patientObjectId }).lean(),
    Estimate.find({ clinicId: clinicObjectId, patientId: patientObjectId }).lean(),
    Bill.find({ clinicId: clinicObjectId, patientId: patientObjectId }).lean(),
    Appointment.find({ clinicId: clinicObjectId, patientId: patientObjectId }).lean(),
    FollowUp.find({ clinicId: clinicObjectId, patientId: patientObjectId }).lean(),
  ]);

  // Fetch payments for all bills belonging to this patient
  const billIds = bills.map((b) => b._id);
  const payments =
    billIds.length > 0
      ? await Payment.find({ clinicId: clinicObjectId, billId: { $in: billIds } }).lean()
      : [];

  const rawItems: TimelineItem[] = [];

  // Map Visits
  for (const v of visits) {
    const ts = (v.createdAt || clock.now()).toISOString();
    const sub = `Status: ${v.status} • Clinic Date: ${v.date || ''}`;
    rawItems.push({
      id: v._id.toString(),
      type: 'VISIT',
      timestamp: ts,
      date: ts,
      title: `Visit Token #${v.token}`,
      subtitle: sub,
      summary: sub,
      status: v.status,
      badge: v.status,
      linkUrl: `/consult/${v._id}`,
      link: `/consult/${v._id}`,
    });
  }

  // Map Case Sheets
  for (const cs of caseSheets) {
    const ts = (cs.createdAt || clock.now()).toISOString();
    const sub = cs.diagnosis ? `Diagnosis: ${cs.diagnosis}` : 'Clinical Findings';
    rawItems.push({
      id: cs._id.toString(),
      type: 'CASE_SHEET',
      timestamp: ts,
      date: ts,
      title: `Case Sheet • ${cs.chiefComplaint || 'Clinical Findings'}`,
      subtitle: sub,
      summary: sub,
      linkUrl: `/consult/${cs.visitId}`,
      link: `/consult/${cs.visitId}`,
    });
  }

  // Map Prescriptions
  for (const rx of prescriptions) {
    const ts = (rx.createdAt || rx.date || clock.now()).toISOString();
    const isVoid = rx.status === 'VOID';
    const sub = isVoid
      ? `VOID: ${rx.voidReason || 'Cancelled prescription'}`
      : `${rx.items?.length || 0} medication(s) prescribed`;

    rawItems.push({
      id: rx._id.toString(),
      type: 'PRESCRIPTION',
      timestamp: ts,
      date: ts,
      title: `Prescription ${rx.rxNumber || 'Draft'}`,
      subtitle: sub,
      summary: sub,
      status: rx.status,
      badge: rx.status,
      isVoid,
      linkUrl: `/print/prescription/${rx._id}`,
      link: `/print/prescription/${rx._id}`,
    });
  }

  // Map Estimates
  for (const est of estimates) {
    const ts = (est.createdAt || clock.now()).toISOString();
    const sub = `Total: ₹${(est.total / 100).toFixed(2)} (${est.status})`;
    rawItems.push({
      id: est._id.toString(),
      type: 'ESTIMATE',
      timestamp: ts,
      date: ts,
      title: `Estimate ${est.estimateNo || 'Draft'}`,
      subtitle: sub,
      summary: sub,
      status: est.status,
      badge: est.status,
      amountPaise: est.total,
      linkUrl: `/print/estimate/${est._id}`,
      link: `/print/estimate/${est._id}`,
    });
  }

  // Map Bills
  for (const b of bills) {
    const ts = (b.createdAt || clock.now()).toISOString();
    const sub = `Total: ₹${(b.total / 100).toFixed(2)} • Paid: ₹${(b.paid / 100).toFixed(2)} • Balance: ₹${(b.balance / 100).toFixed(2)} (${b.status})`;
    rawItems.push({
      id: b._id.toString(),
      type: 'BILL',
      timestamp: ts,
      date: ts,
      title: `Bill ${b.billNo}`,
      subtitle: sub,
      summary: sub,
      status: b.status,
      badge: b.status,
      amountPaise: b.total,
      linkUrl: `/print/bill/${b._id}`,
      link: `/print/bill/${b._id}`,
    });
  }

  // Map Payments & Reversals
  for (const p of payments) {
    const ts = (p.createdAt || p.receivedAt || clock.now()).toISOString();
    const sub = `${p.method} • ${p.isReversal ? '-' : '+'}₹${(Math.abs(p.amount) / 100).toFixed(2)}`;
    rawItems.push({
      id: p._id.toString(),
      type: p.isReversal ? 'REVERSAL' : 'PAYMENT',
      timestamp: ts,
      date: ts,
      title: p.isReversal ? `Payment Reversal ${p.receiptNo}` : `Payment Received ${p.receiptNo}`,
      subtitle: sub,
      summary: sub,
      status: p.isReversal ? 'REVERSED' : 'COMPLETED',
      badge: p.isReversal ? 'REVERSED' : 'COMPLETED',
      isReversal: p.isReversal,
      amountPaise: p.amount,
      linkUrl: `/print/receipt/${p._id}`,
      link: `/print/receipt/${p._id}`,
    });
  }

  // Map Appointments
  for (const a of appointments) {
    const ts = (a.createdAt || clock.now()).toISOString();
    const sub = `${a.clinicDate} • ${a.reason || 'General Consultation'}`;
    rawItems.push({
      id: a._id.toString(),
      type: 'APPOINTMENT',
      timestamp: ts,
      date: ts,
      title: `Appointment (${a.status})`,
      subtitle: sub,
      summary: sub,
      status: a.status,
      badge: a.status,
      linkUrl: `/appointments`,
      link: `/appointments`,
    });
  }

  // Map FollowUps
  for (const f of followUps) {
    const ts = (f.createdAt || clock.now()).toISOString();
    const sub = `Due: ${f.dueDate} • Reason: ${f.reason}`;
    rawItems.push({
      id: f._id.toString(),
      type: 'FOLLOW_UP',
      timestamp: ts,
      date: ts,
      title: `Follow-up (${f.status})`,
      subtitle: sub,
      summary: sub,
      status: f.status,
      badge: f.status,
      linkUrl: `/followups`,
      link: `/followups`,
    });
  }

  // Sort descending by timestamp, tie-break by ID
  rawItems.sort((a, b) => {
    if (b.timestamp !== a.timestamp) {
      return b.timestamp.localeCompare(a.timestamp);
    }
    return b.id.localeCompare(a.id);
  });

  // Apply cursor filtering if provided
  let filtered = rawItems;
  if (cursor) {
    filtered = rawItems.filter((item) => item.timestamp < cursor);
  }

  const pageItems = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const nextCursor = hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1].timestamp : null;

  return {
    items: pageItems,
    nextCursor,
    hasMore,
  };
}
