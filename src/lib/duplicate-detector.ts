import { Types } from 'mongoose';
import { Patient } from '../models/Patient';

export interface ExistingPatientCandidate {
  _id: string;
  patientCode: string;
  name: string;
  phone: string;
  ageYears?: number;
  dob?: string;
}

export interface NewPatientInput {
  name: string;
  phone: string;
  ageYears?: number;
  dob?: string;
}

export type DuplicateAction = 'NEW_PATIENT' | 'RETURNING_PATIENT';
export type DuplicateReason =
  | 'NO_PHONE_MATCH'
  | 'EXACT_OR_HIGH_NAME_MATCH'
  | 'FAMILY_SHARED_PHONE'
  | 'POSSIBLE_DUPLICATE_FLAG';

export interface DuplicateDecision {
  action: DuplicateAction;
  matchedPatientId?: string;
  matchedPatientCode?: string;
  possibleDuplicateOfId?: string;
  possibleDuplicateOfCode?: string;
  reason: DuplicateReason;
  similarityScore: number;
}

export function normalizePhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

const HONORIFICS_REGEX = /^(dr|mr|mrs|ms|shri|smt|miss|master)\.?\s+/i;

export function normalizeName(rawName: string): string {
  let cleaned = rawName.trim().toLowerCase();
  cleaned = cleaned.replace(HONORIFICS_REGEX, '');
  cleaned = cleaned.replace(/[^a-z0-9\s]/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

/**
 * Jaro distance between two strings (0.0 to 1.0)
 */
export function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) {
      k++;
    }
    if (s1[i] !== s2[k]) {
      transpositions++;
    }
    k++;
  }

  return (
    (matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches) /
    3.0
  );
}

/**
 * Jaro-Winkler distance with standard prefix scaling factor p = 0.1
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2);
  if (jaro < 0.7) return jaro;

  let prefixLength = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));

  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLength++;
    } else {
      break;
    }
  }

  const p = 0.1;
  return Number((jaro + prefixLength * p * (1 - jaro)).toFixed(4));
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshteinDistance(a, b);
  return (maxLen - dist) / maxLen;
}

export function evaluateDuplicate(
  input: NewPatientInput,
  candidates: ExistingPatientCandidate[]
): DuplicateDecision {
  const normInputPhone = normalizePhone(input.phone);
  const normInputName = normalizeName(input.name);

  const phoneMatches = candidates.filter(
    (c) => normalizePhone(c.phone) === normInputPhone
  );

  if (phoneMatches.length === 0) {
    return {
      action: 'NEW_PATIENT',
      reason: 'NO_PHONE_MATCH',
      similarityScore: 0,
    };
  }

  // Find candidate with highest name similarity
  let bestCandidate: ExistingPatientCandidate | null = null;
  let bestScore = -1;

  for (const candidate of phoneMatches) {
    const candidateNormName = normalizeName(candidate.name);
    const score = jaroWinklerSimilarity(normInputName, candidateNormName);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return {
      action: 'NEW_PATIENT',
      reason: 'FAMILY_SHARED_PHONE',
      similarityScore: 0,
    };
  }

  const inputTokens = normInputName.split(' ').filter(Boolean);
  const candidateTokens = normalizeName(bestCandidate.name).split(' ').filter(Boolean);
  const inputFirstName = inputTokens[0] || '';
  const candidateFirstName = candidateTokens[0] || '';
  const firstTokenSim = tokenSimilarity(inputFirstName, candidateFirstName);

  // Clearly different first name: family members sharing phone (e.g. parent, child, spouse)
  if (firstTokenSim < 0.6) {
    return {
      action: 'NEW_PATIENT',
      reason: 'FAMILY_SHARED_PHONE',
      similarityScore: bestScore,
    };
  }

  // Check age/dob compatibility if both candidate and input have age or dob
  let ageMismatch = false;
  if (
    input.ageYears !== undefined &&
    bestCandidate.ageYears !== undefined &&
    Math.abs(input.ageYears - bestCandidate.ageYears) >= 8
  ) {
    ageMismatch = true;
  }
  if (
    input.dob &&
    bestCandidate.dob &&
    input.dob !== bestCandidate.dob
  ) {
    ageMismatch = true;
  }

  // High similarity match: returning patient
  if (bestScore >= 0.88 && !ageMismatch) {
    return {
      action: 'RETURNING_PATIENT',
      matchedPatientId: bestCandidate._id,
      matchedPatientCode: bestCandidate.patientCode,
      reason: 'EXACT_OR_HIGH_NAME_MATCH',
      similarityScore: bestScore,
    };
  }

  // Clearly different overall name (< 0.60)
  if (bestScore < 0.6) {
    return {
      action: 'NEW_PATIENT',
      reason: 'FAMILY_SHARED_PHONE',
      similarityScore: bestScore,
    };
  }

  // Moderate similarity (0.60 <= bestScore < 0.88) or age mismatch on high similarity
  return {
    action: 'NEW_PATIENT',
    possibleDuplicateOfId: bestCandidate._id,
    possibleDuplicateOfCode: bestCandidate.patientCode,
    reason: 'POSSIBLE_DUPLICATE_FLAG',
    similarityScore: bestScore,
  };
}

export async function detectDuplicate(
  clinicId: Types.ObjectId,
  input: { name: string; phone: string; ageYears?: number; dob?: string }
): Promise<{
  matchType: 'NEW_PATIENT' | 'RETURNING_PATIENT';
  existingPatientId?: string;
  existingPatientCode?: string;
  possibleDuplicateOf?: string;
  reason: string;
}> {
  const normalizedPhone = normalizePhone(input.phone);
  const existingPatients = await Patient.find({
    clinicId,
    phone: normalizedPhone,
    deletedAt: { $exists: false },
  })
    .select('_id patientCode name phone ageYears dob')
    .lean();

  const decision = evaluateDuplicate(
    input,
    existingPatients.map((p) => ({
      _id: p._id.toString(),
      patientCode: p.patientCode,
      name: p.name,
      phone: p.phone,
      ageYears: p.ageYears,
      dob: p.dob,
    }))
  );

  return {
    matchType: decision.action,
    existingPatientId: decision.matchedPatientId,
    existingPatientCode: decision.matchedPatientCode,
    possibleDuplicateOf: decision.possibleDuplicateOfId,
    reason: decision.reason,
  };
}

