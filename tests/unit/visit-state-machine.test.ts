import { describe, it, expect } from 'vitest';
import {
  VisitState,
  VisitAction,
  ALLOWED_TRANSITIONS,
  ACTION_TRANSITIONS,
  TERMINAL_STATES,
  isTerminalState,
  canTransition,
  getNextStateForAction,
  getStateTimestampField,
} from '@/lib/visit-state-machine';

describe('B6: Visit State Machine - Transition Table & Invariants', () => {
  const allStates: VisitState[] = [
    'WAITING',
    'IN_CONSULTATION',
    'COMPLETED',
    'SKIPPED',
    'NO_SHOW',
    'CANCELLED',
  ];

  it('correctly identifies terminal states', () => {
    expect(isTerminalState('COMPLETED')).toBe(true);
    expect(isTerminalState('NO_SHOW')).toBe(true);
    expect(isTerminalState('CANCELLED')).toBe(true);
    expect(isTerminalState('WAITING')).toBe(false);
    expect(isTerminalState('IN_CONSULTATION')).toBe(false);
    expect(isTerminalState('SKIPPED')).toBe(false);
  });

  describe('ALLOWED_TRANSITIONS validity', () => {
    it('WAITING can transition to IN_CONSULTATION, SKIPPED, NO_SHOW, CANCELLED', () => {
      expect(canTransition('WAITING', 'IN_CONSULTATION')).toBe(true);
      expect(canTransition('WAITING', 'SKIPPED')).toBe(true);
      expect(canTransition('WAITING', 'NO_SHOW')).toBe(true);
      expect(canTransition('WAITING', 'CANCELLED')).toBe(true);
      expect(canTransition('WAITING', 'COMPLETED')).toBe(false);
      expect(canTransition('WAITING', 'WAITING')).toBe(false);
    });

    it('SKIPPED can transition to WAITING, IN_CONSULTATION, NO_SHOW, CANCELLED', () => {
      expect(canTransition('SKIPPED', 'WAITING')).toBe(true);
      expect(canTransition('SKIPPED', 'IN_CONSULTATION')).toBe(true);
      expect(canTransition('SKIPPED', 'NO_SHOW')).toBe(true);
      expect(canTransition('SKIPPED', 'CANCELLED')).toBe(true);
      expect(canTransition('SKIPPED', 'COMPLETED')).toBe(false);
      expect(canTransition('SKIPPED', 'SKIPPED')).toBe(false);
    });

    it('IN_CONSULTATION can transition to COMPLETED, WAITING (sent back)', () => {
      expect(canTransition('IN_CONSULTATION', 'COMPLETED')).toBe(true);
      expect(canTransition('IN_CONSULTATION', 'WAITING')).toBe(true);
      expect(canTransition('IN_CONSULTATION', 'SKIPPED')).toBe(false);
      expect(canTransition('IN_CONSULTATION', 'NO_SHOW')).toBe(false);
      expect(canTransition('IN_CONSULTATION', 'CANCELLED')).toBe(false);
    });

    it('terminal states have ZERO allowed transitions', () => {
      for (const terminal of TERMINAL_STATES) {
        expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
        for (const anyState of allStates) {
          expect(canTransition(terminal, anyState)).toBe(false);
        }
      }
    });
  });

  describe('ACTION_TRANSITIONS mappings', () => {
    it('WAITING actions map to expected next states', () => {
      expect(getNextStateForAction('WAITING', 'CALL_IN')).toBe('IN_CONSULTATION');
      expect(getNextStateForAction('WAITING', 'SKIP')).toBe('SKIPPED');
      expect(getNextStateForAction('WAITING', 'NO_SHOW')).toBe('NO_SHOW');
      expect(getNextStateForAction('WAITING', 'CANCEL')).toBe('CANCELLED');
      expect(getNextStateForAction('WAITING', 'COMPLETE')).toBeNull();
      expect(getNextStateForAction('WAITING', 'SEND_BACK')).toBeNull();
    });

    it('SKIPPED actions map to expected next states', () => {
      expect(getNextStateForAction('SKIPPED', 'SEND_BACK')).toBe('WAITING');
      expect(getNextStateForAction('SKIPPED', 'CALL_IN')).toBe('IN_CONSULTATION');
      expect(getNextStateForAction('SKIPPED', 'NO_SHOW')).toBe('NO_SHOW');
      expect(getNextStateForAction('SKIPPED', 'CANCEL')).toBe('CANCELLED');
      expect(getNextStateForAction('SKIPPED', 'SKIP')).toBeNull();
      expect(getNextStateForAction('SKIPPED', 'COMPLETE')).toBeNull();
    });

    it('IN_CONSULTATION actions map to expected next states', () => {
      expect(getNextStateForAction('IN_CONSULTATION', 'COMPLETE')).toBe('COMPLETED');
      expect(getNextStateForAction('IN_CONSULTATION', 'SEND_BACK')).toBe('WAITING');
      expect(getNextStateForAction('IN_CONSULTATION', 'CALL_IN')).toBeNull();
      expect(getNextStateForAction('IN_CONSULTATION', 'SKIP')).toBeNull();
      expect(getNextStateForAction('IN_CONSULTATION', 'NO_SHOW')).toBeNull();
      expect(getNextStateForAction('IN_CONSULTATION', 'CANCEL')).toBeNull();
    });

    it('terminal states reject ALL actions', () => {
      const allActions: VisitAction[] = [
        'CALL_IN',
        'COMPLETE',
        'SKIP',
        'SEND_BACK',
        'NO_SHOW',
        'CANCEL',
      ];

      for (const terminal of TERMINAL_STATES) {
        for (const action of allActions) {
          expect(getNextStateForAction(terminal, action)).toBeNull();
        }
      }
    });
  });

  describe('getStateTimestampField', () => {
    it('maps nextState to correct timestamp field', () => {
      expect(getStateTimestampField('IN_CONSULTATION')).toBe('startedAt');
      expect(getStateTimestampField('COMPLETED')).toBe('completedAt');
      expect(getStateTimestampField('SKIPPED')).toBe('skippedAt');
      expect(getStateTimestampField('NO_SHOW')).toBe('noShowAt');
      expect(getStateTimestampField('CANCELLED')).toBe('cancelledAt');
      expect(getStateTimestampField('WAITING')).toBeNull();
    });
  });
});
