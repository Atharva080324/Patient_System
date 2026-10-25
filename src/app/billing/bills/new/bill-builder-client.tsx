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

interface BillLine {
  treatmentId?: string;
  description: string;
  teethInput: string;
  teeth: number[];
  qty: number;
  listPrice: number;
  unitPrice: number;
  amount: number;
}

export default function BillBuilderClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPatientId = searchParams.get('patientId') || '';
  const prefillVisitId = searchParams.get('visitId') || '';

  const [patientId, setPatientId] = useState(prefillPatientId);
  const [visitId, setVisitId] = useState(prefillVisitId);



  const [treatments, setTreatments] = useState<TreatmentOption[]>([]);
  const [loadingTreatments, setLoadingTreatments] = useState(true);

  // Line Items
  const [items, setItems] = useState<BillLine[]>([
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

  // Discount
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [discountValue, setDiscountValue] = useState<string>('0');

  // Initial Payment Option
  const [recordInitialPayment, setRecordInitialPayment] = useState(false);
  const [initialPaymentAmountRupees, setInitialPaymentAmountRupees] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [upiRef, setUpiRef] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const updateLine = (index: number, updates: Partial<BillLine>) => {
    setItems((prev) => {
      const copy = [...prev];
      const target = { ...copy[index], ...updates };

      if (updates.teethInput !== undefined) {
        const parsed = updates.teethInput
          .split(/[\s,]+/)
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));
        target.teeth = parsed;
      }

      target.amount = target.qty * target.unitPrice;
      copy[index] = target;
      return copy;
    });
  };

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

  const removeLine = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

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

  // Financial Calculations
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);

      if (!patientId.trim()) {
        throw new Error('Patient ID is required.');
      }

      // Validate lines
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.description.trim()) {
          throw new Error(`Line #${i + 1} description cannot be empty.`);
        }
        for (const tooth of it.teeth) {
          if (!isValidFdiTooth(tooth)) {
            throw new Error(
              `Invalid FDI tooth number "${tooth}" on line #${i + 1}. Must be 11-48, 51-85.`
            );
          }
        }
      }

      if (discountAmount > subtotal) {
        throw new Error('Discount cannot exceed the subtotal.');
      }

      let initialPaymentPayload: any = undefined;
      if (recordInitialPayment) {
        const paymentRupees = parseFloat(initialPaymentAmountRupees) || 0;
        const paymentPaise = Math.round(paymentRupees * 100);

        if (paymentPaise <= 0) {
          throw new Error('Initial payment amount must be greater than ₹0.');
        }
        if (paymentPaise > total) {
          throw new Error(
            `Initial payment of ₹${paymentRupees} exceeds total bill amount of ₹${total / 100}.`
          );
        }

        initialPaymentPayload = {
          amount: paymentPaise,
          method: paymentMethod,
          upiRef: upiRef.trim() || undefined,
          idempotencyKey: `init-${clock.now().getTime()}-${Math.random().toString(36).substring(2, 9)}`,
        };
      }

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
        initialPayment: initialPaymentPayload,
      };

      const res = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create bill');
      }

      router.push(`/billing/bills/${data.bill._id}`);
    } catch (err: any) {
      setError(err.message || 'An error occurred while creating bill');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/billing"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              ← Billing
            </Link>
            <h1 className="text-lg font-bold text-white tracking-tight">Create Patient Bill</h1>
          </div>

          <button
            type="button"
            id="btn-create-bill"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm transition disabled:opacity-50"
          >
            ✓ Create Bill
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {error && (
          <div id="error-banner" role="alert" className="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-sm font-medium">
            {error}
          </div>
        )}

        {/* Patient association */}
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
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              />
            </div>
            <div>
              <label htmlFor="input-visit-id" className="block text-xs font-medium text-slate-400 mb-1">
                Associated Visit ID (Optional - max 1 active bill per visit)
              </label>
              <input
                id="input-visit-id"
                type="text"
                value={visitId}
                onChange={(e) => setVisitId(e.target.value)}
                placeholder="e.g. 6addaf62acfd773958a7fc6f"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              />
            </div>
          </div>
        </section>

        {/* Line Items */}
        <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Procedures & Treatments ({items.length})
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
                <div className="md:col-span-4">
                  <label htmlFor={`treatment-select-${idx}`} className="block text-[11px] font-medium text-slate-400 mb-1">
                    Select From Schedule (28 Seeded)
                  </label>
                  <select
                    id={`treatment-select-${idx}`}
                    value={item.treatmentId || ''}
                    onChange={(e) => handleSelectTreatment(idx, e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">-- Choose Treatment --</option>
                    {treatments.map((t) => (
                      <option key={t._id} value={t._id}>
                        [{t.code}] {t.name} (₹{(t.clinicPrice || 0) / 100})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label htmlFor={`desc-input-${idx}`} className="block text-[11px] font-medium text-slate-400 mb-1">
                    Procedure Description *
                  </label>
                  <input
                    id={`desc-input-${idx}`}
                    type="text"
                    value={item.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                    placeholder="Procedure description"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

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
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>

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
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-center"
                  />
                </div>

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
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-right"
                  />
                </div>

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

        {/* Discount, Totals & Initial Payment Option */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Initial Payment Section */}
          <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center space-x-2.5">
              <input
                id="checkbox-initial-payment"
                type="checkbox"
                checked={recordInitialPayment}
                onChange={(e) => setRecordInitialPayment(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 bg-slate-900 border-slate-700"
              />
              <label htmlFor="checkbox-initial-payment" className="text-sm font-bold text-slate-200 cursor-pointer">
                Record Payment with Bill Creation (Atomic Transaction)
              </label>
            </div>

            {recordInitialPayment && (
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 space-y-3">
                <div>
                  <label htmlFor="input-initial-amount" className="block text-xs font-medium text-slate-400 mb-1">
                    Payment Amount (₹) *
                  </label>
                  <input
                    id="input-initial-amount"
                    type="number"
                    min={0}
                    value={initialPaymentAmountRupees}
                    onChange={(e) => setInitialPaymentAmountRupees(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="select-payment-method" className="block text-xs font-medium text-slate-400 mb-1">
                      Method
                    </label>
                    <select
                      id="select-payment-method"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as any)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="CASH">CASH</option>
                      <option value="UPI">UPI</option>
                    </select>
                  </div>

                  {paymentMethod === 'UPI' && (
                    <div>
                      <label htmlFor="input-upi-ref" className="block text-xs font-medium text-slate-400 mb-1">
                        UPI Reference No (Optional)
                      </label>
                      <input
                        id="input-upi-ref"
                        type="text"
                        value={upiRef}
                        onChange={(e) => setUpiRef(e.target.value)}
                        placeholder="e.g. 123456789012"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Discount & Totals */}
          <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Financial Totals</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Bill Discount
                </label>
                <div className="flex gap-2">
                  <select
                    id="select-discount-type"
                    aria-label="Discount Type"
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as any)}
                    className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-right"
                  />
                </div>
              </div>

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
                  <span>Total Bill Amount:</span>
                  <span className="font-mono text-emerald-400">{formatINR(asPaise(total))}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
