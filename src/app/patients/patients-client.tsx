'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { formatRupees } from '@/lib/money';
import { clock } from '@/lib/clock';

interface PatientRow {
  _id: string;
  patientCode: string;
  name: string;
  phone: string;
  sex: string;
  ageYears?: number;
  dob?: string;
  source: string;
  registeredAt: string;
  lastVisitDate?: string;
  visitCount: number;
  outstandingBalance: number;
}

export default function PatientsClient() {
  const _router = useRouter();
  const [_isPending, _startTransition] = useTransition();

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'patientCode' | 'lastVisit' | 'registeredAt'>('registeredAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, _setPageSize] = useState<number>(25);

  const [hasBalance, setHasBalance] = useState<boolean>(false);
  const [hasFollowUpDue, setHasFollowUpDue] = useState<boolean>(false);
  const [source, setSource] = useState<string>('');
  const [lastVisitFrom, setLastVisitFrom] = useState<string>('');
  const [lastVisitTo, setLastVisitTo] = useState<string>('');

  // Results state
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Export CSV Modal state
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // POST is preferred over query params to prevent search term leakage into web server logs
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: debouncedSearch.trim() || undefined,
          page,
          pageSize,
          sortBy,
          sortOrder,
          hasBalance: hasBalance ? true : undefined,
          hasFollowUpDue: hasFollowUpDue ? true : undefined,
          source: source || undefined,
          lastVisitFrom: lastVisitFrom || undefined,
          lastVisitTo: lastVisitTo || undefined,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        throw new Error('Failed to load patients');
      }

      const data = await res.json();
      setPatients(data.patients || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err: any) {
      setError(err.message || 'Error fetching patients');
    } finally {
      setLoading(false);
    }
  }, [
    debouncedSearch,
    page,
    pageSize,
    sortBy,
    sortOrder,
    hasBalance,
    hasFollowUpDue,
    source,
    lastVisitFrom,
    lastVisitTo,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPatients();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchPatients]);

  const handleSort = (field: 'name' | 'patientCode' | 'lastVisit' | 'registeredAt') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const handleExportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    setExportLoading(true);
    setExportError(null);

    try {
      const res = await fetch('/api/patients/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: debouncedSearch.trim() || undefined,
          sortBy,
          sortOrder,
          hasBalance: hasBalance ? true : undefined,
          hasFollowUpDue: hasFollowUpDue ? true : undefined,
          source: source || undefined,
          lastVisitFrom: lastVisitFrom || undefined,
          lastVisitTo: lastVisitTo || undefined,
          password: exportPassword || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'CSV export failed');
      }

      // Download CSV blob
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = 'patients.csv';
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setExportModalOpen(false);
      setExportPassword('');
    } catch (err: any) {
      setExportError(err.message || 'CSV export failed');
    } finally {
      setExportLoading(false);
    }
  };

  const getAgeDisplay = (p: PatientRow) => {
    if (p.dob) {
      const birth = new Date(p.dob);
      const now = clock.now();
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
      return `${age}y`;
    }
    if (p.ageYears !== undefined && p.ageYears !== null) {
      return `${p.ageYears}y`;
    }
    return '—';
  };

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
      <Sidebar activeItem="patients" />

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Header */}
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Patients Directory
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage clinical records, view patient profiles, and export filtered registries
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="btn-export-csv"
              type="button"
              onClick={() => {
                setExportError(null);
                setExportModalOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition shadow-sm"
            >
              Export CSV
            </button>

            <Link
              id="btn-new-patient"
              href="/register"
              target="_blank"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm"
            >
              + New Patient
            </Link>
          </div>
        </header>

        {/* Search & Filters Bar */}
        <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input Box */}
            <div className="relative flex-1 min-w-[280px]">
              <label htmlFor="input-search-patients" className="sr-only">
                Search patients by name, phone, or code
              </label>
              <input
                id="input-search-patients"
                type="text"
                placeholder="Search name (e.g. Rahul, राहुल), phone (9822..., +91...), code (P-000123, 123)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <svg
                className="w-4 h-4 text-slate-400 absolute left-3 top-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>

            {/* Registration Source Filter */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="select-source" className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Source:
              </label>
              <select
                id="select-source"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setPage(1);
                }}
                className="text-xs px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                <option value="">All Sources</option>
                <option value="WALK_IN">Walk-In</option>
                <option value="WEBSITE">Website</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="MANUAL">Manual</option>
              </select>
            </div>

            {/* Quick Checkboxes */}
            <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                id="filter-has-balance"
                type="checkbox"
                checked={hasBalance}
                onChange={(e) => {
                  setHasBalance(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Outstanding Balance</span>
            </label>

            <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                id="filter-has-followup"
                type="checkbox"
                checked={hasFollowUpDue}
                onChange={(e) => {
                  setHasFollowUpDue(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Follow-up Due</span>
            </label>
          </div>

          {/* Date range filter */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-500 font-medium">Last Visit Range:</span>
            <div className="flex items-center gap-1">
              <label htmlFor="filter-visit-from" className="sr-only">From Date</label>
              <input
                id="filter-visit-from"
                type="date"
                value={lastVisitFrom}
                onChange={(e) => {
                  setLastVisitFrom(e.target.value);
                  setPage(1);
                }}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              />
              <span className="text-slate-400">to</span>
              <label htmlFor="filter-visit-to" className="sr-only">To Date</label>
              <input
                id="filter-visit-to"
                type="date"
                value={lastVisitTo}
                onChange={(e) => {
                  setLastVisitTo(e.target.value);
                  setPage(1);
                }}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              />
            </div>

            {(searchTerm || hasBalance || hasFollowUpDue || source || lastVisitFrom || lastVisitTo) && (
              <button
                id="btn-clear-filters"
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setHasBalance(false);
                  setHasFollowUpDue(false);
                  setSource('');
                  setLastVisitFrom('');
                  setLastVisitTo('');
                  setPage(1);
                }}
                className="text-xs text-blue-600 hover:text-blue-500 font-medium ml-auto"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>

        {/* Patients Table & Responsive Mobile Cards */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
              {error}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            {/* Desktop Table View (>= 640px) */}
            <div tabIndex={0} role="region" aria-label="Patients list table" className="hidden sm:block overflow-x-auto focus:outline-none focus:ring-1 focus:ring-blue-500">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                    <th scope="col" className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleSort('patientCode')}
                        className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Code {sortBy === 'patientCode' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </button>
                    </th>
                    <th scope="col" className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleSort('name')}
                        className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </button>
                    </th>
                    <th scope="col" className="py-3 px-4">Age / Sex</th>
                    <th scope="col" className="py-3 px-4">Phone</th>
                    <th scope="col" className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleSort('lastVisit')}
                        className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                      >
                        Last Visit {sortBy === 'lastVisit' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </button>
                    </th>
                    <th scope="col" className="py-3 px-4 text-center">Visits</th>
                    <th scope="col" className="py-3 px-4 text-right">Balance</th>
                    <th scope="col" className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        Loading patients...
                      </td>
                    </tr>
                  ) : patients.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        No patients found matching your search criteria.
                      </td>
                    </tr>
                  ) : (
                    patients.map((p) => (
                      <tr
                        key={p._id}
                        id={`patient-row-${p.patientCode}`}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono font-medium text-slate-600 dark:text-slate-400">
                          {p.patientCode}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                          <Link
                            id={`patient-link-${p.patientCode}`}
                            href={`/patients/${p._id}`}
                            className="hover:text-blue-600 hover:underline"
                          >
                            {p.name}
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                          {getAgeDisplay(p)} · {p.sex}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">
                          {p.phone}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                          {p.lastVisitDate ? p.lastVisitDate.slice(0, 10) : '—'}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-slate-800 dark:text-slate-200">
                          {p.visitCount}
                        </td>
                        <td className="py-3 px-4 text-right font-medium">
                          {p.outstandingBalance > 0 ? (
                            <span className="text-rose-600 font-semibold">
                              {formatRupees(p.outstandingBalance)}
                            </span>
                          ) : (
                            <span className="text-slate-400">₹0.00</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link
                            id={`btn-open-patient-${p.patientCode}`}
                            href={`/patients/${p._id}`}
                            className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition"
                          >
                            Profile →
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Card View (< 640px) */}
            <div className="block sm:hidden divide-y divide-slate-100 dark:divide-slate-800 p-2">
              {loading ? (
                <div className="py-12 text-center text-xs text-slate-500">Loading patients...</div>
              ) : patients.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No patients found matching your search.
                </div>
              ) : (
                patients.map((p) => (
                  <div key={p._id} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-slate-500">
                        {p.patientCode}
                      </span>
                      <span className="text-xs text-slate-500">
                        {p.sex} · {getAgeDisplay(p)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <Link
                        href={`/patients/${p._id}`}
                        className="font-bold text-sm text-slate-900 dark:text-white hover:text-blue-600"
                      >
                        {p.name}
                      </Link>
                      {p.outstandingBalance > 0 ? (
                        <span className="text-xs font-bold text-rose-600">
                          Due: {formatRupees(p.outstandingBalance)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Paid</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Phone: {p.phone}</span>
                      <span>Visits: {p.visitCount}</span>
                    </div>

                    <div className="flex justify-end pt-1">
                      <Link
                        href={`/patients/${p._id}`}
                        className="w-full text-center py-1.5 rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-semibold text-xs"
                      >
                        Open Profile
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination Controls */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                Showing {patients.length > 0 ? (page - 1) * pageSize + 1 : 0} to{' '}
                {Math.min(page * pageSize, total)} of {total} patients
              </span>

              <div className="flex items-center gap-2">
                <button
                  id="btn-prev-page"
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Previous
                </button>

                <span className="font-semibold text-slate-800 dark:text-slate-200 px-1">
                  Page {page} of {totalPages}
                </span>

                <button
                  id="btn-next-page"
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CSV Export Confirmation Modal */}
        {exportModalOpen && (
          <div
            id="modal-csv-export"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-csv-title"
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 id="modal-csv-title" className="text-base font-bold text-slate-900 dark:text-white">
                  Export Patients CSV
                </h3>
                <button
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold"
                >
                  &times;
                </button>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400">
                You are about to export <span className="font-bold text-slate-900 dark:text-white">{total}</span> matching records based on your currently applied filters and sorting.
              </p>

              {total > 20000 && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl">
                  Warning: The maximum CSV export limit is 20,000 rows. Please filter your dataset to under 20,000 records.
                </div>
              )}

              {exportError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
                  {exportError}
                </div>
              )}

              <form onSubmit={handleExportCsv} className="space-y-4">
                <div>
                  <label
                    htmlFor="input-export-password"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Confirm Doctor Password (valid for 5 minutes):
                  </label>
                  <input
                    id="input-export-password"
                    type="password"
                    required
                    placeholder="Enter your doctor password"
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Security requirement: Patient PII export requires verified doctor authentication.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setExportModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>

                  <button
                    id="btn-confirm-export"
                    type="submit"
                    disabled={exportLoading || total > 20000}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-sm disabled:opacity-50"
                  >
                    {exportLoading ? 'Generating CSV...' : 'Download CSV'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
