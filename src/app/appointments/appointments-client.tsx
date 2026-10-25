'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { clock } from '@/lib/clock';

interface PatientOption {
  _id: string;
  name: string;
  phone: string;
  patientCode: string;
}

interface AppointmentItem {
  _id: string;
  patientId?: {
    _id: string;
    name: string;
    phone: string;
    patientCode: string;
  };
  contactName: string;
  contactPhone: string;
  start: string;
  end: string;
  clinicDate: string;
  status: 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW';
  reason: string;
  treatmentCode?: string;
  source: 'MANUAL' | 'WEBSITE' | 'WHATSAPP';
  externalId?: string;
  notes?: string;
  version: number;
  checkedInVisitId?: string;
  cancelReason?: string;
  createdAt: string;
}

export default function AppointmentsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Active view: Day, Week, List
  const [view, setView] = useState<'day' | 'week' | 'list'>('day');

  // Selected date in Asia/Kolkata (YYYY-MM-DD)
  const todayStr = useMemo(() => {
    return new Date(clock.now().getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  }, []);

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // List view filters
  const [listDateFrom, setListDateFrom] = useState<string>(todayStr);
  const [listDateTo, setListDateTo] = useState<string>('');
  const [listStatus, setListStatus] = useState<string>('ALL');
  const [listSource, setListSource] = useState<string>('ALL');
  const [listSearch, setListSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Appointments data
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Treatments for dropdown
  const [treatments, setTreatments] = useState<any[]>([]);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [checkInModalOpen, setCheckInModalOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentItem | null>(null);

  // Cancel form
  const [cancelReason, setCancelReason] = useState('');

  // Reschedule form
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('09:00');

  // CheckIn unlinked form
  const [checkInSex, setCheckInSex] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [checkInAge, setCheckInAge] = useState<string>('');
  const [checkInDob, setCheckInDob] = useState<string>('');

  // Create form
  const [createMode, setCreateMode] = useState<'existing' | 'new'>('existing');
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);

  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [appointmentDate, setAppointmentDate] = useState(todayStr);
  const [appointmentTime, setAppointmentTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [reason, setReason] = useState('');
  const [treatmentCode, setTreatmentCode] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Check if URL has prefilled patient from follow-ups
  useEffect(() => {
    const prefillPatientId = searchParams.get('patientId');
    const prefillName = searchParams.get('name');
    const prefillPhone = searchParams.get('phone');
    const prefillCode = searchParams.get('code');

    if (prefillPatientId && prefillName) {
      const timer = setTimeout(() => {
        setSelectedPatient({
          _id: prefillPatientId,
          name: prefillName,
          phone: prefillPhone || '',
          patientCode: prefillCode || '',
        });
        setContactName(prefillName);
        setContactPhone(prefillPhone || '');
        setCreateMode('existing');
        setCreateModalOpen(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  // Load treatments
  useEffect(() => {
    fetch('/api/treatments')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setTreatments(d.treatments || []);
      })
      .catch(() => {});
  }, []);

  // Fetch appointments
  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = '/api/appointments?';
      if (view === 'day') {
        url += `dateFrom=${selectedDate}&dateTo=${selectedDate}&limit=100`;
      } else if (view === 'week') {
        // Compute 7 days range
        const start = new Date(selectedDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        const dateToStr = end.toISOString().slice(0, 10);
        url += `dateFrom=${selectedDate}&dateTo=${dateToStr}&limit=200`;
      } else {
        // List view
        url += `page=${page}&limit=20`;
        if (listDateFrom) url += `&dateFrom=${listDateFrom}`;
        if (listDateTo) url += `&dateTo=${listDateTo}`;
        if (listStatus !== 'ALL') url += `&status=${listStatus}`;
        if (listSource !== 'ALL') url += `&source=${listSource}`;
        if (listSearch) url += `&search=${encodeURIComponent(listSearch)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load appointments');
      }
      const data = await res.json();
      setAppointments(data.appointments || []);
      setTotalPages(data.totalPages || 1);
    } catch (err: any) {
      setError(err.message || 'Error fetching appointments');
    } finally {
      setLoading(false);
    }
  }, [view, selectedDate, listDateFrom, listDateTo, listStatus, listSource, listSearch, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAppointments();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAppointments]);

  // Patient search for create modal
  useEffect(() => {
    if (!patientQuery.trim() || createMode !== 'existing') {
      const clearTimer = setTimeout(() => {
        setPatientResults([]);
      }, 0);
      return () => clearTimeout(clearTimer);
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/patients?q=${encodeURIComponent(patientQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setPatientResults(data.patients || []);
        }
      } catch {}
    }, 250);
    return () => clearTimeout(timer);
  }, [patientQuery, createMode]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCreateModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle Book Appointment
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = createMode === 'existing' ? selectedPatient?.name || contactName : contactName;
    const phone = createMode === 'existing' ? selectedPatient?.phone || contactPhone : contactPhone;

    if (!name || !phone) {
      setFormError('Patient name and a valid phone number are required');
      return;
    }

    if (!reason.trim()) {
      setFormError('Reason for appointment is required');
      return;
    }

    // Convert date + time to UTC ISO string
    // Given appointmentDate (YYYY-MM-DD) and appointmentTime (HH:mm) in IST (UTC+05:30)
    const istString = `${appointmentDate}T${appointmentTime}:00+05:30`;
    const startDate = new Date(istString);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    const payload = {
      patientId: createMode === 'existing' && selectedPatient ? selectedPatient._id : undefined,
      contactName: name,
      contactPhone: phone,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      reason: reason.trim(),
      treatmentCode: treatmentCode || undefined,
      notes: notes.trim() || undefined,
      source: 'MANUAL',
    };

    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to create appointment');
        return;
      }

      setCreateModalOpen(false);
      resetCreateForm();
      setActionSuccess('Appointment booked successfully!');
      fetchAppointments();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setFormError(err.message || 'Error creating appointment');
    }
  };

  const resetCreateForm = () => {
    setSelectedPatient(null);
    setPatientQuery('');
    setContactName('');
    setContactPhone('');
    setReason('');
    setTreatmentCode('');
    setNotes('');
    setFormError(null);
  };

  // Handle Reschedule
  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppointment) return;

    const istString = `${rescheduleDate}T${rescheduleTime}:00+05:30`;
    const startDate = new Date(istString);
    const duration =
      new Date(selectedAppointment.end).getTime() - new Date(selectedAppointment.start).getTime();
    const endDate = new Date(startDate.getTime() + (duration > 0 ? duration : 30 * 60 * 1000));

    try {
      const res = await fetch(`/api/appointments/${selectedAppointment._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          version: selectedAppointment.version,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to reschedule appointment');
        return;
      }

      setRescheduleModalOpen(false);
      setSelectedAppointment(null);
      setActionSuccess('Appointment rescheduled successfully!');
      fetchAppointments();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error rescheduling appointment');
    }
  };

  // Handle Cancel
  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppointment) return;
    if (!cancelReason.trim()) {
      alert('Cancellation reason is required');
      return;
    }

    try {
      const res = await fetch(`/api/appointments/${selectedAppointment._id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to cancel appointment');
        return;
      }

      setCancelModalOpen(false);
      setSelectedAppointment(null);
      setCancelReason('');
      setActionSuccess('Appointment cancelled');
      fetchAppointments();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error cancelling appointment');
    }
  };

  // Handle No-Show
  const handleNoShow = async (appt: AppointmentItem) => {
    if (!confirm(`Mark appointment for "${appt.contactName}" as No-Show?`)) return;

    try {
      const res = await fetch(`/api/appointments/${appt._id}/no-show`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to mark appointment as no-show');
        return;
      }
      setActionSuccess('Marked as No-Show');
      fetchAppointments();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error marking appointment as no-show');
    }
  };

  // Handle Check-in
  const initiateCheckIn = async (appt: AppointmentItem) => {
    setSelectedAppointment(appt);

    // If appointment is not dated today in Asia/Kolkata
    if (appt.clinicDate !== todayStr) {
      alert(`Cannot check in: appointment is scheduled for ${appt.clinicDate}, but today is ${todayStr}.`);
      return;
    }

    // Try check-in directly first
    try {
      const res = await fetch(`/api/appointments/${appt._id}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (res.ok) {
        setActionSuccess(
          data.alreadyCheckedIn
            ? `Already checked in (Token #${data.visit?.token || ''})`
            : `Checked in successfully! Token #${data.visit?.token || ''} created in Live Queue.`
        );
        fetchAppointments();
        setTimeout(() => setActionSuccess(null), 4000);
        return;
      }

      // If backend returns 422 indicating unlinked details required
      if (res.status === 422 && !appt.patientId) {
        setCheckInModalOpen(true);
        return;
      }

      alert(data.error || 'Failed to check in appointment');
    } catch (err: any) {
      alert(err.message || 'Error during check-in');
    }
  };

  // Complete check-in with patient age/dob/sex
  const handleCompleteCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppointment) return;

    if (!checkInAge && !checkInDob) {
      alert('Please provide age or date of birth');
      return;
    }

    try {
      const res = await fetch(`/api/appointments/${selectedAppointment._id}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sex: checkInSex,
          ageYears: checkInAge ? parseInt(checkInAge, 10) : undefined,
          dob: checkInDob || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to check in patient');
        return;
      }

      setCheckInModalOpen(false);
      setSelectedAppointment(null);
      setActionSuccess(`Patient registered and checked in! Token #${data.visit?.token || ''} in Live Queue.`);
      fetchAppointments();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error checking in');
    }
  };

  // Format time in Asia/Kolkata (HH:mm)
  const formatTimeIST = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return isoString;
    }
  };

  // Status Badge Component (shows color AND explicit text label)
  const StatusBadge = ({ status }: { status: AppointmentItem['status'] }) => {
    switch (status) {
      case 'BOOKED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-950 text-blue-300 border border-blue-800">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" aria-hidden="true" />
            Booked
          </span>
        );
      case 'CHECKED_IN':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            Checked In
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-950 text-rose-300 border border-rose-800">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" aria-hidden="true" />
            Cancelled
          </span>
        );
      case 'NO_SHOW':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
            No Show
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold text-lg">
              📅
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Appointment Schedule
              </h1>
              <p className="text-xs text-slate-400">
                Dr. Susheel&apos;s Advanced Dental Clinic &bull; 09:00 - 20:00 IST
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              id="nav-link-queue"
              href="/queue"
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Live Queue
            </Link>
            <Link
              id="nav-link-followups"
              href="/followups"
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Follow-ups
            </Link>
            <button
              id="btn-book-appointment-header"
              type="button"
              onClick={() => {
                resetCreateForm();
                setCreateModalOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm cursor-pointer"
            >
              + Book Slot
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Success Alert */}
        {actionSuccess && (
          <div
            role="status"
            className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-sm flex items-center justify-between"
          >
            <span>{actionSuccess}</span>
            <button
              type="button"
              onClick={() => setActionSuccess(null)}
              className="text-emerald-400 hover:text-emerald-200 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* View Selection & Date Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/40 p-4 rounded-2xl border border-slate-800/80">
          {/* View Tabs */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              id="tab-view-day"
              type="button"
              onClick={() => setView('day')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                view === 'day' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Day View
            </button>
            <button
              id="tab-view-week"
              type="button"
              onClick={() => setView('week')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                view === 'week' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Week View
            </button>
            <button
              id="tab-view-list"
              type="button"
              onClick={() => setView('list')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                view === 'list' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              List View
            </button>
          </div>

          {/* Date Navigator (Day / Week) */}
          {view !== 'list' && (
            <div className="flex items-center gap-3">
              <label htmlFor="nav-date-input" className="text-xs font-medium text-slate-400">
                Date (IST):
              </label>
              <input
                id="nav-date-input"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                id="btn-date-today"
                type="button"
                onClick={() => setSelectedDate(todayStr)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
              >
                Today
              </button>
            </div>
          )}
        </div>

        {/* List View Filters */}
        {view === 'list' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-slate-900/40 p-4 rounded-2xl border border-slate-800">
            <div>
              <label htmlFor="filter-date-from" className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                From Date
              </label>
              <input
                id="filter-date-from"
                type="date"
                value={listDateFrom}
                onChange={(e) => {
                  setListDateFrom(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="filter-date-to" className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                To Date
              </label>
              <input
                id="filter-date-to"
                type="date"
                value={listDateTo}
                onChange={(e) => {
                  setListDateTo(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="filter-status" className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Status
              </label>
              <select
                id="filter-status"
                value={listStatus}
                onChange={(e) => {
                  setListStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="BOOKED">Booked</option>
                <option value="CHECKED_IN">Checked In</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="NO_SHOW">No Show</option>
              </select>
            </div>

            <div>
              <label htmlFor="filter-source" className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Source
              </label>
              <select
                id="filter-source"
                value={listSource}
                onChange={(e) => {
                  setListSource(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Sources</option>
                <option value="MANUAL">Manual</option>
                <option value="WEBSITE">Website</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>

            <div>
              <label htmlFor="filter-search" className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Search Name / Phone
              </label>
              <input
                id="filter-search"
                type="text"
                placeholder="Search..."
                value={listSearch}
                onChange={(e) => {
                  setListSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {/* Content Area */}
        {loading ? (
          <div className="text-center py-16 text-slate-400 font-medium text-sm">
            Loading appointments...
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-sm">
            {error}
          </div>
        ) : appointments.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
            No appointments found for the selected criteria.
          </div>
        ) : view === 'list' ? (
          /* List View Table */
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4 font-bold">Date & Time (IST)</th>
                    <th className="py-3 px-4 font-bold">Patient</th>
                    <th className="py-3 px-4 font-bold">Contact</th>
                    <th className="py-3 px-4 font-bold">Reason</th>
                    <th className="py-3 px-4 font-bold">Source</th>
                    <th className="py-3 px-4 font-bold text-center">Status</th>
                    <th className="py-3 px-4 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {appointments.map((appt) => {
                    const isToday = appt.clinicDate === todayStr;
                    const canCheckIn = appt.status === 'BOOKED' && isToday;
                    const canNoShow =
                      appt.status === 'BOOKED' && new Date(appt.start).getTime() < clock.now().getTime();
                    const canReschedule = appt.status === 'BOOKED';
                    const canCancel = appt.status === 'BOOKED';

                    return (
                      <tr key={appt._id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4 font-mono font-medium text-blue-400 whitespace-nowrap">
                          {appt.clinicDate} &bull; {formatTimeIST(appt.start)} - {formatTimeIST(appt.end)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-white whitespace-nowrap">
                          {appt.contactName}
                          {appt.patientId?.patientCode && (
                            <span className="ml-1.5 text-[11px] font-mono text-slate-400 font-normal">
                              ({appt.patientId.patientCode})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-300 font-mono whitespace-nowrap">
                          <a href={`tel:${appt.contactPhone}`} className="hover:underline">
                            {appt.contactPhone}
                          </a>
                        </td>
                        <td className="py-3 px-4 text-slate-300 max-w-xs truncate">
                          {appt.reason}
                          {appt.treatmentCode && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                              {appt.treatmentCode}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-400 uppercase text-[11px] whitespace-nowrap">
                          {appt.source}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <StatusBadge status={appt.status} />
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                          {canCheckIn && (
                            <button
                              type="button"
                              onClick={() => initiateCheckIn(appt)}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition cursor-pointer"
                            >
                              Check In
                            </button>
                          )}
                          {canReschedule && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAppointment(appt);
                                setRescheduleDate(appt.clinicDate);
                                setRescheduleTime('09:00');
                                setRescheduleModalOpen(true);
                              }}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                            >
                              Reschedule
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAppointment(appt);
                                setCancelReason('');
                                setCancelModalOpen(true);
                              }}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 transition cursor-pointer"
                            >
                              Cancel
                            </button>
                          )}
                          {canNoShow && (
                            <button
                              type="button"
                              onClick={() => handleNoShow(appt)}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-950/60 hover:bg-amber-900 text-amber-300 border border-amber-800 transition cursor-pointer"
                            >
                              No-Show
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span>
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 disabled:opacity-40 text-slate-200 border border-slate-700"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 disabled:opacity-40 text-slate-200 border border-slate-700"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Day / Week Agenda & Card View (Responsive: at 390px mobile, falls back to time-ordered agenda list) */
          <div className="space-y-4">
            {/* Agenda List for All Screen Sizes (Time ordered) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {appointments.map((appt) => {
                const isToday = appt.clinicDate === todayStr;
                const canCheckIn = appt.status === 'BOOKED' && isToday;
                const canNoShow =
                  appt.status === 'BOOKED' && new Date(appt.start).getTime() < clock.now().getTime();
                const canReschedule = appt.status === 'BOOKED';
                const canCancel = appt.status === 'BOOKED';

                return (
                  <div
                    key={appt._id}
                    className="bg-slate-900/60 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-mono font-bold text-blue-400">
                          {formatTimeIST(appt.start)} - {formatTimeIST(appt.end)}
                        </div>
                        <div className="text-sm font-bold text-white mt-0.5">
                          {appt.contactName}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          <a href={`tel:${appt.contactPhone}`} className="hover:underline">
                            {appt.contactPhone}
                          </a>
                          {appt.patientId?.patientCode && (
                            <span className="ml-1.5 px-1.5 py-0.2 bg-slate-800 rounded text-[10px]">
                              {appt.patientId.patientCode}
                            </span>
                          )}
                        </div>
                      </div>
                      <StatusBadge status={appt.status} />
                    </div>

                    <div className="bg-slate-950/60 rounded-xl p-2.5 text-xs text-slate-300 space-y-1">
                      <div className="font-medium text-slate-200 truncate">
                        {appt.reason}
                      </div>
                      {appt.treatmentCode && (
                        <div className="text-[11px] text-blue-400 font-mono">
                          Treatment: {appt.treatmentCode}
                        </div>
                      )}
                      {appt.cancelReason && (
                        <div className="text-[11px] text-rose-400">
                          Cancelled: {appt.cancelReason}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 uppercase">
                        Date: {appt.clinicDate} &bull; Source: {appt.source}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-800/60">
                      {canCheckIn && (
                        <button
                          type="button"
                          onClick={() => initiateCheckIn(appt)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition cursor-pointer"
                        >
                          Check In
                        </button>
                      )}
                      {canReschedule && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAppointment(appt);
                            setRescheduleDate(appt.clinicDate);
                            setRescheduleTime('09:00');
                            setRescheduleModalOpen(true);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                        >
                          Reschedule
                        </button>
                      )}
                      {canCancel && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAppointment(appt);
                            setCancelReason('');
                            setCancelModalOpen(true);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                      {canNoShow && (
                        <button
                          type="button"
                          onClick={() => handleNoShow(appt)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-950/60 hover:bg-amber-900 text-amber-300 border border-amber-800 transition cursor-pointer"
                        >
                          No-Show
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Book Slot Modal */}
      {createModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-book-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl my-8">
            <div className="flex items-center justify-between">
              <h2 id="modal-book-title" className="text-lg font-bold text-white">
                Book Appointment Slot
              </h2>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateAppointment} className="space-y-4">
              {/* Patient Selection Toggle */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Patient Type
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateMode('existing');
                      setSelectedPatient(null);
                    }}
                    className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                      createMode === 'existing'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Existing Patient
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateMode('new');
                      setSelectedPatient(null);
                    }}
                    className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                      createMode === 'new'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    New Contact
                  </button>
                </div>
              </div>

              {/* Existing Patient Search */}
              {createMode === 'existing' ? (
                <div className="space-y-2">
                  <label htmlFor="input-patient-search" className="block text-xs font-semibold text-slate-300">
                    Search Patient (Name, Phone, Code)
                  </label>
                  <input
                    id="input-patient-search"
                    type="text"
                    placeholder="Type name, phone or patient code..."
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />

                  {selectedPatient && (
                    <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/80 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-blue-300">{selectedPatient.name}</span>
                        <span className="text-slate-400 ml-2 font-mono">{selectedPatient.phone}</span>
                        <span className="text-slate-400 ml-2 font-mono">({selectedPatient.patientCode})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedPatient(null)}
                        className="text-rose-400 text-xs font-bold"
                      >
                        Change
                      </button>
                    </div>
                  )}

                  {patientResults.length > 0 && !selectedPatient && (
                    <div className="max-h-40 overflow-y-auto bg-slate-950 border border-slate-800 rounded-xl divide-y divide-slate-800/60">
                      {patientResults.map((p) => (
                        <button
                          key={p._id}
                          type="button"
                          onClick={() => {
                            setSelectedPatient(p);
                            setContactName(p.name);
                            setContactPhone(p.phone);
                            setPatientResults([]);
                          }}
                          className="w-full text-left p-2 hover:bg-slate-800/60 text-xs flex justify-between items-center"
                        >
                          <span className="font-semibold text-white">{p.name}</span>
                          <span className="text-slate-400 font-mono">{p.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* New Contact Inputs */
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="input-contact-name" className="block text-xs font-semibold text-slate-300 mb-1">
                      Full Name *
                    </label>
                    <input
                      id="input-contact-name"
                      type="text"
                      required
                      placeholder="e.g. Ramesh Patil"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="input-contact-phone" className="block text-xs font-semibold text-slate-300 mb-1">
                      Phone Number *
                    </label>
                    <input
                      id="input-contact-phone"
                      type="tel"
                      required
                      maxLength={10}
                      placeholder="10-digit mobile"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* Slot Scheduling */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="input-slot-date" className="block text-xs font-semibold text-slate-300 mb-1">
                    Date *
                  </label>
                  <input
                    id="input-slot-date"
                    type="date"
                    required
                    value={appointmentDate}
                    onChange={(e) => setAppointmentDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="input-slot-time" className="block text-xs font-semibold text-slate-300 mb-1">
                    Start Time *
                  </label>
                  <select
                    id="input-slot-time"
                    value={appointmentTime}
                    onChange={(e) => setAppointmentTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="09:00">09:00 AM</option>
                    <option value="09:30">09:30 AM</option>
                    <option value="10:00">10:00 AM</option>
                    <option value="10:30">10:30 AM</option>
                    <option value="11:00">11:00 AM</option>
                    <option value="11:30">11:30 AM</option>
                    <option value="12:00">12:00 PM</option>
                    <option value="12:30">12:30 PM</option>
                    <option value="13:00">01:00 PM</option>
                    <option value="13:30">01:30 PM</option>
                    <option value="14:00">02:00 PM</option>
                    <option value="14:30">02:30 PM</option>
                    <option value="15:00">03:00 PM</option>
                    <option value="15:30">03:30 PM</option>
                    <option value="16:00">04:00 PM</option>
                    <option value="16:30">04:30 PM</option>
                    <option value="17:00">05:00 PM</option>
                    <option value="17:30">05:30 PM</option>
                    <option value="18:00">06:00 PM</option>
                    <option value="18:30">06:30 PM</option>
                    <option value="19:00">07:00 PM</option>
                    <option value="19:30">07:30 PM</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="input-duration" className="block text-xs font-semibold text-slate-300 mb-1">
                    Duration
                  </label>
                  <select
                    id="input-duration"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={30}>30 mins</option>
                    <option value={60}>60 mins</option>
                  </select>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label htmlFor="input-reason" className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason for Visit *
                </label>
                <input
                  id="input-reason"
                  type="text"
                  required
                  placeholder="e.g. Toothache / Root canal consultation"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Treatment (Optional) */}
              <div>
                <label htmlFor="input-treatment-code" className="block text-xs font-semibold text-slate-300 mb-1">
                  Associated Treatment (Optional)
                </label>
                <select
                  id="input-treatment-code"
                  value={treatmentCode}
                  onChange={(e) => setTreatmentCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None / Not specified</option>
                  {treatments.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name} ({t.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes (Optional) */}
              <div>
                <label htmlFor="input-notes" className="block text-xs font-semibold text-slate-300 mb-1">
                  Clinical Notes (Optional)
                </label>
                <textarea
                  id="input-notes"
                  rows={2}
                  placeholder="Additional instructions..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-book"
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm cursor-pointer"
                >
                  Book Slot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleModalOpen && selectedAppointment && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-reschedule-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h2 id="modal-reschedule-title" className="text-lg font-bold text-white">
              Reschedule Appointment
            </h2>
            <p className="text-xs text-slate-400">
              Patient: <span className="text-white font-semibold">{selectedAppointment.contactName}</span> (Version {selectedAppointment.version})
            </p>

            <form onSubmit={handleReschedule} className="space-y-4">
              <div>
                <label htmlFor="reschedule-date" className="block text-xs font-semibold text-slate-300 mb-1">
                  New Date (IST) *
                </label>
                <input
                  id="reschedule-date"
                  type="date"
                  required
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="reschedule-time" className="block text-xs font-semibold text-slate-300 mb-1">
                  New Start Time *
                </label>
                <select
                  id="reschedule-time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="09:00">09:00 AM</option>
                  <option value="09:30">09:30 AM</option>
                  <option value="10:00">10:00 AM</option>
                  <option value="10:30">10:30 AM</option>
                  <option value="11:00">11:00 AM</option>
                  <option value="11:30">11:30 AM</option>
                  <option value="12:00">12:00 PM</option>
                  <option value="12:30">12:30 PM</option>
                  <option value="13:00">01:00 PM</option>
                  <option value="13:30">01:30 PM</option>
                  <option value="14:00">02:00 PM</option>
                  <option value="14:30">02:30 PM</option>
                  <option value="15:00">03:00 PM</option>
                  <option value="15:30">03:30 PM</option>
                  <option value="16:00">04:00 PM</option>
                  <option value="16:30">04:30 PM</option>
                  <option value="17:00">05:00 PM</option>
                  <option value="17:30">05:30 PM</option>
                  <option value="18:00">06:00 PM</option>
                  <option value="18:30">06:30 PM</option>
                  <option value="19:00">07:00 PM</option>
                  <option value="19:30">07:30 PM</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRescheduleModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300"
                >
                  Back
                </button>
                <button
                  id="btn-confirm-reschedule"
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Save Reschedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModalOpen && selectedAppointment && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-cancel-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h2 id="modal-cancel-title" className="text-lg font-bold text-white">
              Cancel Appointment
            </h2>
            <p className="text-xs text-slate-400">
              Please enter the cancellation reason for{' '}
              <span className="text-white font-semibold">{selectedAppointment.contactName}</span>:
            </p>

            <form onSubmit={handleCancel} className="space-y-4">
              <div>
                <label htmlFor="cancel-reason" className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason for Cancellation *
                </label>
                <textarea
                  id="cancel-reason"
                  required
                  rows={3}
                  placeholder="e.g. Patient requested cancellation / Emergency conflict"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300"
                >
                  Keep Appointment
                </button>
                <button
                  id="btn-confirm-cancel"
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
                >
                  Confirm Cancellation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Check-In Unlinked Modal */}
      {checkInModalOpen && selectedAppointment && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-checkin-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h2 id="modal-checkin-title" className="text-lg font-bold text-white">
              Complete Patient Details
            </h2>
            <p className="text-xs text-slate-400">
              Appointment for <span className="text-white font-semibold">{selectedAppointment.contactName}</span> ({selectedAppointment.contactPhone}) is not linked to a registered patient. Please provide sex and age or date of birth to create the patient record and generate a queue token:
            </p>

            <form onSubmit={handleCompleteCheckIn} className="space-y-4">
              <div>
                <label htmlFor="checkin-sex" className="block text-xs font-semibold text-slate-300 mb-1">
                  Sex *
                </label>
                <select
                  id="checkin-sex"
                  value={checkInSex}
                  onChange={(e) => setCheckInSex(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="checkin-age" className="block text-xs font-semibold text-slate-300 mb-1">
                    Age (Years)
                  </label>
                  <input
                    id="checkin-age"
                    type="number"
                    min={0}
                    max={120}
                    placeholder="e.g. 35"
                    value={checkInAge}
                    onChange={(e) => setCheckInAge(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="checkin-dob" className="block text-xs font-semibold text-slate-300 mb-1">
                    Date of Birth
                  </label>
                  <input
                    id="checkin-dob"
                    type="date"
                    value={checkInDob}
                    onChange={(e) => setCheckInDob(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCheckInModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-checkin"
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                >
                  Register & Check In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
