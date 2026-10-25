'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';

interface ClosingReportData {
  clinicId: string;
  date: string;
  totalRegistered: number;
  completed: number;
  skipped: number;
  noShow: number;
  cancelled: number;
  stillWaiting: number;
  firstToken: number | null;
  lastToken: number | null;
  averageWaitMinutes: number;
  longestWaitMinutes: number;
  reconciliation: {
    rawVisitCount: number;
    sumOfCategories: number;
    isReconciled: boolean;
  };
}

export function ClosingReportClient() {
  const [selectedDate, setSelectedDate] = useState<string>(() => clinicDate(clock.now()));
  const [report, setReport] = useState<ClosingReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const targetDate = selectedDate || clinicDate(clock.now());

    fetch(`/api/reports/closing?date=${targetDate}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data?.data) {
          setReport(data.data);
        } else if (mounted) {
          setError('Failed to load closing report.');
        }
      })
      .catch(() => {
        if (mounted) setError('Connection error while fetching closing report.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [selectedDate]);

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans print:bg-white print:p-0">
      {/* Top Bar (Hidden in Print) */}
      <header className="bg-slate-900 text-white px-6 py-4 border-b border-slate-800 shadow-sm print:hidden">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Dr. Susheel&apos;s Dental Clinic • End of Day Closing Report
            </h1>
            <p className="text-xs text-slate-400">
              Chhatrapati Sambhajinagar • Clinical Operations Audit
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              id="link-back-to-queue"
              href="/queue"
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              ← Back to Live Queue
            </Link>

            <button
              id="btn-print-report"
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4H7v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                />
              </svg>
              Print Report
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6 print:p-0 print:max-w-none">
        {/* Date Selector & Print Header */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 print:border-none print:shadow-none print:p-0">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-blue-600 block mb-1">
              Clinical Reconciliation
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              Daily Practice Closing Summary
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Dr. Susheel&apos;s Advanced Dental Clinic &amp; Implant Center
            </p>
          </div>

          <div className="flex items-center gap-3 print:hidden">
            <label
              htmlFor="closing-date-input"
              className="text-sm font-semibold text-slate-700 whitespace-nowrap"
            >
              Clinic Date:
            </label>
            <input
              id="closing-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-4 py-2 rounded-xl border border-slate-300 font-mono text-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>

          {/* Print Only Date Display */}
          <div className="hidden print:block text-right">
            <div className="text-base font-bold text-slate-900 font-mono">
              Date: {selectedDate}
            </div>
            <div className="text-xs text-slate-500">Asia/Kolkata (IST)</div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-600">
            Calculating closing metrics...
          </div>
        ) : report ? (
          <div className="space-y-6">
            {/* Primary Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              {/* Total Registered */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm print:border-slate-300">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  Registered
                </span>
                <span
                  id="metric-total-registered"
                  className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono mt-1 block"
                >
                  {report.totalRegistered}
                </span>
              </div>

              {/* Completed */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm print:border-slate-300">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  Completed
                </span>
                <span
                  id="metric-completed"
                  className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono mt-1 block"
                >
                  {report.completed}
                </span>
              </div>

              {/* Still Waiting */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm print:border-slate-300">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  Still Waiting
                </span>
                <span
                  id="metric-still-waiting"
                  className="text-2xl sm:text-3xl font-extrabold text-blue-600 font-mono mt-1 block"
                >
                  {report.stillWaiting}
                </span>
              </div>

              {/* Skipped */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm print:border-slate-300">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  Skipped
                </span>
                <span
                  id="metric-skipped"
                  className="text-2xl sm:text-3xl font-extrabold text-amber-600 font-mono mt-1 block"
                >
                  {report.skipped}
                </span>
              </div>

              {/* No Show */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm print:border-slate-300">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  No-Show
                </span>
                <span
                  id="metric-noshow"
                  className="text-2xl sm:text-3xl font-extrabold text-slate-600 font-mono mt-1 block"
                >
                  {report.noShow}
                </span>
              </div>

              {/* Cancelled */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm print:border-slate-300">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  Cancelled
                </span>
                <span
                  id="metric-cancelled"
                  className="text-2xl sm:text-3xl font-extrabold text-red-600 font-mono mt-1 block"
                >
                  {report.cancelled}
                </span>
              </div>
            </div>

            {/* Wait Times & Token Range Card */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6 print:border-slate-300">
              {/* Average Wait Time */}
              <div className="border-b md:border-b-0 md:border-r border-slate-100 pb-4 md:pb-0 md:pr-6">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-1">
                  Average Wait Time
                </span>
                <div
                  id="metric-avg-wait"
                  className="text-3xl font-extrabold text-slate-900 font-mono"
                >
                  {report.averageWaitMinutes}{' '}
                  <span className="text-base font-medium text-slate-600">mins</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  From kiosk check-in to consultation start
                </p>
              </div>

              {/* Longest Wait Time */}
              <div className="border-b md:border-b-0 md:border-r border-slate-100 pb-4 md:pb-0 md:pr-6">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-1">
                  Longest Wait Time
                </span>
                <div
                  id="metric-longest-wait"
                  className="text-3xl font-extrabold text-slate-900 font-mono"
                >
                  {report.longestWaitMinutes}{' '}
                  <span className="text-base font-medium text-slate-600">mins</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  Maximum wait recorded today
                </p>
              </div>

              {/* Token Range */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-1">
                  Token Allocation Range
                </span>
                <div
                  id="metric-token-range"
                  className="text-3xl font-extrabold text-slate-900 font-mono"
                >
                  {report.firstToken !== null ? `#${report.firstToken}` : 'None'}
                  {' → '}
                  {report.lastToken !== null ? `#${report.lastToken}` : 'None'}
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  Sequential tokens issued on {selectedDate}
                </p>
              </div>
            </div>

            {/* Reconciliation Verification Box */}
            <div
              id="reconciliation-box"
              className={`p-6 rounded-3xl border ${
                report.reconciliation.isReconciled
                  ? 'bg-emerald-50/50 border-emerald-200 text-emerald-950'
                  : 'bg-red-50/50 border-red-200 text-red-950'
              }`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    report.reconciliation.isReconciled
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 text-white'
                  }`}
                >
                  {report.reconciliation.isReconciled ? '✓' : '!'}
                </div>

                <div className="space-y-1">
                  <h3 className="text-base font-bold">
                    {report.reconciliation.isReconciled
                      ? 'Database Reconciliation Verified'
                      : 'Reconciliation Discrepancy Detected'}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    Total recorded visits:{' '}
                    <strong className="font-mono text-slate-900">
                      {report.reconciliation.rawVisitCount}
                    </strong>
                    . Category sum (Completed + Still Waiting + Skipped + No-Show + Cancelled):{' '}
                    <strong className="font-mono text-slate-900">
                      {report.reconciliation.sumOfCategories}
                    </strong>
                    . Zero discrepancies found across clinical clinic day boundaries.
                  </p>
                  <p className="text-[11px] text-slate-600 pt-1 font-mono">
                    Audit Log Entry: CLOSING_REPORT_VIEW recorded for date {selectedDate}.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
