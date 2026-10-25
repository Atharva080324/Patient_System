'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clock } from '@/lib/clock';

interface PatientOption {
  _id: string;
  name: string;
  phone: string;
  patientCode: string;
}

interface FollowUpItem {
  _id: string;
  patientId: {
    _id: string;
    name: string;
    phone: string;
    patientCode: string;
  };
  dueDate: string;
  reason: string;
  note?: string;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  computedCategory: 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'DONE';
  doneAt?: string;
  sourceVisitId?: string;
  createdAt: string;
}

interface TabCounts {
  overdue: number;
  today: number;
  upcoming: number;
  done: number;
}

export default function FollowUpsClient() {
  const router = useRouter();

  // Selected tab
  const [activeTab, setActiveTab] = useState<'OVERDUE' | 'TODAY' | 'UPCOMING' | 'DONE'>('TODAY');

  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [counts, setCounts] = useState<TabCounts>({ overdue: 0, today: 0, upcoming: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Today in IST
  const todayStr = useMemo(() => {
    return new Date(clock.now().getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  }, []);

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [changeDateModalOpen, setChangeDateModalOpen] = useState(false);
  const [selectedFollowUp, setSelectedFollowUp] = useState<FollowUpItem | null>(null);

  // Add form state
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [dueDate, setDueDate] = useState(todayStr);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Change date state
  const [newDueDate, setNewDueDate] = useState('');

  // Fetch followups
  const fetchFollowUps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/followups?tab=${activeTab}`);
      if (!res.ok) throw new Error('Failed to load follow-ups');
      const data = await res.json();
      setFollowUps(data.followUps || []);
      setCounts(data.counts || { overdue: 0, today: 0, upcoming: 0, done: 0 });
    } catch (err: any) {
      setError(err.message || 'Error loading follow-ups');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchFollowUps();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchFollowUps]);

  // Patient search
  useEffect(() => {
    if (!patientQuery.trim()) {
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
  }, [patientQuery]);

  // Handle Create Follow-up
  const handleCreateFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    if (!selectedPatient) {
      setAddError('Please select a patient');
      return;
    }
    if (!reason.trim()) {
      setAddError('Reason is required');
      return;
    }
    if (!dueDate) {
      setAddError('Due date is required');
      return;
    }

    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatient._id,
          dueDate,
          reason: reason.trim(),
          note: note.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || 'Failed to create follow-up');
        return;
      }

      setAddModalOpen(false);
      resetAddForm();
      setActionSuccess('Follow-up scheduled successfully!');
      fetchFollowUps();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setAddError(err.message || 'Error creating follow-up');
    }
  };

  const resetAddForm = () => {
    setSelectedPatient(null);
    setPatientQuery('');
    setDueDate(todayStr);
    setReason('');
    setNote('');
    setAddError(null);
  };

  // Mark Done
  const handleMarkDone = async (item: FollowUpItem) => {
    try {
      const res = await fetch(`/api/followups/${item._id}/done`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to mark follow-up as done');
        return;
      }
      setActionSuccess(`Follow-up for ${item.patientId?.name || 'patient'} marked as completed.`);
      fetchFollowUps();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error updating follow-up');
    }
  };

  // Cancel Follow-up
  const handleCancelFollowUp = async (item: FollowUpItem) => {
    if (!confirm(`Cancel follow-up for ${item.patientId?.name || 'patient'}?`)) return;

    try {
      const res = await fetch(`/api/followups/${item._id}/cancel`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to cancel follow-up');
        return;
      }
      setActionSuccess('Follow-up cancelled.');
      fetchFollowUps();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error cancelling follow-up');
    }
  };

  // Change Date
  const handleChangeDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFollowUp || !newDueDate) return;

    try {
      const res = await fetch(`/api/followups/${selectedFollowUp._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: newDueDate }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to change due date');
        return;
      }

      setChangeDateModalOpen(false);
      setSelectedFollowUp(null);
      setActionSuccess('Due date updated successfully.');
      fetchFollowUps();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Error changing due date');
    }
  };

  // Book appointment prefilled
  const handleBookAppointment = (item: FollowUpItem) => {
    if (!item.patientId) return;
    const url = `/appointments?patientId=${item.patientId._id}&name=${encodeURIComponent(
      item.patientId.name
    )}&phone=${encodeURIComponent(item.patientId.phone || '')}&code=${encodeURIComponent(
      item.patientId.patientCode || ''
    )}`;
    router.push(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400 font-bold text-lg">
              🩺
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Follow-up Tracking
              </h1>
              <p className="text-xs text-slate-400">
                Dr. Susheel&apos;s Advanced Dental Clinic &bull; Continuous Care
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
              id="nav-link-appointments"
              href="/appointments"
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Appointments
            </Link>
            <button
              id="btn-add-followup-header"
              type="button"
              onClick={() => {
                resetAddForm();
                setAddModalOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition shadow-sm cursor-pointer"
            >
              + Add Follow-up
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
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

        {/* Tabs Bar with Counts */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-2xl p-1.5 gap-1.5 overflow-x-auto">
          <button
            id="tab-overdue"
            type="button"
            onClick={() => setActiveTab('OVERDUE')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'OVERDUE'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Overdue</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                activeTab === 'OVERDUE' ? 'bg-rose-800 text-white' : 'bg-slate-800 text-rose-400'
              }`}
            >
              {counts.overdue}
            </span>
          </button>

          <button
            id="tab-today"
            type="button"
            onClick={() => setActiveTab('TODAY')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'TODAY'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Due Today</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                activeTab === 'TODAY' ? 'bg-blue-800 text-white' : 'bg-slate-800 text-blue-400'
              }`}
            >
              {counts.today}
            </span>
          </button>

          <button
            id="tab-upcoming"
            type="button"
            onClick={() => setActiveTab('UPCOMING')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'UPCOMING'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Upcoming</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                activeTab === 'UPCOMING' ? 'bg-purple-800 text-white' : 'bg-slate-800 text-purple-400'
              }`}
            >
              {counts.upcoming}
            </span>
          </button>

          <button
            id="tab-done"
            type="button"
            onClick={() => setActiveTab('DONE')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'DONE'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Done / Cancelled</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                activeTab === 'DONE' ? 'bg-emerald-800 text-white' : 'bg-slate-800 text-emerald-400'
              }`}
            >
              {counts.done}
            </span>
          </button>
        </div>

        {/* Content Area */}
        {loading ? (
          <div className="text-center py-16 text-slate-400 font-medium text-sm">
            Loading follow-up tasks...
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-sm">
            {error}
          </div>
        ) : followUps.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-sm">
            No follow-ups in this tab.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {followUps.map((item) => {
              const isOverdue = item.computedCategory === 'OVERDUE';
              const isToday = item.computedCategory === 'TODAY';
              const isPending = item.status === 'PENDING';

              return (
                <div
                  key={item._id}
                  className={`bg-slate-900/60 border rounded-2xl p-4 flex flex-col justify-between transition space-y-3 ${
                    isOverdue
                      ? 'border-rose-900/70 hover:border-rose-700'
                      : isToday
                      ? 'border-blue-800/80 hover:border-blue-600'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-white">
                          {item.patientId?.name || 'Unknown Patient'}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          {item.patientId?.patientCode && (
                            <span className="mr-2 text-slate-500">
                              #{item.patientId.patientCode}
                            </span>
                          )}
                          {item.patientId?.phone && (
                            <a
                              href={`tel:${item.patientId.phone}`}
                              className="text-blue-400 hover:underline"
                            >
                              📞 {item.patientId.phone}
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Status / Category Badge */}
                      {item.status === 'DONE' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                          Completed
                        </span>
                      ) : item.status === 'CANCELLED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400">
                          Cancelled
                        </span>
                      ) : isOverdue ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                          Overdue
                        </span>
                      ) : isToday ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800">
                          Due Today
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
                          Upcoming
                        </span>
                      )}
                    </div>

                    <div className="text-xs font-mono font-medium text-slate-300 pt-1">
                      Due Date: <span className="font-bold text-white">{item.dueDate}</span>
                    </div>

                    <div className="bg-slate-950/60 rounded-xl p-2.5 text-xs text-slate-300 space-y-1">
                      <div className="font-medium text-slate-200">{item.reason}</div>
                      {item.note && (
                        <div className="text-[11px] text-slate-400 italic">&ldquo;{item.note}&rdquo;</div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {isPending && (
                    <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => handleMarkDone(item)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition cursor-pointer"
                      >
                        Mark Done
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFollowUp(item);
                          setNewDueDate(item.dueDate);
                          setChangeDateModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                      >
                        Change Date
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBookAppointment(item)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition cursor-pointer"
                      >
                        Book Appt
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancelFollowUp(item)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Add Follow-Up Modal */}
      {addModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-add-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl my-8">
            <div className="flex items-center justify-between">
              <h2 id="modal-add-title" className="text-lg font-bold text-white">
                Add Follow-up Reminder
              </h2>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {addError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                {addError}
              </div>
            )}

            <form onSubmit={handleCreateFollowUp} className="space-y-4">
              {/* Patient Search */}
              <div className="space-y-2">
                <label htmlFor="followup-patient-search" className="block text-xs font-semibold text-slate-300">
                  Search Patient (Name, Phone, Code) *
                </label>
                <input
                  id="followup-patient-search"
                  type="text"
                  placeholder="Type name, phone or code..."
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />

                {selectedPatient && (
                  <div className="p-2.5 rounded-xl bg-purple-950/40 border border-purple-800/80 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-purple-300">{selectedPatient.name}</span>
                      <span className="text-slate-400 ml-2 font-mono">{selectedPatient.phone}</span>
                      <span className="text-slate-500 ml-2 font-mono">({selectedPatient.patientCode})</span>
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

              {/* Due Date */}
              <div>
                <label htmlFor="followup-due-date" className="block text-xs font-semibold text-slate-300 mb-1">
                  Due Date (YYYY-MM-DD) *
                </label>
                <input
                  id="followup-due-date"
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Reason */}
              <div>
                <label htmlFor="followup-reason" className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason for Follow-up *
                </label>
                <input
                  id="followup-reason"
                  type="text"
                  required
                  placeholder="e.g. Suture removal / Crown cementation check"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Note */}
              <div>
                <label htmlFor="followup-note" className="block text-xs font-semibold text-slate-300 mb-1">
                  Additional Note (Optional)
                </label>
                <textarea
                  id="followup-note"
                  rows={2}
                  placeholder="Clinical notes or reminder context..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-add-followup"
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white cursor-pointer"
                >
                  Save Follow-up
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Due Date Modal */}
      {changeDateModalOpen && selectedFollowUp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-change-date-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h2 id="modal-change-date-title" className="text-lg font-bold text-white">
              Change Due Date
            </h2>
            <p className="text-xs text-slate-400">
              Update due date for{' '}
              <span className="text-white font-semibold">
                {selectedFollowUp.patientId?.name || 'patient'}
              </span>
              :
            </p>

            <form onSubmit={handleChangeDate} className="space-y-4">
              <div>
                <label htmlFor="new-due-date" className="block text-xs font-semibold text-slate-300 mb-1">
                  New Due Date *
                </label>
                <input
                  id="new-due-date"
                  type="date"
                  required
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setChangeDateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-change-date"
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white"
                >
                  Update Date
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
