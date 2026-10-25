import { AppointmentStatus } from '../models/Appointment';

export type AppointmentAction = 'CHECK_IN' | 'CANCEL' | 'NO_SHOW' | 'RESCHEDULE';

export class AppointmentStateTransitionError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'AppointmentStateTransitionError';
    this.statusCode = 409;
  }
}

const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, Partial<Record<AppointmentAction, AppointmentStatus>>> = {
  BOOKED: {
    CHECK_IN: 'CHECKED_IN',
    CANCEL: 'CANCELLED',
    NO_SHOW: 'NO_SHOW',
    RESCHEDULE: 'BOOKED',
  },
  CHECKED_IN: {},
  CANCELLED: {},
  NO_SHOW: {},
};

export function canTransitionAppointment(from: AppointmentStatus, action: AppointmentAction): boolean {
  const allowed = APPOINTMENT_TRANSITIONS[from];
  return Boolean(allowed && allowed[action]);
}

export function transitionAppointment(from: AppointmentStatus, action: AppointmentAction): AppointmentStatus {
  const allowed = APPOINTMENT_TRANSITIONS[from];
  const next = allowed ? allowed[action] : undefined;

  if (!next) {
    throw new AppointmentStateTransitionError(
      `Illegal appointment transition: cannot perform action '${action}' on appointment with status '${from}'`
    );
  }

  return next;
}
