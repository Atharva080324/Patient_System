'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatINR, asPaise } from '@/lib/money';

export default function BillingClient() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'bills' | 'estimates'>('bills');
  const [bills, setBills] = useState<any[]>([]);
  const [estimates, setEstimates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const handleConvertEstimate = async (estimateId: string) => {
    try {
      setConvertingId(estimateId);
      const res = await fetch(`/api/estimates/${estimateId}/convert`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to convert estimate to bill');
        return;
      }
      router.push(`/billing/bills/${data.bill._id}`);
    } catch (err: any) {
      alert(err.message || 'Error converting estimate');
    } finally {
      setConvertingId(null);
    }
  };

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [billStatusFilter, setBillStatusFilter] = useState<string>('ALL');
  const [estimateStatusFilter, setEstimateStatusFilter] = useState<string>('ALL');

  const fetchData = useCallback(async () => {
    try {
      const [billsRes, estimatesRes] = await Promise.all([
        fetch('/api/bills'),
        fetch('/api/estimates'),
      ]);

      if (!billsRes.ok) throw new Error('Failed to load bills');
      if (!estimatesRes.ok) throw new Error('Failed to load estimates');

      const billsData = await billsRes.json();
      const estimatesData = await estimatesRes.json();

      setBills(billsData.bills || []);
      setEstimates(estimatesData.estimates || []);
    } catch (err: any) {
      setError(err.message || 'Error loading billing data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([fetch('/api/bills'), fetch('/api/estimates')])
      .then(async ([billsRes, estimatesRes]) => {
        if (!active) return;
        if (!billsRes.ok || !estimatesRes.ok) throw new Error('Failed to load billing data');
        const billsData = await billsRes.json();
        const estimatesData = await estimatesRes.json();
        setBills(billsData.bills || []);
        setEstimates(estimatesData.estimates || []);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Error loading billing data');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Filtered Bills
  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      if (billStatusFilter !== 'ALL' && b.status !== billStatusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchBillNo = b.billNo?.toLowerCase().includes(q);
        const matchPatient = b.snapshot?.patient?.name?.toLowerCase().includes(q);
        const matchCode = b.snapshot?.patient?.patientCode?.toLowerCase().includes(q);
        return matchBillNo || matchPatient || matchCode;
      }
      return true;
    });
  }, [bills, billStatusFilter, searchQuery]);

  // Filtered Estimates
  const filteredEstimates = useMemo(() => {
    return estimates.filter((e) => {
      if (estimateStatusFilter !== 'ALL' && e.status !== estimateStatusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNo = e.estimateNo?.toLowerCase().includes(q);
        const matchPatient = e.snapshot?.patient?.name?.toLowerCase().includes(q);
        const matchNotes = e.notes?.toLowerCase().includes(q);
        return matchNo || matchPatient || matchNotes;
      }
      return true;
    });
  }, [estimates, estimateStatusFilter, searchQuery]);

  // Summary Metrics for Bills
  const metrics = useMemo(() => {
    let billed = 0;
    let collected = 0;
    let outstanding = 0;

    for (const b of filteredBills) {
      if (b.status !== 'CANCELLED') {
        billed += b.total || 0;
        collected += b.paid || 0;
        outstanding += b.balance || 0;
      }
    }

    return { billed, collected, outstanding };
  }, [filteredBills]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/queue"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              ← Queue
            </Link>
            <h1 className="text-lg font-bold text-white tracking-tight">Billing & Estimates</h1>
          </div>

          <div className="flex items-center space-x-3">
            <Link
              id="btn-new-estimate"
              href="/billing/estimates/new"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition"
            >
              + New Estimate
            </Link>
            <Link
              id="btn-new-bill"
              href="/billing/bills/new"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm transition"
            >
              + New Bill
            </Link>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* KPI Metrics Cards */}
        <section aria-label="Billing Totals" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Total Billed
            </span>
            <span id="metric-billed" className="text-2xl sm:text-3xl font-extrabold text-blue-400 font-mono mt-1 block">
              {formatINR(asPaise(metrics.billed))}
            </span>
          </div>

          <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Total Collected
            </span>
            <span id="metric-collected" className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono mt-1 block">
              {formatINR(asPaise(metrics.collected))}
            </span>
          </div>

          <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Outstanding Balance
            </span>
            <span id="metric-outstanding" className="text-2xl sm:text-3xl font-extrabold text-rose-400 font-mono mt-1 block">
              {formatINR(asPaise(metrics.outstanding))}
            </span>
          </div>
        </section>

        {/* Tab Selection & Filter Bar */}
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Tabs */}
          <div role="tablist" aria-label="Document Type" className="flex bg-slate-900 p-1 rounded-xl border border-slate-700/60 w-fit">
            <button
              id="tab-bills"
              role="tab"
              aria-selected={activeTab === 'bills'}
              onClick={() => setActiveTab('bills')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'bills'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Bills ({bills.length})
            </button>
            <button
              id="tab-estimates"
              role="tab"
              aria-selected={activeTab === 'estimates'}
              onClick={() => setActiveTab('estimates')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'estimates'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Estimates ({estimates.length})
            </button>
          </div>

          {/* Search & Status Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <label htmlFor="search-input" className="sr-only">Search</label>
              <input
                id="search-input"
                type="text"
                placeholder="Search patient, code, number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 sm:w-64"
              />
            </div>

            {activeTab === 'bills' ? (
              <div>
                <label htmlFor="filter-bill-status" className="sr-only">Filter by status</label>
                <select
                  id="filter-bill-status"
                  value={billStatusFilter}
                  onChange={(e) => setBillStatusFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="UNPAID">Unpaid</option>
                  <option value="PARTIAL">Partial</option>
                  <option value="PAID">Paid</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            ) : (
              <div>
                <label htmlFor="filter-estimate-status" className="sr-only">Filter by status</label>
                <select
                  id="filter-estimate-status"
                  value={estimateStatusFilter}
                  onChange={(e) => setEstimateStatusFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="DRAFT">Draft</option>
                  <option value="ISSUED">Issued</option>
                  <option value="CONVERTED">Converted</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Content Table */}
        {loading ? (
          <div className="text-center py-12 text-slate-400 font-medium text-sm">
            Loading billing records...
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-sm">
            {error}
          </div>
        ) : activeTab === 'bills' ? (
          /* Bills Table */
          filteredBills.length === 0 ? (
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-12 text-center text-slate-400 text-sm">
              No bills found matching the selected filters.
            </div>
          ) : (
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-700 uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4 font-bold">Bill No</th>
                      <th className="py-3 px-4 font-bold">Date</th>
                      <th className="py-3 px-4 font-bold">Patient</th>
                      <th className="py-3 px-4 font-bold">Items</th>
                      <th className="py-3 px-4 font-bold text-right">Total</th>
                      <th className="py-3 px-4 font-bold text-right">Paid</th>
                      <th className="py-3 px-4 font-bold text-right">Balance</th>
                      <th className="py-3 px-4 font-bold text-center">Status</th>
                      <th className="py-3 px-4 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/60">
                    {filteredBills.map((b) => (
                      <tr key={b._id} className="hover:bg-slate-700/30 transition">
                        <td className="py-3 px-4 font-mono font-bold text-blue-400 whitespace-nowrap">
                          {b.billNo}
                        </td>
                        <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                          {new Date(b.createdAt).toLocaleDateString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-slate-200">
                          <div className="font-semibold text-slate-100">{b.snapshot?.patient?.name || 'Patient'}</div>
                          {b.snapshot?.patient?.patientCode && (
                            <div className="text-[10px] text-slate-400 font-mono">{b.snapshot.patient.patientCode}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-200">
                          {b.items?.map((it: any) => it.description).join(', ') || 'Treatments'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-100 whitespace-nowrap">
                          {formatINR(asPaise(b.total))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-400 whitespace-nowrap">
                          {formatINR(asPaise(b.paid))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-rose-400 whitespace-nowrap">
                          {formatINR(asPaise(b.balance))}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              b.status === 'PAID'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                                : b.status === 'PARTIAL'
                                ? 'bg-amber-950 text-amber-300 border border-amber-700'
                                : b.status === 'CANCELLED'
                                ? 'bg-rose-950 text-rose-300 border border-rose-700'
                                : 'bg-slate-700 text-slate-200'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          <Link
                            id={`btn-view-bill-${b._id}`}
                            href={`/billing/bills/${b._id}`}
                            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition"
                          >
                            View
                          </Link>
                          <Link
                            id={`btn-print-bill-${b._id}`}
                            href={`/print/bill/${b._id}`}
                            target="_blank"
                            className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium transition"
                          >
                            Print ↗
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          /* Estimates Table */
          filteredEstimates.length === 0 ? (
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-12 text-center text-slate-400 text-sm">
              No estimates found matching the selected filters.
            </div>
          ) : (
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-700 uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4 font-bold">Estimate No</th>
                      <th className="py-3 px-4 font-bold">Date</th>
                      <th className="py-3 px-4 font-bold">Patient</th>
                      <th className="py-3 px-4 font-bold">Items Summary</th>
                      <th className="py-3 px-4 font-bold text-right">Total</th>
                      <th className="py-3 px-4 font-bold">Valid Until</th>
                      <th className="py-3 px-4 font-bold text-center">Status</th>
                      <th className="py-3 px-4 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/60">
                    {filteredEstimates.map((e) => (
                      <tr key={e._id} className="hover:bg-slate-700/30 transition">
                        <td className="py-3 px-4 font-mono font-bold text-blue-400 whitespace-nowrap">
                          {e.estimateNo || 'DRAFT'}
                        </td>
                        <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                          {new Date(e.createdAt).toLocaleDateString('en-IN')}
                        </td>
                        <td className="py-3 px-4 text-slate-200">
                          <div className="font-semibold text-slate-100">{e.snapshot?.patient?.name || 'Patient'}</div>
                          {e.snapshot?.patient?.patientCode && (
                            <div className="text-[10px] text-slate-400 font-mono">{e.snapshot.patient.patientCode}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-200">
                          {e.items?.map((it: any) => it.description).join(', ') || 'Procedures'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-100 whitespace-nowrap">
                          {formatINR(asPaise(e.total))}
                        </td>
                        <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                          {e.validUntil || '—'}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              e.status === 'ISSUED'
                                ? 'bg-blue-950 text-blue-300 border border-blue-700'
                                : e.status === 'CONVERTED'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                                : e.status === 'CANCELLED'
                                ? 'bg-rose-950 text-rose-300 border border-rose-700'
                                : 'bg-slate-700 text-slate-300'
                            }`}
                          >
                            {e.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          {e.status === 'ISSUED' && (
                            <>
                              <button
                                type="button"
                                id={`btn-convert-estimate-${e._id}`}
                                onClick={() => handleConvertEstimate(e._id)}
                                disabled={convertingId === e._id}
                                className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition disabled:opacity-50"
                              >
                                {convertingId === e._id ? 'Converting...' : 'Convert to Bill'}
                              </button>
                              <Link
                                id={`btn-print-estimate-${e._id}`}
                                href={`/print/estimate/${e._id}`}
                                target="_blank"
                                className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition"
                              >
                                Print ↗
                              </Link>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
}
