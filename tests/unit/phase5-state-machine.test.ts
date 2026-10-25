import { describe, it, expect } from 'vitest';
import {
  canTransitionAppointment,
  transitionAppointment,
  AppointmentStateTransitionError,
} from '@/lib/appointment-state-machine';
import { AppointmentStatus, AppointmentAction } from '@/models/Appointment';

describe('E8: Appointment State Machine', () => {
  const allStatuses: AppointmentStatus[] = ['BOOKED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'];
  const allActions: AppointmentAction[] = ['CHECK_IN', 'CANCEL', 'NO_SHOW'];

  it('allows BOOKED transitions to CHECKED_IN, CANCELLED, and NO_SHOW', () => {
    expect(canTransitionAppointment('BOOKED', 'CHECK_IN')).toBe(true);
    expect(transitionAppointment('BOOKED', 'CHECK_IN')).toBe('CHECKED_IN');

    expect(canTransitionAppointment('BOOKED', 'CANCEL')).toBe(true);
    expect(transitionAppointment('BOOKED', 'CANCEL')).toBe('CANCELLED');

    expect(canTransitionAppointment('BOOKED', 'NO_SHOW')).toBe(true);
    expect(transitionAppointment('BOOKED', 'NO_SHOW')).toBe('NO_SHOW');
  });

  it('rejects all transitions from terminal state CHECKED_IN with 409', () => {
    for (const action of allActions) {
      expect(canTransitionAppointment('CHECKED_IN', action)).toBe(false);
      expect(() => transitionAppointment('CHECKED_IN', action)).toThrow(AppointmentStateTransitionError);
      try {
        transitionAppointment('CHECKED_IN', action);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
      }
    }
  });

  it('rejects all transitions from terminal state CANCELLED with 409', () => {
    for (const action of allActions) {
      expect(canTransitionAppointment('CANCELLED', action)).toBe(false);
      expect(() => transitionAppointment('CANCELLED', action)).toThrow(AppointmentStateTransitionError);
      try {
        transitionAppointment('CANCELLED', action);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
      }
    }
  });

  it('rejects all transitions from terminal state NO_SHOW with 409', () => {
    for (const action of allActions) {
      expect(canTransitionAppointment('NO_SHOW', action)).toBe(false);
      expect(() => transitionAppointment('NO_SHOW', action)).toThrow(AppointmentStateTransitionError);
      try {
        transitionAppointment('NO_SHOW', action);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
      }
    }
  });

  it('handles unknown or illegal states gracefully', () => {
    expect(canTransitionAppointment('UNKNOWN' as any, 'CHECK_IN')).toBe(false);
    expect(() => transitionAppointment('UNKNOWN' as any, 'CHECK_IN')).toThrow(AppointmentStateTransitionError);
  });
});
