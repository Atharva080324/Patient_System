'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatINR, applyPercentDiscount, asPaise } from '@/lib/money';
import { isValidFdiTooth } from '@/lib/fdi-tooth';
import { clock } from '@/lib/clock';

interface TreatmentOption {
  _id: string;
  code: string;
  name: string;
  category: string;
  clinicPrice: number;
  unit: string;
}

interface EstimateLine {
  treatmentId?: string;
  description: string;
  teethInput: string;
  teeth: number[];
  qty: number;
  listPrice: number;
  unitPrice: number;
  amount: number;
}

export default function EstimateBuilderClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPatientId = searchParams.get('patientId') || '';
  const prefillVisitId = searchParams.get('visitId') || '';

  const [patientId, setPatientId] = useState(prefillPatientId);
  const [visitId, setVisitId] = useState(prefillVisitId);

  const [treatments, setTreatments] = useState<TreatmentOption[]>([]);
  const [loadingTreatments, setLoadingTreatments] = useState(true);

  // Form State
  const [items, setItems] = useState<EstimateLine[]>([
    {
      description: '',
      teethInput: '',
      teeth: [],
      qty: 1,
      listPrice: 0,
      unitPrice: 0,
      amount: 0,
    },
  ]);
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [discountValue, setDiscountValue] = useState<string>('0');
  const [validUntil, setValidUntil] = useState<string>(() => {
    const d = new Date(clock.now());
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Seeded Treatments
  useEffect(() => {
    async function loadTreatments() {
      try {
        setLoadingTreatments(true);
        const res = await fetch('/api/treatments');
        if (res.ok) {
          const data = await res.json();
          setTreatments(data.treatments || []);
        }
      } catch (err) {
        console.error('Failed to load treatments:', err);
      } finally {
        setLoadingTreatments(false);
      }
    }
    loadTreatments();
  }, []);

  // Update Line Item
  const updateLine = (index: number, updates: Partial<EstimateLine>) => {
    setItems((prev) => {
      const copy = [...prev];
      const target = { ...copy[index], ...updates };

      // Parse teeth
      if (updates.teethInput !== undefined) {
        const parsed = updates.teethInput
          .split(/[\s,]+/)
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));
        target.teeth = parsed;
      }

      // Recalculate amount
      target.amount = target.qty * target.unitPrice;
      copy[index] = target;
      return copy;
    });
  };

  // Add Line
  const addLine = () => {
    setItems((prev) => [
      ...prev,
      {
        description: '',
        teethInput: '',
        teeth: [],
        qty: 1,
        listPrice: 0,
        unitPrice: 0,
        amount: 0,
      },
    ]);
  };

  // Remove Line
  const removeLine = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Treatment Selection
  const handleSelectTreatment = (index: number, treatmentId: string) => {
    const selected = treatments.find((t) => t._id === treatmentId);
    if (selected) {
      updateLine(index, {
        treatmentId: selected._id,
        description: selected.name,
        listPrice: selected.clinicPrice,
        unitPrice: selected.clinicPrice,
      });
    }
  };

  // Totals Calculation
  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => acc + (it.amount || 0), 0);
  }, [items]);

  const discountAmount = useMemo(() => {
    if (discountType === 'PERCENT') {
      const pct = parseFloat(discountValue) || 0;
      if (pct <= 0) return 0;
      const res = applyPercentDiscount(asPaise(subtotal), pct);
      return res.discount;
    } else {
      const rupees = parseFloat(discountValue) || 0;
      return Math.round(rupees * 100);
    }
  }, [subtotal, discountType, discountValue]);

  const total = Math.max(0, subtotal - discountAmount);

  // Save / Issue Submit
  const handleSubmit = async (issueNow: boolean) => {
    try {
      setSubmitting(true);
      setError(null);

      if (!patientId.trim()) {
        throw new Error('Patient ID is required. Please provide a valid patient.');
      }

      // Validate teeth
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.description.trim()) {
          throw new Error(`Line #${i + 1} description cannot be empty.`);
        }
        for (const tooth of it.teeth) {
          if (!isValidFdiTooth(tooth)) {
            throw new Error(
              `Invalid FDI tooth number "${tooth}" on line #${i + 1}. Must be valid FDI format (11-48, 51-85).`
            );
          }
        }
      }

      if (discountAmount > subtotal) {
        throw new Error('Discount cannot exceed the subtotal.');
      }

      // Payload
      const payload = {
        patientId,
        visitId: visitId || undefined,
        items: items.map((it) => ({
          treatmentId: it.treatmentId,
          description: it.description,
          teeth: it.teeth,
          qty: it.qty,
          listPrice: it.listPrice,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
        discount: discountAmount,
        validUntil: validUntil || undefined,
        notes: notes.trim() || undefined,
      };

      // 1. Create Draft
      const res = await fetch('/api/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save estimate');
      }

      const estimateId = data.estimate._id;

      // 2. If issueNow, issue inside transaction and navigate to print view
      if (issueNow) {
        const issueRes = await fetch(`/api/estimates/${estimateId}/issue`, {
          method: 'POST',
        });
        const issueData = await issueRes.json();
        if (!issueRes.ok) {
          throw new Error(issueData.error || 'Failed to issue estimate');
        }
        router.push(`/print/estimate/${estimateId}`);
      } else {
        router.push('/billing');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while creating estimate');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/billing"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              ← Billing
            </Link>
            <h1 className="text-lg font-bold text-white tracking-tight">Create Treatment Estimate</h1>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              id="btn-save-draft"
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition disabled:opacity-50"
            >
              Save as Draft
            </button>
            <button
              type="button"
              id="btn-issue-estimate"
              onClick={() => handleSubmit(true)}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition disabled:opacity-50"
            >
              ✓ Issue & Print Estimate
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {error && (
          <div id="error-banner" role="alert" className="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-sm font-medium">
            {error}
          </div>
        )}

        {/* Patient / Visit Link */}
        <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Patient Association</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="input-patient-id" className="block text-xs font-medium text-slate-400 mb-1">
                Patient ID / MongoDB ObjectId *
              </label>
              <input
                id="input-patient-id"
                type="text"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="e.g. 6addaf62acfd773958a7fc6e"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <div>
              <label htmlFor="input-visit-id" className="block text-xs font-medium text-slate-400 mb-1">
                Associated Visit ID (Optional)
              </label>
              <input
                id="input-visit-id"
                type="text"
                value={visitId}
                onChange={(e) => setVisitId(e.target.value)}
                placeholder="e.g. 6addaf62acfd773958a7fc6f"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>
        </section>

        {/* Line Items Builder */}
        <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Treatment Items ({items.length})
            </h2>
            <button
              type="button"
              id="btn-add-line"
              onClick={addLine}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white transition"
            >
              + Add Procedure
            </button>
          </div>

          <div className="space-y-4">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
              >
                {/* Select from Schedule */}
                <div className="md:col-span-4">
                  <label htmlFor={`treatment-select-${idx}`} className="block text-[11px] font-medium text-slate-400 mb-1">
                    Select From Schedule (28 Seeded)
                  </label>
                  <select
                    id={`treatment-select-${idx}`}
                    value={item.treatmentId || ''}
                    onChange={(e) => handleSelectTreatment(idx, e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Choose Treatment --</option>
                    {treatments.map((t) => (
                      <option key={t._id} value={t._id}>
                        [{t.code}] {t.name} (₹{(t.clinicPrice || 0) / 100})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div className="md:col-span-3">
                  <label htmlFor={`desc-input-${idx}`} className="block text-[11px] font-medium text-slate-400 mb-1">
                    Procedure Description *
                  </label>
                  <input
                    id={`desc-input-${idx}`}
                    type="text"
                    value={item.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                    placeholder="e.g. Root Canal Treatment"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* FDI Teeth */}
                <div className="md:col-span-2">
                  <label htmlFor={`teeth-input-${idx}`} className="block text-[11px] font-medium text-slate-400 mb-1">
                    Teeth FDI (e.g. 16, 46)
                  </label>
                  <input
                    id={`teeth-input-${idx}`}
                    type="text"
                    value={item.teethInput}
                    onChange={(e) => updateLine(idx, { teethInput: e.target.value })}
                    placeholder="11-48, 51-85"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                {/* Qty */}
                <div className="md:col-span-1">
                  <label htmlFor={`qty-input-${idx}`} className="block text-[11px] font-medium text-slate-400 mb-1">
                    Qty
                  </label>
                  <input
                    id={`qty-input-${idx}`}
                    type="number"
                    min={1}
                    max={99}
                    value={item.qty}
                    onChange={(e) => updateLine(idx, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
                  />
                </div>

                {/* Unit Price (Rupees) */}
                <div className="md:col-span-1">
                  <label htmlFor={`unit-price-input-${idx}`} className="block text-[11px] font-medium text-slate-400 mb-1">
                    Price (₹)
                  </label>
                  <input
                    id={`unit-price-input-${idx}`}
                    type="number"
                    min={0}
                    value={item.unitPrice / 100}
                    onChange={(e) => {
                      const rupees = parseFloat(e.target.value) || 0;
                      updateLine(idx, { unitPrice: Math.round(rupees * 100) });
                    }}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-right"
                  />
                </div>

                {/* Remove */}
                <div className="md:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    disabled={items.length <= 1}
                    className="p-2 rounded-lg text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800 disabled:opacity-30 transition"
                    title="Remove procedure"
                    aria-label={`Remove procedure #${idx + 1}`}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Discount, Validity, Notes & Total Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Notes & Validity */}
          <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Validity & Notes</h2>
            <div>
              <label htmlFor="input-valid-until" className="block text-xs font-medium text-slate-400 mb-1">
                Valid Until (Asia/Kolkata date)
              </label>
              <input
                id="input-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="input-notes" className="block text-xs font-medium text-slate-400 mb-1">
                Clinical Notes / Remarks
              </label>
              <textarea
                id="input-notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Treatment split across 3 sittings. Crown choice: Ceramic vs Zirconia."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </section>

          {/* Discount & Totals */}
          <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Financial Totals</h2>

            <div className="space-y-3">
              {/* Discount control */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Optional Discount
                </label>
                <div className="flex gap-2">
                  <select
                    id="select-discount-type"
                    aria-label="Discount Type"
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as any)}
                    className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="FIXED">Fixed (₹)</option>
                    <option value="PERCENT">Percent (%)</option>
                  </select>
                  <input
                    id="input-discount-value"
                    aria-label="Discount Value"
                    type="number"
                    min={0}
                    max={discountType === 'PERCENT' ? 100 : undefined}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-right"
                  />
                </div>
              </div>

              {/* Breakdown */}
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 text-xs space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal:</span>
                  <span className="font-mono text-slate-200">{formatINR(asPaise(subtotal))}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-400 font-medium">
                    <span>Discount:</span>
                    <span className="font-mono">- {formatINR(asPaise(discountAmount))}</span>
                  </div>
                )}
                <div className="border-t border-slate-700 pt-2 flex justify-between text-base font-black text-white">
                  <span>Total Estimate:</span>
                  <span className="font-mono text-blue-400">{formatINR(asPaise(total))}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
