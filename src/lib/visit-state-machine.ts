export type VisitState =
  | 'WAITING'
  | 'IN_CONSULTATION'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'NO_SHOW'
  | 'CANCELLED';

export type VisitAction =
  | 'CALL_IN'
  | 'COMPLETE'
  | 'SKIP'
  | 'SEND_BACK'
  | 'NO_SHOW'
  | 'CANCEL';

export const TERMINAL_STATES: readonly VisitState[] = [
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;

export const ALLOWED_TRANSITIONS: Record<VisitState, readonly VisitState[]> = {
  WAITING: ['IN_CONSULTATION', 'SKIPPED', 'NO_SHOW', 'CANCELLED'],
  SKIPPED: ['WAITING', 'IN_CONSULTATION', 'NO_SHOW', 'CANCELLED'],
  IN_CONSULTATION: ['COMPLETED', 'WAITING'],
  COMPLETED: [],
  NO_SHOW: [],
  CANCELLED: [],
};

export const ACTION_TRANSITIONS: Record<VisitState, Partial<Record<VisitAction, VisitState>>> = {
  WAITING: {
    CALL_IN: 'IN_CONSULTATION',
    SKIP: 'SKIPPED',
    NO_SHOW: 'NO_SHOW',
    CANCEL: 'CANCELLED',
  },
  SKIPPED: {
    SEND_BACK: 'WAITING',
    CALL_IN: 'IN_CONSULTATION',
    NO_SHOW: 'NO_SHOW',
    CANCEL: 'CANCELLED',
  },
  IN_CONSULTATION: {
    COMPLETE: 'COMPLETED',
    SEND_BACK: 'WAITING',
  },
  COMPLETED: {},
  NO_SHOW: {},
  CANCELLED: {},
};

export function isTerminalState(state: VisitState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(currentState: VisitState, nextState: VisitState): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentState] || [];
  return allowed.includes(nextState);
}

export function getNextStateForAction(
  currentState: VisitState,
  action: VisitAction
): VisitState | null {
  const map = ACTION_TRANSITIONS[currentState];
  if (!map) return null;
  return map[action] ?? null;
}

export function getStateTimestampField(
  nextState: VisitState
): 'startedAt' | 'completedAt' | 'skippedAt' | 'noShowAt' | 'cancelledAt' | null {
  switch (nextState) {
    case 'IN_CONSULTATION':
      return 'startedAt';
    case 'COMPLETED':
      return 'completedAt';
    case 'SKIPPED':
      return 'skippedAt';
    case 'NO_SHOW':
      return 'noShowAt';
    case 'CANCELLED':
      return 'cancelledAt';
    case 'WAITING':
    default:
      return null;
  }
}
