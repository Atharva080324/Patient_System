import { Types } from 'mongoose';
import { Visit } from '../models/Visit';
import { Appointment } from '../models/Appointment';
import { FollowUp } from '../models/FollowUp';
import { Bill } from '../models/Bill';
import { Payment } from '../models/Payment';
import { collectionsForDay } from './payment-service';
import { startOfClinicDay, endOfClinicDay, clinicDate } from './date';
import { clock } from './clock';
import { getTenantContext, runWithTenantContext, TenantActor } from './tenancy';

export interface DashboardCardStats {
  registeredPatients: number;
  waiting: number;
  inConsultation: number;
  completed: number;
  noShowSkippedCancelled: number;
  appointmentsBooked: number;
  appointmentsCheckedIn: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
  collectionsToday: number; // in paise
  outstandingBalance: number; // in paise
}

export interface DashboardAppointmentItem {
  _id: string;
  patientName: string;
  phone: string;
  timeStr: string;
  status: string;
  reason?: string;
  patientId?: string;
}

export interface DashboardFollowUpItem {
  _id: string;
  patientName: string;
  phone: string;
  dueDateStr: string;
  status: string;
  notes?: string;
}

export interface DashboardBillingSummary {
  billedToday: number;
  collectedToday: number;
  methodsToday: {
    CASH: number;
    UPI: number;
    CARD: number;
    NET_BANKING: number;
    OTHER: number;
  };
  outstandingTotal: number;
  billedMonth: number;
  collectedMonth: number;
}

export interface DashboardQueueSummary {
  totalActive: number;
  waiting: number;
  inConsultation: number;
  nextTicketNumber?: number;
}

export interface DashboardData {
  clinicDate: string;
  todayDate?: string;
  cards: DashboardCardStats;
  appointments: DashboardAppointmentItem[];
  followUps: DashboardFollowUpItem[];
  billingSummary: DashboardBillingSummary;
  queueSummary: DashboardQueueSummary;
  panels?: {
    appointments: DashboardAppointmentItem[];
    followUps: DashboardFollowUpItem[];
    billing: DashboardBillingSummary;
    queue: any[];
  };
  generatedAt: string;
  lastUpdated?: string;
}

export async function getDashboardData(
  clinicId: Types.ObjectId | string,
  targetDate?: string,
  actor?: TenantActor
): Promise<DashboardData> {
  const clinicObjectId = clinicId instanceof Types.ObjectId ? clinicId : new Types.ObjectId(String(clinicId));

  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    const act = actor || { type: 'USER' as const, id: 'dashboard-service' };
    return runWithTenantContext({ clinicId: clinicObjectId, actor: act }, () =>
      getDashboardData(clinicObjectId, targetDate, act)
    );
  }

  const today = targetDate || clinicDate(clock.now());
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthStartTime = startOfClinicDay(monthStart);
  const todayStartTime = startOfClinicDay(today);
  const todayEndTime = endOfClinicDay(today);

  // Parallel indexed queries
  const [
    visitAggregation,
    apptCounts,
    todayAppts,
    followUpDueTodayCount,
    followUpOverdueCount,
    pendingFollowUps,
    collectionsTodayResult,
    outstandingBalanceAgg,
    billedTodayAgg,
    billedMonthAgg,
    monthPayments,
    queueVisits,
  ] = await Promise.all([
    // 1. Visit breakdown today by status
    Visit.aggregate([
      { $match: { clinicId: clinicObjectId, date: today } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    // 2. Appointment counts today
    Appointment.aggregate([
      { $match: { clinicId: clinicObjectId, clinicDate: today } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    // 3. Appointments list today
    Appointment.find({ clinicId: clinicObjectId, clinicDate: today })
      .populate('patientId', 'name phone patientCode')
      .sort({ start: 1 })
      .limit(30)
      .lean(),

    // 4. Follow-ups due today
    FollowUp.countDocuments({
      clinicId: clinicObjectId,
      status: 'PENDING',
      dueDate: today,
    }),

    // 5. Follow-ups overdue
    FollowUp.countDocuments({
      clinicId: clinicObjectId,
      status: 'PENDING',
      dueDate: { $lt: today },
    }),

    // 6. Follow-up list for panel
    FollowUp.find({
      clinicId: clinicObjectId,
      status: 'PENDING',
      dueDate: { $lte: today },
    })
      .populate('patientId', 'name phone patientCode')
      .sort({ dueDate: 1 })
      .limit(20)
      .lean(),

    // 7. Collections today via collectionsForDay (net of reversals)
    collectionsForDay(clinicObjectId, today),

    // 8. Total outstanding balance across all non-cancelled bills
    Bill.aggregate([
      {
        $match: {
          clinicId: clinicObjectId,
          status: { $ne: 'CANCELLED' },
          balance: { $gt: 0 },
        },
      },
      { $group: { _id: null, total: { $sum: '$balance' } } },
    ]),

    // 9. Billed today
    Bill.aggregate([
      {
        $match: {
          clinicId: clinicObjectId,
          createdAt: { $gte: todayStartTime, $lte: todayEndTime },
          status: { $ne: 'CANCELLED' },
        },
      },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),

    // 10. Billed this month
    Bill.aggregate([
      {
        $match: {
          clinicId: clinicObjectId,
          createdAt: { $gte: monthStartTime, $lte: todayEndTime },
          status: { $ne: 'CANCELLED' },
        },
      },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),

    // 11. Month payments
    Payment.find({
      clinicId: clinicObjectId,
      receivedAt: { $gte: monthStartTime, $lte: todayEndTime },
    })
      .select('amount method isReversal')
      .lean(),

    // 12. Active queue visits today
    Visit.find({
      clinicId: clinicObjectId,
      date: today,
      status: { $in: ['WAITING', 'IN_CONSULTATION', 'SKIPPED'] },
    })
      .populate('patientId', 'name')
      .sort({ token: 1 })
      .limit(30)
      .lean(),
  ]);

  // Aggregate visit counts
  let totalRegistered = 0;
  let waiting = 0;
  let inConsultation = 0;
  let completed = 0;
  let noShowSkippedCancelled = 0;

  for (const v of visitAggregation) {
    totalRegistered += v.count;
    if (v._id === 'WAITING' || v._id === 'SKIPPED') {
      waiting += v.count;
    } else if (v._id === 'IN_CONSULTATION') {
      inConsultation += v.count;
    } else if (v._id === 'COMPLETED') {
      completed += v.count;
    } else if (v._id === 'NO_SHOW' || v._id === 'CANCELLED') {
      noShowSkippedCancelled += v.count;
    }
  }

  // Aggregate appointment counts
  let appointmentsBooked = 0;
  let appointmentsCheckedIn = 0;
  for (const a of apptCounts) {
    if (a._id === 'BOOKED') appointmentsBooked += a.count;
    if (a._id === 'CHECKED_IN') appointmentsCheckedIn += a.count;
  }

  // Monthly collected total
  let collectedMonth = 0;
  for (const p of monthPayments) {
    collectedMonth += p.amount;
  }

  const outstandingTotal = outstandingBalanceAgg[0]?.total || 0;
  const billedToday = billedTodayAgg[0]?.total || 0;
  const billedMonth = billedMonthAgg[0]?.total || 0;

  // Format appointments for panel
  const formattedAppointments: DashboardAppointmentItem[] = todayAppts.map((a: any) => {
    const startDate = new Date(a.start);
    const timeStr = startDate.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
    const patientObj = a.patientId as any;

    return {
      _id: a._id.toString(),
      patientName: patientObj?.name || a.contactName || 'Patient',
      phone: patientObj?.phone || a.contactPhone || '',
      timeStr,
      status: a.status,
      reason: a.reason,
      patientId: patientObj?._id ? patientObj._id.toString() : undefined,
    };
  });

  // Format follow-ups for panel
  const formattedFollowUps: DashboardFollowUpItem[] = pendingFollowUps.map((f: any) => {
    const p = f.patientId as any;
    return {
      _id: f._id.toString(),
      patientName: p?.name || 'Patient',
      phone: p?.phone || '',
      dueDateStr: f.dueDate,
      status: f.status,
      notes: f.reason || f.notes,
    };
  });

  // Format queue summary
  let nextTicketNumber: number | undefined;
  const waitingVisits = queueVisits.filter((v: any) => v.status === 'WAITING');
  if (waitingVisits.length > 0) {
    nextTicketNumber = waitingVisits[0].token;
  }

  const cards: DashboardCardStats = {
    registeredPatients: totalRegistered,
    waiting,
    inConsultation,
    completed,
    noShowSkippedCancelled,
    appointmentsBooked,
    appointmentsCheckedIn,
    followUpsDueToday: followUpDueTodayCount,
    followUpsOverdue: followUpOverdueCount,
    collectionsToday: collectionsTodayResult.netTotal,
    outstandingBalance: outstandingTotal,
  };

  const billingSummary: DashboardBillingSummary = {
    billedToday,
    collectedToday: collectionsTodayResult.netTotal,
    methodsToday: {
      CASH: collectionsTodayResult.cash,
      UPI: collectionsTodayResult.upi,
      CARD: 0,
      NET_BANKING: 0,
      OTHER: 0,
    },
    outstandingTotal,
    billedMonth,
    collectedMonth,
  };

  const queueSummary: DashboardQueueSummary = {
    totalActive: queueVisits.length,
    waiting,
    inConsultation,
    nextTicketNumber,
  };

  return {
    clinicDate: today,
    todayDate: today,
    generatedAt: clock.now().toISOString(),
    lastUpdated: clock.now().toISOString(),
    cards,
    appointments: formattedAppointments,
    followUps: formattedFollowUps,
    billingSummary,
    queueSummary,
    panels: {
      appointments: formattedAppointments,
      followUps: formattedFollowUps,
      billing: billingSummary,
      queue: queueVisits,
    },
  };
}
