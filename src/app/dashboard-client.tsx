'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Sidebar } from '@/components/Sidebar';
import { formatRupees } from '@/lib/money';
import { clock } from '@/lib/clock';

interface DashboardCardStats {
  registeredPatients: number;
  waiting: number;
  inConsultation: number;
  completed: number;
  noShowSkippedCancelled: number;
  appointmentsBooked: number;
  appointmentsCheckedIn: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
  collectionsToday: number;
  outstandingBalance: number;
}

interface AppointmentItem {
  _id: string;
  patientName: string;
  phone: string;
  timeStr: string;
  status: string;
  reason?: string;
}

interface FollowUpItem {
  _id: string;
  patientName: string;
  phone: string;
  dueDateStr: string;
  status: string;
  notes?: string;
}

interface DashboardData {
  clinicDate: string;
  cards: DashboardCardStats;
  appointments: AppointmentItem[];
  followUps: FollowUpItem[];
  billingSummary: {
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
  };
  queueSummary: {
    totalActive: number;
    waiting: number;
    inConsultation: number;
    nextTicketNumber?: number;
  };
  generatedAt: string;
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const isTabVisibleRef = useRef<boolean>(true);

  const fetchDashboard = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        throw new Error('Failed to load dashboard data');
      }
      const json: DashboardData = await res.json();
      setData(json);
      setLastUpdated(clock.now());
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error fetching dashboard');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  // 60-second auto-refresh, paused when tab is hidden
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDashboard(true);
    }, 0);

    const handleVisibilityChange = () => {
      isTabVisibleRef.current = !document.hidden;
      if (!document.hidden) {
        fetchDashboard(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(() => {
      if (isTabVisibleRef.current) {
        fetchDashboard(false);
      }
    }, 60000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchDashboard]);

  // Quick check-in for appointment
  const handleQuickCheckIn = async (appointmentId: string) => {
    setActionLoadingId(`checkin-${appointmentId}`);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Check-in failed');
        return;
      }
      await fetchDashboard(false);
    } catch (err: any) {
      alert(err.message || 'Network error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Quick mark-done for follow-up
  const handleQuickMarkDone = async (followUpId: string) => {
    setActionLoadingId(`done-${followUpId}`);
    try {
      const res = await fetch(`/api/followups/${followUpId}/done`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Mark done failed');
        return;
      }
      await fetchDashboard(false);
    } catch (err: any) {
      alert(err.message || 'Network error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const cards = data?.cards || {
    registeredPatients: 0,
    waiting: 0,
    inConsultation: 0,
    completed: 0,
    noShowSkippedCancelled: 0,
    appointmentsBooked: 0,
    appointmentsCheckedIn: 0,
    followUpsDueToday: 0,
    followUpsOverdue: 0,
    collectionsToday: 0,
    outstandingBalance: 0,
  };

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
      <Sidebar activeItem="dashboard" />

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header */}
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Clinical Dashboard
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Overview for {data?.clinicDate || 'Today'} (Asia/Kolkata)
            </p>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span
                id="dashboard-last-updated"
                className="text-xs text-slate-500 dark:text-slate-400 font-mono"
              >
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}

            <button
              id="btn-refresh-dashboard"
              type="button"
              onClick={() => fetchDashboard(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 transition"
            >
              Refresh
            </button>

            <Link
              id="header-btn-new-patient"
              href="/register"
              target="_blank"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm"
            >
              + New Patient
            </Link>
          </div>
        </header>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
            {error}
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* Operational Metrics Cards (Grid) */}
          <section aria-labelledby="today-metrics-heading">
            <h2 id="today-metrics-heading" className="sr-only">
              Today&apos;s Key Clinical Metrics
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {/* Card 1: Registered Patients */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Registered Today</p>
                <p id="card-registered-patients" className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {loading ? '—' : cards.registeredPatients}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">New registrations</p>
              </div>

              {/* Card 2: Queue: Waiting */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-amber-200 dark:border-amber-900/50 shadow-sm">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Waiting in Queue</p>
                <p id="card-waiting-patients" className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                  {loading ? '—' : cards.waiting}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">In reception</p>
              </div>

              {/* Card 3: In Consultation */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-blue-200 dark:border-blue-900/50 shadow-sm">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-400">In Consultation</p>
                <p id="card-in-consultation" className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                  {loading ? '—' : cards.inConsultation}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Chair-side</p>
              </div>

              {/* Card 4: Completed */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 shadow-sm">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Completed Visits</p>
                <p id="card-completed-visits" className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {loading ? '—' : cards.completed}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Seen today</p>
              </div>

              {/* Card 5: Skipped / No-show */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Skipped / No-Show</p>
                <p id="card-skipped-noshow" className="text-2xl font-bold text-slate-700 dark:text-slate-300 mt-1">
                  {loading ? '—' : cards.noShowSkippedCancelled}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Visits or appts</p>
              </div>

              {/* Card 6: Appointments Today */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Appointments Today</p>
                <p id="card-appointments-today" className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {loading ? '—' : `${cards.appointmentsBooked + cards.appointmentsCheckedIn}`}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                  {cards.appointmentsCheckedIn} checked-in · {cards.appointmentsBooked} booked
                </p>
              </div>

              {/* Card 7: Follow-ups Due & Overdue */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-purple-200 dark:border-purple-900/50 shadow-sm">
                <p className="text-xs font-medium text-purple-700 dark:text-purple-400">Follow-ups Due</p>
                <p id="card-followups-due" className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                  {loading ? '—' : `${cards.followUpsDueToday}`}
                </p>
                <p className="text-[10px] text-rose-500 font-medium mt-1">
                  +{cards.followUpsOverdue} overdue
                </p>
              </div>

              {/* Card 8: Collections Today */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 shadow-sm sm:col-span-2 lg:col-span-1">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Collections Today</p>
                <p id="card-collections-today" className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {loading ? '—' : formatRupees(cards.collectionsToday)}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Net of reversals</p>
              </div>

              {/* Card 9: Total Outstanding Balance */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-sm sm:col-span-3 lg:col-span-2">
                <p className="text-xs font-medium text-rose-700 dark:text-rose-400">Total Outstanding Balance</p>
                <p id="card-outstanding-balance" className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                  {loading ? '—' : formatRupees(cards.outstandingBalance)}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Across all active clinic bills</p>
              </div>
            </div>
          </section>

          {/* Main Operational Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Panel 1: Today's Appointments */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-base text-slate-900 dark:text-white">
                      Today&apos;s Appointments
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Scheduled for today</p>
                  </div>
                  <Link
                    href="/appointments"
                    className="text-xs font-medium text-blue-600 hover:text-blue-500"
                  >
                    View All →
                  </Link>
                </div>

                {loading ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">Loading appointments...</div>
                ) : data?.appointments.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No appointments scheduled for today.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data?.appointments.map((appt) => (
                      <div
                        key={appt._id}
                        className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                              {appt.timeStr}
                            </span>
                            <span className="font-medium text-xs text-slate-900 dark:text-slate-100 truncate">
                              {appt.patientName}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {appt.phone} {appt.reason ? `· ${appt.reason}` : ''}
                          </p>
                        </div>

                        <div>
                          {appt.status === 'CHECKED_IN' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              Checked In
                            </span>
                          ) : (
                            <button
                              id={`btn-quick-checkin-${appt._id}`}
                              type="button"
                              disabled={actionLoadingId === `checkin-${appt._id}`}
                              onClick={() => handleQuickCheckIn(appt._id)}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 transition"
                            >
                              {actionLoadingId === `checkin-${appt._id}` ? '...' : 'Check-In'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Panel 2: Follow-ups Due & Overdue */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-base text-slate-900 dark:text-white">
                      Follow-ups Due & Overdue
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Pending patient follow-ups</p>
                  </div>
                  <Link
                    href="/followups"
                    className="text-xs font-medium text-purple-600 hover:text-purple-500"
                  >
                    View All →
                  </Link>
                </div>

                {loading ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">Loading follow-ups...</div>
                ) : data?.followUps.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No pending follow-ups due.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data?.followUps.map((fu) => (
                      <div
                        key={fu._id}
                        className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-xs text-slate-900 dark:text-slate-100 truncate">
                              {fu.patientName}
                            </span>
                            <span className="font-mono text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 px-1.5 py-0.5 rounded">
                              {fu.dueDateStr}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {fu.phone} {fu.notes ? `· ${fu.notes}` : ''}
                          </p>
                        </div>

                        <div>
                          <button
                            id={`btn-quick-markdone-${fu._id}`}
                            type="button"
                            disabled={actionLoadingId === `done-${fu._id}`}
                            onClick={() => handleQuickMarkDone(fu._id)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 transition"
                          >
                            {actionLoadingId === `done-${fu._id}` ? '...' : 'Done'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Panel 3: Billing & Queue Summary */}
            <div className="space-y-6">
              {/* Compact Queue Summary Card */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Live Queue Status
                  </h3>
                  <Link
                    id="link-dashboard-queue"
                    href="/queue"
                    className="text-xs font-semibold text-blue-600 hover:text-blue-500"
                  >
                    Open Queue →
                  </Link>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl border border-amber-100 dark:border-amber-900/40">
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">Waiting</p>
                    <p className="text-xl font-bold text-amber-800 dark:text-amber-200 mt-0.5">
                      {data?.queueSummary?.waiting ?? 0}
                    </p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-xl border border-blue-100 dark:border-blue-900/40">
                    <p className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">In Consultation</p>
                    <p className="text-xl font-bold text-blue-800 dark:text-blue-200 mt-0.5">
                      {data?.queueSummary?.inConsultation ?? 0}
                    </p>
                  </div>
                </div>

                {data?.queueSummary?.nextTicketNumber && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                    Next token: <span className="font-semibold text-slate-800 dark:text-slate-200">#{data.queueSummary.nextTicketNumber}</span>
                  </p>
                )}
              </div>

              {/* Billing Summary Card */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Financial Summary
                  </h3>
                  <Link
                    href="/billing"
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-500"
                  >
                    Billing →
                  </Link>
                </div>

                <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                    <span>Billed Today:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatRupees(data?.billingSummary?.billedToday ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                    <span>Collected Today:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatRupees(data?.billingSummary?.collectedToday ?? 0)}
                    </span>
                  </div>

                  {/* Collections Breakdown by Method */}
                  <div className="pt-1">
                    <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold mb-1">
                      Today by Method
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="flex justify-between bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded">
                        <span>Cash:</span>
                        <span className="font-mono font-medium">{formatRupees(data?.billingSummary?.methodsToday?.CASH ?? 0)}</span>
                      </div>
                      <div className="flex justify-between bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded">
                        <span>UPI:</span>
                        <span className="font-mono font-medium">{formatRupees(data?.billingSummary?.methodsToday?.UPI ?? 0)}</span>
                      </div>
                      <div className="flex justify-between bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded">
                        <span>Card:</span>
                        <span className="font-mono font-medium">{formatRupees(data?.billingSummary?.methodsToday?.CARD ?? 0)}</span>
                      </div>
                      <div className="flex justify-between bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded">
                        <span>NetBank:</span>
                        <span className="font-mono font-medium">{formatRupees(data?.billingSummary?.methodsToday?.NET_BANKING ?? 0)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span>Month Billed:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatRupees(data?.billingSummary?.billedMonth ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Month Collected:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatRupees(data?.billingSummary?.collectedMonth ?? 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
