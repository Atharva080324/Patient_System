import { Types } from 'mongoose';
import { Visit } from '../models/Visit';
import { startOfClinicDay, endOfClinicDay, clinicDate } from './date';
import { clock } from './clock';

export interface ClosingReportData {
  clinicDate: string;
  generatedAt: string;
  totalRegistered: number;
  completed: number;
  skipped: number;
  noShow: number;
  cancelled: number;
  stillWaiting: number;
  firstToken: number | null;
  lastToken: number | null;
  averageWaitMinutes: number;
  longestWaitMinutes: number;
  reconciliation: {
    rawVisitCount: number;
    sumOfCategories: number;
    isReconciled: boolean;
  };
}

export async function generateClosingReport(
  clinicId: Types.ObjectId | string,
  targetDate = clinicDate(clock.now())
): Promise<ClosingReportData> {
  const cId = typeof clinicId === 'string' ? new Types.ObjectId(clinicId) : clinicId;
  const startUtc = startOfClinicDay(targetDate);
  const endUtc = endOfClinicDay(targetDate);

  // Fetch all visits with checkInAt within clinic day boundaries
  const visits = await Visit.find({
    clinicId: cId,
    checkInAt: { $gte: startUtc, $lte: endUtc },
  })
    .select('token status checkInAt startedAt completedAt')
    .sort({ token: 1 })
    .lean();

  const rawVisitCount = await Visit.countDocuments({
    clinicId: cId,
    checkInAt: { $gte: startUtc, $lte: endUtc },
  });

  let completed = 0;
  let skipped = 0;
  let noShow = 0;
  let cancelled = 0;
  let stillWaiting = 0;

  let firstToken: number | null = null;
  let lastToken: number | null = null;

  let totalWaitMinutes = 0;
  let waitSampleCount = 0;
  let longestWaitMinutes = 0;

  for (const visit of visits) {
    if (firstToken === null || visit.token < firstToken) {
      firstToken = visit.token;
    }
    if (lastToken === null || visit.token > lastToken) {
      lastToken = visit.token;
    }

    const checkIn = new Date(visit.checkInAt);
    let waitMinutes = 0;

    if (visit.startedAt) {
      waitMinutes = Math.max(0, Math.floor((new Date(visit.startedAt).getTime() - checkIn.getTime()) / 60000));
    } else if (visit.completedAt) {
      waitMinutes = Math.max(0, Math.floor((new Date(visit.completedAt).getTime() - checkIn.getTime()) / 60000));
    } else {
      waitMinutes = Math.max(0, Math.floor((clock.now().getTime() - checkIn.getTime()) / 60000));
    }

    switch (visit.status) {
      case 'COMPLETED':
        completed++;
        totalWaitMinutes += waitMinutes;
        waitSampleCount++;
        if (waitMinutes > longestWaitMinutes) longestWaitMinutes = waitMinutes;
        break;
      case 'SKIPPED':
        skipped++;
        break;
      case 'NO_SHOW':
        noShow++;
        break;
      case 'CANCELLED':
        cancelled++;
        break;
      case 'WAITING':
      case 'IN_CONSULTATION':
      default:
        stillWaiting++;
        totalWaitMinutes += waitMinutes;
        waitSampleCount++;
        if (waitMinutes > longestWaitMinutes) longestWaitMinutes = waitMinutes;
        break;
    }
  }

  const averageWaitMinutes =
    waitSampleCount > 0 ? Math.round(totalWaitMinutes / waitSampleCount) : 0;

  const totalRegistered = visits.length;
  const sumOfCategories = completed + skipped + noShow + cancelled + stillWaiting;
  const isReconciled = totalRegistered === rawVisitCount && sumOfCategories === totalRegistered;

  return {
    clinicDate: targetDate,
    generatedAt: clock.now().toISOString(),
    totalRegistered,
    completed,
    skipped,
    noShow,
    cancelled,
    stillWaiting,
    firstToken,
    lastToken,
    averageWaitMinutes,
    longestWaitMinutes,
    reconciliation: {
      rawVisitCount,
      sumOfCategories,
      isReconciled,
    },
  };
}
