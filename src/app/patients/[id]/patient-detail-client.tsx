'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { formatRupees } from '@/lib/money';
import { clock } from '@/lib/clock';

interface PatientProfile {
  _id: string;
  name: string;
  phone: string;
  patientCode: string;
  sex: string;
  ageYears?: number;
  dob?: string;
  source: string;
  allergies: string[];
  medicalNotes: string;
  generalNotes: string;
  registeredAt: string;
  version: number;
  duplicateDismissed: boolean;
}

interface DuplicateCandidate {
  _id: string;
  name: string;
  phone: string;
  patientCode: string;
}

interface BillRow {
  _id: string;
  billNumber: string;
  billDate: string;
  status: string;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
}

interface BillingSummary {
  totalBilled: number;
  totalPaid: number;
  outstandingBalance: number;
  bills: BillRow[];
}

interface TimelineItem {
  id: string;
  type: 'VISIT' | 'CASE_SHEET' | 'PRESCRIPTION' | 'ESTIMATE' | 'BILL' | 'PAYMENT' | 'PAYMENT_REVERSAL' | 'APPOINTMENT' | 'FOLLOW_UP';
  title: string;
  date: string;
  badge?: string;
  summary: string;
  link?: string;
}

export default function PatientDetailClient({ patientId }: { patientId: string }) {
  const _router = useRouter();

  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'billing'>('overview');
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [duplicateCandidate, setDuplicateCandidate] = useState<DuplicateCandidate | null>(null);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Timeline feed state
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineCursor, setTimelineCursor] = useState<string | undefined>(undefined);
  const [hasMoreTimeline, setHasMoreTimeline] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Edit Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSex, setEditSex] = useState('Male');
  const [editAgeType, setEditAgeType] = useState<'years' | 'dob'>('years');
  const [editAgeYears, setEditAgeYears] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editAllergies, setEditAllergies] = useState('');
  const [editMedicalNotes, setEditMedicalNotes] = useState('');
  const [editGeneralNotes, setEditGeneralNotes] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Dismiss duplicate state
  const [dismissingDuplicate, setDismissingDuplicate] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${patientId}`);
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        throw new Error('Failed to load patient record');
      }
      const data = await res.json();
      setPatient(data.patient);
      setDuplicateCandidate(data.duplicateCandidate);
      setBillingSummary(data.billingSummary);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error fetching patient');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const fetchTimeline = useCallback(
    async (cursor?: string, append = false) => {
      setTimelineLoading(true);
      try {
        const url = `/api/patients/${patientId}/timeline?limit=15${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load timeline');
        const data = await res.json();
        if (append) {
          setTimeline((prev) => [...prev, ...data.items]);
        } else {
          setTimeline(data.items);
        }
        setTimelineCursor(data.nextCursor);
        setHasMoreTimeline(data.hasMore);
      } catch (err: any) {
        console.error('Timeline error:', err);
      } finally {
        setTimelineLoading(false);
      }
    },
    [patientId]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProfile();
      fetchTimeline();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchProfile, fetchTimeline]);

  // Open Edit Modal with current values
  const handleOpenEdit = () => {
    if (!patient) return;
    setEditName(patient.name);
    setEditPhone(patient.phone);
    setEditSex(patient.sex);
    if (patient.dob) {
      setEditAgeType('dob');
      setEditDob(patient.dob.slice(0, 10));
      setEditAgeYears('');
    } else {
      setEditAgeType('years');
      setEditAgeYears(patient.ageYears !== undefined ? String(patient.ageYears) : '');
      setEditDob('');
    }
    setEditAllergies((patient.allergies || []).join(', '));
    setEditMedicalNotes(patient.medicalNotes || '');
    setEditGeneralNotes(patient.generalNotes || '');
    setEditError(null);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient) return;
    setEditSubmitting(true);
    setEditError(null);

    const allergiesArray = editAllergies
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: patient.version,
          name: editName.trim(),
          phone: editPhone.trim(),
          sex: editSex,
          ageYears: editAgeType === 'years' && editAgeYears ? parseInt(editAgeYears, 10) : undefined,
          dob: editAgeType === 'dob' && editDob ? editDob : undefined,
          allergies: allergiesArray,
          medicalNotes: editMedicalNotes.trim(),
          generalNotes: editGeneralNotes.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error('Conflict: Record was modified by another session. Please refresh to load latest changes.');
        }
        throw new Error(data.error || 'Failed to update patient');
      }

      await fetchProfile();
      setEditModalOpen(false);
    } catch (err: any) {
      setEditError(err.message || 'Update failed');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDismissDuplicate = async () => {
    if (!confirm('Are you sure you want to dismiss this duplicate warning?')) return;
    setDismissingDuplicate(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/dismiss-duplicate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to dismiss');
        return;
      }
      setDuplicateCandidate(null);
      if (patient) {
        setPatient({ ...patient, duplicateDismissed: true });
      }
    } catch (err: any) {
      alert(err.message || 'Error dismissing duplicate');
    } finally {
      setDismissingDuplicate(false);
    }
  };

  // Age Display Logic (Prompt 2):
  // If only ageYears was recorded, show "Age X (as recorded on <date>)", never an auto-incremented age.
  // If dob exists, compute age from Clock.
  const renderAgeDisplay = () => {
    if (!patient) return '';
    if (patient.dob) {
      const birth = new Date(patient.dob);
      const now = clock.now();
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
      return `Age ${age} yrs (DOB: ${patient.dob.slice(0, 10)})`;
    }
    if (patient.ageYears !== undefined && patient.ageYears !== null) {
      const recordedDate = patient.registeredAt ? patient.registeredAt.slice(0, 10) : 'registration';
      return `Age ${patient.ageYears} (as recorded on ${recordedDate})`;
    }
    return 'Age: Not specified';
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
        <Sidebar activeItem="patients" />
        <main className="flex-1 p-8 text-center text-slate-500">
          Loading patient profile...
        </main>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
        <Sidebar activeItem="patients" />
        <main className="flex-1 p-8">
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
            {error || 'Patient not found'}
          </div>
          <Link href="/patients" className="mt-4 inline-block text-xs font-semibold text-blue-600">
            ← Back to Patients Directory
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
      <Sidebar activeItem="patients" />

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Duplicate Candidate Warning Banner */}
        {duplicateCandidate && !patient.duplicateDismissed && (
          <div
            id="banner-duplicate-warning"
            className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                Possible duplicate detected: Similar patient record found for{' '}
                <Link
                  id="link-duplicate-patient"
                  href={`/patients/${duplicateCandidate._id}`}
                  className="font-bold underline hover:text-amber-700"
                >
                  {duplicateCandidate.name} ({duplicateCandidate.patientCode}, {duplicateCandidate.phone})
                </Link>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-dismiss-duplicate"
                type="button"
                disabled={dismissingDuplicate}
                onClick={handleDismissDuplicate}
                className="px-3 py-1 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-100 font-medium rounded-lg transition"
              >
                {dismissingDuplicate ? 'Dismissing...' : 'Dismiss Flag'}
              </button>
            </div>
          </div>
        )}

        {/* Profile Header */}
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <h1 id="patient-profile-name" className="text-2xl font-bold text-slate-900 dark:text-white">
                  {patient.name}
                </h1>
                <span
                  id="patient-profile-code"
                  className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-900"
                >
                  {patient.patientCode}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {patient.source}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                <span id="patient-profile-age" className="font-medium text-slate-800 dark:text-slate-200">
                  {renderAgeDisplay()}
                </span>
                <span>•</span>
                <span>{patient.sex}</span>
                <span>•</span>
                <span className="font-mono">Phone: {patient.phone}</span>
                <span>•</span>
                <span>Registered: {patient.registeredAt ? patient.registeredAt.slice(0, 10) : '—'}</span>
              </div>

              {/* Allergies Chips */}
              {patient.allergies && patient.allergies.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    Allergies:
                  </span>
                  {patient.allergies.map((allergy, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50"
                    >
                      {allergy}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-edit-patient"
                type="button"
                onClick={handleOpenEdit}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
              >
                Edit Profile
              </button>

              <Link
                id="btn-profile-new-appointment"
                href={`/appointments?patientId=${patient._id}&name=${encodeURIComponent(patient.name)}`}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm"
              >
                Book Appointment
              </Link>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-6 mt-6 border-b border-slate-200 dark:border-slate-800 -mb-5 text-sm font-semibold">
            <button
              id="tab-overview"
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`pb-3 border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              Overview & Notes
            </button>

            <button
              id="tab-timeline"
              type="button"
              onClick={() => setActiveTab('timeline')}
              className={`pb-3 border-b-2 transition-colors ${
                activeTab === 'timeline'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              Timeline Feed
            </button>

            <button
              id="tab-billing"
              type="button"
              onClick={() => setActiveTab('billing')}
              className={`pb-3 border-b-2 transition-colors ${
                activeTab === 'billing'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              Billing & Financials ({billingSummary?.bills?.length || 0})
            </button>
          </div>
        </header>

        {/* Tab Contents */}
        <div className="p-6">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Medical Notes */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-3">
                <h2 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  Medical History & Notes
                </h2>
                <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl whitespace-pre-wrap min-h-[100px]">
                  {patient.medicalNotes || 'No medical conditions or warnings recorded.'}
                </div>
              </div>

              {/* General Clinical Notes */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-3">
                <h2 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  General Practice Notes
                </h2>
                <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl whitespace-pre-wrap min-h-[100px]">
                  {patient.generalNotes || 'No general clinical notes.'}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TIMELINE FEED */}
          {activeTab === 'timeline' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm max-w-4xl">
              <h2 className="font-bold text-base text-slate-900 dark:text-white mb-6">
                Chronological Clinical Timeline (Newest First)
              </h2>

              {timeline.length === 0 && !timelineLoading ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No timeline events recorded for this patient.
                </div>
              ) : (
                <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 space-y-6">
                  {timeline.map((item) => (
                    <div key={item.id} className="relative pl-6">
                      {/* Timeline dot */}
                      <span className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full bg-white dark:bg-slate-900 border-2 border-blue-600 flex items-center justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                      </span>

                      <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {item.title}
                            </span>
                            {item.badge && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {new Date(item.date).toLocaleString()}
                          </span>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          {item.summary}
                        </p>

                        {item.link && (
                          <div className="mt-2.5">
                            <Link
                              href={item.link}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-500"
                            >
                              View Details →
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Load More Timeline Button */}
              {hasMoreTimeline && (
                <div className="mt-6 text-center">
                  <button
                    id="btn-timeline-load-more"
                    type="button"
                    disabled={timelineLoading}
                    onClick={() => fetchTimeline(timelineCursor, true)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition"
                  >
                    {timelineLoading ? 'Loading more...' : 'Load Older Events'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: BILLING */}
          {activeTab === 'billing' && (
            <div className="space-y-6 max-w-5xl">
              {/* Financial Balance Summary Card */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <p className="text-xs text-slate-500 font-medium">Total Billed</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                    {formatRupees(billingSummary?.totalBilled || 0)}
                  </p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <p className="text-xs text-emerald-700 font-medium">Total Paid</p>
                  <p className="text-xl font-bold text-emerald-600 mt-1">
                    {formatRupees(billingSummary?.totalPaid || 0)}
                  </p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-sm">
                  <p className="text-xs text-rose-700 font-medium">Outstanding Balance</p>
                  <p className="text-xl font-bold text-rose-600 mt-1">
                    {formatRupees(billingSummary?.outstandingBalance || 0)}
                  </p>
                </div>
              </div>

              {/* Bills List Table */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <h2 className="font-bold text-sm text-slate-900 dark:text-white">
                    Invoices & Bills
                  </h2>
                  <Link
                    href={`/billing/bills/new?patientId=${patient._id}`}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
                  >
                    + Create Bill
                  </Link>
                </div>

                <div tabIndex={0} role="region" aria-label="Invoices and bills table" className="overflow-x-auto focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                        <th className="py-3 px-4">Bill No</th>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Grand Total</th>
                        <th className="py-3 px-4 text-right">Paid</th>
                        <th className="py-3 px-4 text-right">Balance</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {billingSummary?.bills.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No bills found for this patient.
                          </td>
                        </tr>
                      ) : (
                        billingSummary?.bills.map((b) => (
                          <tr key={b._id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="py-3 px-4 font-mono font-medium">{b.billNumber}</td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                              {b.billDate ? b.billDate.slice(0, 10) : '—'}
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800">
                                {b.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-medium">
                              {formatRupees(b.grandTotal)}
                            </td>
                            <td className="py-3 px-4 text-right text-emerald-600 font-medium">
                              {formatRupees(b.paidAmount)}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-rose-600">
                              {formatRupees(b.balanceAmount)}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Link
                                href={`/billing/bills/${b._id}`}
                                className="text-blue-600 hover:underline font-semibold"
                              >
                                View Bill →
                              </Link>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* EDIT PATIENT MODAL */}
        {editModalOpen && (
          <div
            id="modal-edit-patient"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-edit-title"
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
          >
            <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 my-8">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 id="modal-edit-title" className="text-base font-bold text-slate-900 dark:text-white">
                  Edit Patient Profile
                </h3>
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl font-bold"
                >
                  &times;
                </button>
              </div>

              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
                  {editError}
                </div>
              )}

              <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
                {/* Name */}
                <div>
                  <label htmlFor="input-edit-name" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Full Name:
                  </label>
                  <input
                    id="input-edit-name"
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label htmlFor="input-edit-phone" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Phone Number (10 digits):
                  </label>
                  <input
                    id="input-edit-phone"
                    type="tel"
                    required
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Editing phone re-runs duplicate detection automatically.
                  </p>
                </div>

                {/* Sex and Age/DOB */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="select-edit-sex" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Sex:
                    </label>
                    <select
                      id="select-edit-sex"
                      value={editSex}
                      onChange={(e) => setEditSex(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Age Format:</span>
                      <div className="flex gap-2 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setEditAgeType('years')}
                          className={`px-1.5 py-0.5 rounded ${editAgeType === 'years' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                        >
                          Years
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditAgeType('dob')}
                          className={`px-1.5 py-0.5 rounded ${editAgeType === 'dob' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                        >
                          DOB
                        </button>
                      </div>
                    </div>

                    {editAgeType === 'years' ? (
                      <input
                        id="input-edit-age"
                        type="number"
                        min="0"
                        max="125"
                        placeholder="Age in years"
                        value={editAgeYears}
                        onChange={(e) => setEditAgeYears(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    ) : (
                      <input
                        id="input-edit-dob"
                        type="date"
                        value={editDob}
                        onChange={(e) => setEditDob(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    )}
                  </div>
                </div>

                {/* Allergies */}
                <div>
                  <label htmlFor="input-edit-allergies" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Allergies (comma-separated):
                  </label>
                  <input
                    id="input-edit-allergies"
                    type="text"
                    placeholder="e.g. Penicillin, Latex, Aspirin"
                    value={editAllergies}
                    onChange={(e) => setEditAllergies(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                {/* Medical Notes */}
                <div>
                  <label htmlFor="input-edit-medical-notes" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Medical Notes / Conditions:
                  </label>
                  <textarea
                    id="input-edit-medical-notes"
                    rows={2}
                    value={editMedicalNotes}
                    onChange={(e) => setEditMedicalNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                {/* General Notes */}
                <div>
                  <label htmlFor="input-edit-general-notes" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    General Notes:
                  </label>
                  <textarea
                    id="input-edit-general-notes"
                    rows={2}
                    value={editGeneralNotes}
                    onChange={(e) => setEditGeneralNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEditModalOpen(false)}
                    className="px-4 py-2 font-semibold rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-400"
                  >
                    Cancel
                  </button>
                  <button
                    id="btn-save-patient-edit"
                    type="submit"
                    disabled={editSubmitting}
                    className="px-4 py-2 font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-sm disabled:opacity-50"
                  >
                    {editSubmitting ? 'Saving...' : 'Save Changes'}
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
