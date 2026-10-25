'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

interface QueueCounters {
  waiting: number;
  inConsultation: number;
  completed: number;
  skippedOrNoShow: number;
  averageWaitMinutes: number;
}

interface QueueItem {
  id: string;
  token: number;
  status: 'WAITING' | 'IN_CONSULTATION' | 'SKIPPED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
  patientId: string;
  patientName: string;
  ageYears?: number;
  dob?: string;
  sex: string;
  reasonForVisit: string;
  checkInAt: string;
  waitingMinutes: number;
  duplicateFlag: boolean;
  possibleDuplicateOfCode?: string;
  source: string;
  version: number;
}

import { clock } from '@/lib/clock';

export function QueueClient() {
  const [counters, setCounters] = useState<QueueCounters>({
    waiting: 0,
    inConsultation: 0,
    completed: 0,
    skippedOrNoShow: 0,
    averageWaitMinutes: 0,
  });
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [conflictAlert, setConflictAlert] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const pollIntervalRef = useRef<number>(2000);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchQueue = useCallback(async (isInitial = false) => {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        const data = await res.json();
        setCounters(data.counters);
        setItems(data.items);
        setLastUpdated(clock.now());
        pollIntervalRef.current = 2000; // Reset backoff on success
      } else {
        // Backoff on error or unauthorized
        pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, 30000);
      }
    } catch {
      pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, 30000);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  // Short polling with tab visibility detection
  useEffect(() => {
    let mounted = true;

    const runPoll = async () => {
      if (mounted && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        await fetchQueue(false);
      }
      if (mounted) {
        pollTimerRef.current = setTimeout(runPoll, pollIntervalRef.current);
      }
    };

    // Initial async execution
    const initialTimer = setTimeout(() => {
      fetchQueue(true).then(() => {
        if (mounted) {
          pollTimerRef.current = setTimeout(runPoll, pollIntervalRef.current);
        }
      });
    }, 0);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        fetchQueue(false);
        runPoll();
      } else {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      mounted = false;
      clearTimeout(initialTimer);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchQueue]);

  const handleAction = async (item: QueueItem, action: string) => {
    setConflictAlert(null);
    setActionLoadingId(`${item.id}-${action}`);

    try {
      const res = await fetch(`/api/queue/${item.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          expectedVersion: item.version,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409 || data.conflict) {
        setConflictAlert(`Conflict: ${data.error || 'The visit was modified by another session.'}`);
        await fetchQueue(false);
      } else if (!res.ok) {
        setConflictAlert(data.error || 'Failed to update visit status.');
        await fetchQueue(false);
      } else {
        await fetchQueue(false);
      }
    } catch {
      setConflictAlert('Network error occurred while updating status. Please try again.');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 px-6 py-4 sticky top-0 z-20 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight">
                  Dr. Susheel&apos;s Live Queue
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Advanced Dental Clinic & Implant Center • Chhatrapati Sambhajinagar
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {lastUpdated && (
              <span
                id="last-updated-indicator"
                className="text-xs text-slate-400 font-mono hidden sm:inline-block"
              >
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}

            <button
              id="btn-refresh-queue"
              type="button"
              onClick={() => fetchQueue(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              Refresh
            </button>

            <Link
              id="link-billing"
              href="/billing"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition shadow-sm"
            >
              Billing & Estimates
            </Link>

            <Link
              id="link-closing-report"
              href="/reports/closing"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm"
            >
              Closing Report
            </Link>

            <Link
              id="link-kiosk"
              href="/register"
              target="_blank"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition border border-slate-700 hidden md:inline-block"
            >
              Open Tablet Kiosk ↗
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Conflict Alert Banner */}
        {conflictAlert && (
          <div
            id="conflict-alert-banner"
            role="alert"
            aria-live="polite"
            className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-sm font-medium flex items-center justify-between gap-3 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <svg
                className="w-5 h-5 text-amber-600 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>{conflictAlert}</span>
            </div>
            <button
              onClick={() => setConflictAlert(null)}
              className="text-xs font-bold text-amber-800 hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Counter Summary Cards */}
        <section
          aria-label="Queue Metrics"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4"
        >
          {/* Waiting */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Waiting
            </span>
            <span
              id="counter-waiting"
              className="text-3xl font-extrabold text-blue-600 font-mono mt-1 block"
            >
              {counters.waiting}
            </span>
          </div>

          {/* In Consultation */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              In Consultation
            </span>
            <span
              id="counter-consultation"
              className="text-3xl font-extrabold text-purple-600 font-mono mt-1 block"
            >
              {counters.inConsultation}
            </span>
          </div>

          {/* Completed */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Completed
            </span>
            <span
              id="counter-completed"
              className="text-3xl font-extrabold text-emerald-600 font-mono mt-1 block"
            >
              {counters.completed}
            </span>
          </div>

          {/* Skipped / No Show */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Skipped / No Show
            </span>
            <span
              id="counter-skipped"
              className="text-3xl font-extrabold text-amber-600 font-mono mt-1 block"
            >
              {counters.skippedOrNoShow}
            </span>
          </div>

          {/* Average Wait Time */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm col-span-2 sm:col-span-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Avg Wait Time
            </span>
            <span
              id="counter-avg-wait"
              className="text-3xl font-extrabold text-slate-800 font-mono mt-1 block"
            >
              {counters.averageWaitMinutes}m
            </span>
          </div>
        </section>

        {/* Live Queue Table / List */}
        <section aria-label="Active Queue" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              Active Queue ({items.length})
            </h2>
          </div>

          {loading ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-600">
              Loading live queue...
            </div>
          ) : items.length === 0 ? (
            <div
              id="queue-empty-state"
              className="bg-white rounded-3xl border border-slate-200 p-12 sm:p-16 text-center shadow-sm"
            >
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                Queue is currently empty
              </h3>
              <p className="text-slate-500 text-sm max-w-md mx-auto mt-1">
                Patients who register on the kiosk tablet will appear here automatically within 5 seconds.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const isInConsult = item.status === 'IN_CONSULTATION';
                const isSkipped = item.status === 'SKIPPED';
                const isWaiting = item.status === 'WAITING';

                return (
                  <div
                    key={item.id}
                    id={`queue-row-${item.id}`}
                    className={`bg-white rounded-2xl border transition shadow-sm p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                      isInConsult
                        ? 'border-purple-300 ring-2 ring-purple-500/20 bg-purple-50/20'
                        : isSkipped
                        ? 'border-amber-200 bg-amber-50/10'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Left: Token and Patient Information */}
                    <div className="flex items-start gap-4">
                      {/* Token Badge */}
                      <div
                        className={`w-14 h-14 rounded-2xl flex items-center justify-center font-mono font-extrabold text-xl shrink-0 shadow-sm ${
                          isInConsult
                            ? 'bg-purple-600 text-white'
                            : isSkipped
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-slate-900 text-white'
                        }`}
                      >
                        #{item.token}
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base sm:text-lg font-bold text-slate-900">
                            {item.patientName}
                          </h3>

                          {/* Status Badge */}
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                              isInConsult
                                ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                : isSkipped
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-blue-100 text-blue-800 border border-blue-200'
                            }`}
                          >
                            {isInConsult
                              ? 'In Consultation'
                              : isSkipped
                              ? 'Skipped'
                              : 'Waiting'}
                          </span>

                          {/* Duplicate Badge */}
                          {item.duplicateFlag && (
                            <span
                              id={`badge-duplicate-${item.id}`}
                              className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200"
                              title={
                                item.possibleDuplicateOfCode
                                  ? `Matches patient code ${item.possibleDuplicateOfCode}`
                                  : 'Possible duplicate profile'
                              }
                            >
                              ⚠️ Duplicate Flag{' '}
                              {item.possibleDuplicateOfCode
                                ? `(${item.possibleDuplicateOfCode})`
                                : ''}
                            </span>
                          )}

                          <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">
                            {item.source}
                          </span>
                        </div>

                        {/* Demographics & Reason */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm text-slate-500">
                          <span>
                            {item.ageYears !== undefined
                              ? `${item.ageYears} yrs`
                              : item.dob || 'Age N/A'}{' '}
                            • {item.sex}
                          </span>
                          <span className="text-slate-700 font-medium">
                            Reason: {item.reasonForVisit}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Wait time & Actions */}
                    <div className="flex flex-wrap items-center justify-between md:justify-end gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                      {/* Wait Time Indicator */}
                      <div className="text-xs sm:text-sm font-mono text-slate-500 whitespace-nowrap">
                        ⏱️ {item.waitingMinutes}m wait
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* WAITING state actions */}
                        {isWaiting && (
                          <>
                            <button
                              id={`btn-call-in-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'CALL_IN')}
                              disabled={actionLoadingId === `${item.id}-CALL_IN`}
                              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition shadow-sm cursor-pointer disabled:opacity-50"
                            >
                              Call In
                            </button>
                            <button
                              id={`btn-skip-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'SKIP')}
                              disabled={actionLoadingId === `${item.id}-SKIP`}
                              className="px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition border border-slate-200 cursor-pointer disabled:opacity-50"
                            >
                              Skip
                            </button>
                            <button
                              id={`btn-noshow-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'NO_SHOW')}
                              disabled={actionLoadingId === `${item.id}-NO_SHOW`}
                              className="px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 transition border border-amber-200 cursor-pointer disabled:opacity-50"
                            >
                              No-Show
                            </button>
                            <button
                              id={`btn-cancel-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'CANCEL')}
                              disabled={actionLoadingId === `${item.id}-CANCEL`}
                              className="px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 transition border border-red-200 cursor-pointer disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        )}

                        {/* IN_CONSULTATION state actions */}
                        {isInConsult && (
                          <>
                            <Link
                              id={`link-consult-${item.id}`}
                              href={`/consult/${item.id}`}
                              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition shadow-sm cursor-pointer"
                            >
                              Consult Workspace →
                            </Link>
                            <button
                              id={`btn-complete-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'COMPLETE')}
                              disabled={actionLoadingId === `${item.id}-COMPLETE`}
                              className="px-5 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 transition shadow-sm cursor-pointer disabled:opacity-50"
                            >
                              Complete
                            </button>
                            <button
                              id={`btn-send-back-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'SEND_BACK')}
                              disabled={actionLoadingId === `${item.id}-SEND_BACK`}
                              className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 transition border border-slate-300 cursor-pointer disabled:opacity-50"
                            >
                              Send Back
                            </button>
                          </>
                        )}

                        {/* SKIPPED state actions */}
                        {isSkipped && (
                          <>
                            <button
                              id={`btn-send-back-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'SEND_BACK')}
                              disabled={actionLoadingId === `${item.id}-SEND_BACK`}
                              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition shadow-sm cursor-pointer disabled:opacity-50"
                            >
                              Send Back to Waiting
                            </button>
                            <button
                              id={`btn-noshow-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'NO_SHOW')}
                              disabled={actionLoadingId === `${item.id}-NO_SHOW`}
                              className="px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 transition border border-amber-200 cursor-pointer disabled:opacity-50"
                            >
                              No-Show
                            </button>
                            <button
                              id={`btn-cancel-${item.id}`}
                              type="button"
                              onClick={() => handleAction(item, 'CANCEL')}
                              disabled={actionLoadingId === `${item.id}-CANCEL`}
                              className="px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 transition border border-red-200 cursor-pointer disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
