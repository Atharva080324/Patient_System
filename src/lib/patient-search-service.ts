import { Types } from 'mongoose';
import { Patient, IPatient } from '../models/Patient';
import { Visit } from '../models/Visit';
import { Bill } from '../models/Bill';
import { FollowUp } from '../models/FollowUp';
import { assertPlainInput, NoSqlInjectionError } from './validation';
import { getTenantContext, runWithTenantContext, TenantActor } from './tenancy';

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface PatientSearchOptions {
  clinicId?: string | Types.ObjectId;
  q?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
  sortBy?: 'name' | 'patientCode' | 'lastVisit' | 'createdAt' | 'registeredAt';
  sortOrder?: 'asc' | 'desc';
  lastVisitFrom?: string; // YYYY-MM-DD
  lastVisitTo?: string; // YYYY-MM-DD
  hasBalance?: boolean;
  hasFollowUp?: boolean;
  hasFollowUpDue?: boolean;
  source?: 'WALK_IN' | 'WEBSITE' | 'WHATSAPP' | 'MANUAL';
}

export interface PatientListItem {
  _id: string;
  patientCode: string;
  name: string;
  ageYears?: number;
  dob?: string;
  sex: 'Male' | 'Female' | 'Other';
  phone: string;
  source: string;
  allergies: string[];
  createdAt: string;
  registeredAt: string;
  lastVisitDate: string | null;
  visitCount: number;
  outstandingBalancePaise: number;
  outstandingBalance: number;
  possibleDuplicateOf?: string;
  duplicateDismissed?: boolean;
}

export interface PatientSearchResponse {
  patients: PatientListItem[];
  total: number;
  page: number;
  totalPages: number;
}

export function buildSearchFilter(q: string): Record<string, unknown> {
  const trimmed = q.trim();
  if (!trimmed) return {};

  const clauses: Record<string, unknown>[] = [];
  const escaped = escapeRegex(trimmed);

  // 1. Name query (anchored prefix on searchName or prefix of word)
  const normName = trimmed.toLowerCase().replace(/\s+/g, ' ');
  const escapedNormName = escapeRegex(normName);
  clauses.push({ searchName: new RegExp(`(^|\\s)${escapedNormName}`, 'i') });

  // 2. Phone query: check if input contains digits
  const rawDigits = trimmed.replace(/\D/g, '');
  if (rawDigits.length >= 4) {
    let cleanPhone = rawDigits;
    if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
      cleanPhone = cleanPhone.slice(2);
    } else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
      cleanPhone = cleanPhone.slice(1);
    }

    if (cleanPhone.length >= 10) {
      clauses.push({ phone: cleanPhone.slice(-10) });
    } else {
      // 4 or more digits: match suffix or contains
      clauses.push({ phone: new RegExp(`${escapeRegex(cleanPhone)}$`) });
    }
  }

  // 3. Patient code query: e.g. "P-000123", "p-123", "123"
  if (/^p?-?\d+$/i.test(trimmed)) {
    const codeNum = rawDigits.replace(/^0+/, '');
    if (codeNum) {
      clauses.push({ patientCode: new RegExp(`^P-0*${codeNum}$`, 'i') });
    } else {
      clauses.push({ patientCode: new RegExp(`^${escaped}$`, 'i') });
    }
  } else {
    clauses.push({ patientCode: new RegExp(`^${escaped}$`, 'i') });
  }

  return { $or: clauses };
}

export async function searchPatients(
  arg1: Types.ObjectId | string | PatientSearchOptions,
  arg2: PatientSearchOptions = {},
  arg3?: TenantActor
): Promise<PatientSearchResponse> {
  let clinicIdRaw: Types.ObjectId | string;
  let options: PatientSearchOptions;
  const actor: TenantActor | undefined = arg3;

  if (typeof arg1 === 'object' && !('toHexString' in arg1) && !('_bsontype' in arg1) && 'clinicId' in arg1) {
    clinicIdRaw = arg1.clinicId!;
    options = arg1;
  } else {
    clinicIdRaw = arg1 as (Types.ObjectId | string);
    options = arg2;
  }

  const clinicObjectId =
    clinicIdRaw instanceof Types.ObjectId ? clinicIdRaw : new Types.ObjectId(String(clinicIdRaw));

  const currentCtx = getTenantContext();
  if (!currentCtx || currentCtx.clinicId.toString() !== clinicObjectId.toString()) {
    const act = actor || { type: 'USER' as const, id: 'search-service' };
    return runWithTenantContext({ clinicId: clinicObjectId, actor: act }, () =>
      searchPatients(clinicObjectId, options, act)
    );
  }

  // Validate plain input on query string
  if (options.q !== undefined && options.q !== null) {
    if (typeof options.q === 'object') {
      assertPlainInput(options.q);
      throw new Error('Search query must be a string');
    }
    if (typeof options.q === 'string') {
      if (options.q.trim().startsWith('{') && options.q.includes('$')) {
        try {
          const parsed = JSON.parse(options.q);
          assertPlainInput(parsed);
        } catch {
          throw new NoSqlInjectionError('Illegal operator payload detected in search query');
        }
      }
    }
  }

  const page = Math.max(1, options.page || 1);
  const limit = Math.max(1, Math.min(100, options.limit || 25));
  const sortBy = options.sortBy || 'createdAt';
  const sortOrder = options.sortOrder === 'asc' ? 1 : -1;

  // Base tenant query
  const query: Record<string, unknown> = {
    clinicId: clinicObjectId,
    deletedAt: null,
  };

  if (options.source) {
    query.source = options.source;
  }

  // Text search clauses
  if (options.q && options.q.trim()) {
    const searchFilter = buildSearchFilter(options.q);
    Object.assign(query, searchFilter);
  }

  // Filter: has outstanding balance
  if (options.hasBalance) {
    const debtors = await Bill.distinct('patientId', {
      clinicId: clinicObjectId,
      status: { $ne: 'CANCELLED' },
      balance: { $gt: 0 },
    });
    query._id = { $in: debtors };
  }

  // Filter: has follow-up due or overdue
  if (options.hasFollowUp) {
    const followUpPatientIds = await FollowUp.distinct('patientId', {
      clinicId: clinicObjectId,
      status: 'PENDING',
    });
    if (query._id) {
      const existing = (query._id as { $in: Types.ObjectId[] }).$in;
      query._id = { $in: existing.filter((id) => followUpPatientIds.some((f) => f.equals(id))) };
    } else {
      query._id = { $in: followUpPatientIds };
    }
  }

  // Filter: last visit date range
  if (options.lastVisitFrom || options.lastVisitTo) {
    const visitMatch: Record<string, unknown> = { clinicId: clinicObjectId };
    if (options.lastVisitFrom && options.lastVisitTo) {
      visitMatch.clinicDate = { $gte: options.lastVisitFrom, $lte: options.lastVisitTo };
    } else if (options.lastVisitFrom) {
      visitMatch.clinicDate = { $gte: options.lastVisitFrom };
    } else if (options.lastVisitTo) {
      visitMatch.clinicDate = { $lte: options.lastVisitTo };
    }

    const patientIdsWithVisits = await Visit.distinct('patientId', visitMatch);
    if (query._id) {
      const existing = (query._id as { $in: Types.ObjectId[] }).$in;
      query._id = { $in: existing.filter((id) => patientIdsWithVisits.some((v) => v.equals(id))) };
    } else {
      query._id = { $in: patientIdsWithVisits };
    }
  }

  // Count total matching patients
  const total = await Patient.countDocuments(query);
  const totalPages = Math.ceil(total / limit) || 1;

  // Build mongo sort
  let sortDoc: Record<string, 1 | -1> = { createdAt: -1 };
  if (sortBy === 'name') {
    sortDoc = { searchName: sortOrder, _id: 1 };
  } else if (sortBy === 'patientCode') {
    sortDoc = { patientCode: sortOrder, _id: 1 };
  } else if (sortBy === 'createdAt') {
    sortDoc = { createdAt: sortOrder, _id: 1 };
  }

  const rawPatients: IPatient[] = await Patient.find(query)
    .sort(sortDoc)
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  if (rawPatients.length === 0) {
    return {
      patients: [],
      total,
      page,
      totalPages,
    };
  }

  const patientIds = rawPatients.map((p) => p._id);

  // Parallel enrichment for current page of 25 patients
  const [visitStats, billStats] = await Promise.all([
    Visit.aggregate([
      { $match: { clinicId: clinicObjectId, patientId: { $in: patientIds } } },
      {
        $group: {
          _id: '$patientId',
          count: { $sum: 1 },
          lastVisit: { $max: '$clinicDate' },
        },
      },
    ]),
    Bill.aggregate([
      {
        $match: {
          clinicId: clinicObjectId,
          patientId: { $in: patientIds },
          status: { $ne: 'CANCELLED' },
          balance: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: '$patientId',
          totalBalance: { $sum: '$balance' },
        },
      },
    ]),
  ]);

  const visitMap = new Map<string, { count: number; lastVisit: string | null }>();
  for (const v of visitStats) {
    visitMap.set(v._id.toString(), { count: v.count, lastVisit: v.lastVisit || null });
  }

  const billMap = new Map<string, number>();
  for (const b of billStats) {
    billMap.set(b._id.toString(), b.totalBalance || 0);
  }

  const items: PatientListItem[] = rawPatients.map((p) => {
    const v = visitMap.get(p._id.toString()) || { count: 0, lastVisit: null };
    const bal = billMap.get(p._id.toString()) || 0;

    return {
      _id: p._id.toString(),
      patientCode: p.patientCode,
      name: p.name,
      ageYears: p.ageYears,
      dob: p.dob,
      sex: p.sex,
      phone: p.phone,
      source: p.source,
      allergies: p.medicalHistory?.allergies || [],
      createdAt: p.createdAt.toISOString(),
      registeredAt: p.createdAt.toISOString(),
      lastVisitDate: v.lastVisit,
      visitCount: v.count,
      outstandingBalancePaise: bal,
      outstandingBalance: bal,
      possibleDuplicateOf: p.possibleDuplicateOf?.toString(),
      duplicateDismissed: !!p.duplicateDismissed,
    };
  });

  // Handle in-memory sort if requested by lastVisit
  if (sortBy === 'lastVisit') {
    items.sort((a, b) => {
      const aVal = a.lastVisitDate || '';
      const bVal = b.lastVisitDate || '';
      return sortOrder === 1 ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }

  return {
    patients: items,
    total,
    page,
    totalPages,
  };
}
