import { endOfClinicDay } from './date';
import { clock } from './clock';

export type EstimateStatus = 'DRAFT' | 'ISSUED' | 'CONVERTED' | 'CANCELLED';

export type EstimateAction = 'ISSUE' | 'CONVERT' | 'CANCEL';

export class EstimateStateTransitionError extends Error {
  public statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'EstimateStateTransitionError';
  }
}

const ALLOWED_TRANSITIONS: Record<EstimateStatus, Partial<Record<EstimateAction, EstimateStatus>>> = {
  DRAFT: {
    ISSUE: 'ISSUED',
    CANCEL: 'CANCELLED',
  },
  ISSUED: {
    CONVERT: 'CONVERTED',
    CANCEL: 'CANCELLED',
  },
  CONVERTED: {},
  CANCELLED: {},
};

export function canTransitionEstimate(current: EstimateStatus, action: EstimateAction): boolean {
  return Boolean(ALLOWED_TRANSITIONS[current]?.[action]);
}

export function transitionEstimate(current: EstimateStatus, action: EstimateAction): EstimateStatus {
  const next = ALLOWED_TRANSITIONS[current]?.[action];
  if (!next) {
    throw new EstimateStateTransitionError(
      `Cannot perform action ${action} on estimate with status ${current}`
    );
  }
  return next;
}

/**
 * Computes whether an estimate has expired based on validUntil string (YYYY-MM-DD)
 * evaluated at the end of the day (23:59:59.999) in Asia/Kolkata timezone.
 * Never stored as a stale value.
 */
export function isEstimateExpired(validUntilDateStr?: string | null, now: Date = clock.now()): boolean {
  if (!validUntilDateStr) return false;
  try {
    const expiryMoment = endOfClinicDay(validUntilDateStr);
    return now.getTime() > expiryMoment.getTime();
  } catch {
    return false;
  }
}
