'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatINR, asPaise } from '@/lib/money';
import { clock } from '@/lib/clock';

interface BillDetailClientProps {
  billId: string;
}

export default function BillDetailClient({ billId }: BillDetailClientProps) {
  const [bill, setBill] = useState<any | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmountRupees, setPaymentAmountRupees] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [upiRef, setUpiRef] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Reversal Modal state
  const [showReversalModal, setShowReversalModal] = useState(false);
  const [targetPayment, setTargetPayment] = useState<any | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalSubmitting, setReversalSubmitting] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Cancel Bill Modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const fetchBill = useCallback(async () => {
    try {
      const res = await fetch(`/api/bills/${billId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load bill');
      }
      setBill(data.bill);
      setPayments(data.payments || []);
    } catch (err: any) {
      setError(err.message || 'Error loading bill');
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/bills/${billId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
        } else {
          setBill(data.bill);
          setPayments(data.payments || []);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Error loading bill');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [billId]);

  // Open Record Payment Dialog
  const handleOpenPayment = () => {
    if (!bill) return;
    const balanceRupees = bill.balance / 100;
    setPaymentAmountRupees(balanceRupees.toString());
    setPaymentMethod('CASH');
    setUpiRef('');
    setPaymentError(null);
    setShowPaymentModal(true);
  };

  // Submit Payment
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bill) return;

    try {
      setPaymentSubmitting(true);
      setPaymentError(null);

      const rupees = parseFloat(paymentAmountRupees) || 0;
      const amountPaise = Math.round(rupees * 100);

      if (amountPaise <= 0) {
        throw new Error('Payment amount must be greater than ₹0.');
      }
      if (amountPaise > bill.balance) {
        throw new Error(`Amount of ₹${rupees} exceeds outstanding balance of ₹${bill.balance / 100}.`);
      }

      // Generate client idempotency key
      const idempotencyKey = `pay-${billId}-${clock.now().getTime()}-${Math.random().toString(36).substring(2, 9)}`;

      const res = await fetch(`/api/bills/${billId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountPaise,
          method: paymentMethod,
          upiRef: upiRef.trim() || undefined,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record payment');
      }

      setShowPaymentModal(false);
      await fetchBill();
    } catch (err: any) {
      setPaymentError(err.message || 'Error processing payment');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  // Open Reversal Dialog
  const handleOpenReversal = (payment: any) => {
    setTargetPayment(payment);
    setReversalReason('');
    setReversalError(null);
    setShowReversalModal(true);
  };

  // Submit Reversal
  const handleSubmitReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPayment) return;

    try {
      setReversalSubmitting(true);
      setReversalError(null);

      if (!reversalReason.trim()) {
        throw new Error('A valid reason is required to reverse a payment.');
      }

      const res = await fetch(`/api/payments/${targetPayment._id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reversalReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reverse payment');
      }

      setShowReversalModal(false);
      setTargetPayment(null);
      await fetchBill();
    } catch (err: any) {
      setReversalError(err.message || 'Error reversing payment');
    } finally {
      setReversalSubmitting(false);
    }
  };

  // Submit Cancel Bill
  const handleSubmitCancelBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bill) return;

    try {
      setCancelSubmitting(true);
      setCancelError(null);

      if (!cancelReason.trim()) {
        throw new Error('A valid reason is required to cancel this bill.');
      }

      const res = await fetch(`/api/bills/${billId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel bill');
      }

      setShowCancelModal(false);
      await fetchBill();
    } catch (err: any) {
      setCancelError(err.message || 'Error cancelling bill');
    } finally {
      setCancelSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-400 flex items-center justify-center font-sans">
        Loading bill details...
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6 font-sans">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md text-center">
          <h1 className="text-lg font-bold text-rose-400 mb-2">Bill Not Found</h1>
          <p className="text-sm text-slate-400 mb-4">{error || 'Bill document could not be loaded.'}</p>
          <Link
            href="/billing"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg inline-block transition"
          >
            ← Back to Billing
          </Link>
        </div>
      </div>
    );
  }

  const isCancelled = bill.status === 'CANCELLED';
  const canRecordPayment = !isCancelled && bill.balance > 0;
  const canCancel = !isCancelled && bill.paid === 0;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header Bar */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/billing"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              ← Billing
            </Link>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-base font-bold text-white">{bill.billNo}</span>
              <span
                id="bill-status-badge"
                className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  bill.status === 'PAID'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : bill.status === 'PARTIAL'
                    ? 'bg-amber-950 text-amber-300 border border-amber-700'
                    : bill.status === 'CANCELLED'
                    ? 'bg-rose-950 text-rose-300 border border-rose-700'
                    : 'bg-slate-700 text-slate-200'
                }`}
              >
                {bill.status}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3">
            {canRecordPayment && (
              <button
                type="button"
                id="btn-open-payment"
                onClick={handleOpenPayment}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm transition"
              >
                + Record Payment
              </button>
            )}

            <Link
              id="btn-print-bill-view"
              href={`/print/bill/${bill._id}`}
              target="_blank"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              🖨️ Print Bill
            </Link>

            {canCancel && (
              <button
                type="button"
                id="btn-open-cancel"
                onClick={() => setShowCancelModal(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-950/40 border border-rose-800/80 transition"
              >
                Cancel Bill
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Bill Meta Card */}
        <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Bill Date:</span>
              <span className="font-bold text-white text-sm">
                {new Date(bill.createdAt).toLocaleDateString('en-IN')}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Patient:</span>
              <span className="font-mono text-white text-sm">{bill.patientId}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Associated Visit:</span>
              <span className="font-mono text-slate-300">{bill.visitId || 'None'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Version / Prints:</span>
              <span className="font-mono text-slate-300">v{bill.version} (printed {bill.printCount}x)</span>
            </div>
          </div>
        </section>

        {/* Procedures List */}
        <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
            Billed Procedures ({bill.items?.length || 0})
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-700 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3 font-bold w-12">#</th>
                  <th className="py-2.5 px-3 font-bold">Procedure Description</th>
                  <th className="py-2.5 px-3 font-bold text-center w-28">Teeth (FDI)</th>
                  <th className="py-2.5 px-3 font-bold text-center w-16">Qty</th>
                  <th className="py-2.5 px-3 font-bold text-right w-28">Unit Price</th>
                  <th className="py-2.5 px-3 font-bold text-right w-32">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {bill.items?.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-700/20">
                    <td className="py-2.5 px-3 text-slate-400">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-white">{item.description}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-300">
                      {item.teeth && item.teeth.length > 0 ? item.teeth.join(', ') : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-center font-medium text-slate-200">{item.qty}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                      {formatINR(asPaise(item.unitPrice))}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                      {formatINR(asPaise(item.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Financial Totals */}
          <div className="flex justify-end pt-3">
            <div className="w-72 bg-slate-900/90 border border-slate-700 rounded-xl p-4 text-xs space-y-2">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal:</span>
                <span className="font-mono text-slate-200">{formatINR(asPaise(bill.subtotal))}</span>
              </div>
              {bill.discount > 0 && (
                <div className="flex justify-between text-emerald-400 font-medium">
                  <span>Discount:</span>
                  <span className="font-mono">- {formatINR(asPaise(bill.discount))}</span>
                </div>
              )}
              <div className="border-t border-slate-700 pt-2 flex justify-between font-bold text-white text-sm">
                <span>Total Amount:</span>
                <span className="font-mono">{formatINR(asPaise(bill.total))}</span>
              </div>
              <div className="flex justify-between text-emerald-400 font-medium">
                <span>Total Paid:</span>
                <span id="bill-paid-amount" className="font-mono">{formatINR(asPaise(bill.paid))}</span>
              </div>
              <div className="border-t border-slate-700 pt-2 flex justify-between text-base font-black text-rose-400">
                <span>Balance Due:</span>
                <span id="bill-balance-amount" className="font-mono">{formatINR(asPaise(bill.balance))}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Payments History */}
        <section className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Payments & Receipts History ({payments.length})
            </h2>
            {canRecordPayment && (
              <button
                type="button"
                onClick={handleOpenPayment}
                className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
              >
                + Record Payment
              </button>
            )}
          </div>

          {payments.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-xs">
              No payments recorded yet for this bill.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-700 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">Receipt No</th>
                    <th className="py-2.5 px-3 font-bold">Date</th>
                    <th className="py-2.5 px-3 font-bold">Method</th>
                    <th className="py-2.5 px-3 font-bold text-right">Amount</th>
                    <th className="py-2.5 px-3 font-bold text-center">Type</th>
                    <th className="py-2.5 px-3 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {payments.map((p) => {
                    const isRev = p.isReversal;
                    // Check if already reversed by another payment
                    const isAlreadyReversed = payments.some(
                      (other) => other.isReversal && other.reversalOf?.toString() === p._id.toString()
                    );

                    return (
                      <tr
                        key={p._id}
                        className={`hover:bg-slate-700/20 ${
                          isRev ? 'bg-rose-950/20 text-rose-300' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold whitespace-nowrap">
                          {p.receiptNo}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">
                          {new Date(p.receivedAt || p.createdAt).toLocaleDateString('en-IN')}
                        </td>
                        <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                          {p.method} {p.upiRef ? `(${p.upiRef})` : ''}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap">
                          {p.amount < 0
                            ? `- ${formatINR(asPaise(Math.abs(p.amount)))}`
                            : formatINR(asPaise(p.amount))}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {isRev ? (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-rose-900 text-rose-200 text-[10px] font-bold">
                              REVERSAL
                            </span>
                          ) : isAlreadyReversed ? (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-900 text-amber-200 text-[10px] font-bold">
                              REVERSED
                            </span>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-bold">
                              PAYMENT
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-2">
                          <Link
                            id={`btn-print-receipt-${p._id}`}
                            href={`/print/receipt/${p._id}`}
                            target="_blank"
                            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-[11px] font-medium transition"
                          >
                            Print Receipt ↗
                          </Link>

                          {!isRev && !isAlreadyReversed && !isCancelled && (
                            <button
                              type="button"
                              id={`btn-reverse-${p._id}`}
                              onClick={() => handleOpenReversal(p)}
                              className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[11px] font-medium transition"
                            >
                              Reverse
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Record Payment Modal */}
      {showPaymentModal && (
        <div
          role="dialog"
          aria-labelledby="payment-modal-title"
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h2 id="payment-modal-title" className="text-base font-bold text-white">
              Record Payment for Bill {bill.billNo}
            </h2>

            {paymentError && (
              <div role="alert" className="p-3 rounded-lg bg-rose-950 border border-rose-800 text-rose-300 text-xs font-medium">
                {paymentError}
              </div>
            )}

            <form onSubmit={handleSubmitPayment} className="space-y-4">
              <div>
                <label htmlFor="modal-payment-amount" className="block text-xs font-medium text-slate-400 mb-1">
                  Amount in Rupees (₹) * (Max ₹{bill.balance / 100})
                </label>
                <input
                  id="modal-payment-amount"
                  type="number"
                  step="any"
                  min="0.01"
                  max={bill.balance / 100}
                  value={paymentAmountRupees}
                  onChange={(e) => setPaymentAmountRupees(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  required
                />
              </div>

              <div>
                <label htmlFor="modal-payment-method" className="block text-xs font-medium text-slate-400 mb-1">
                  Payment Method *
                </label>
                <select
                  id="modal-payment-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="CASH">CASH</option>
                  <option value="UPI">UPI</option>
                </select>
              </div>

              {paymentMethod === 'UPI' && (
                <div>
                  <label htmlFor="modal-upi-ref" className="block text-xs font-medium text-slate-400 mb-1">
                    UPI Reference Number (Optional)
                  </label>
                  <input
                    id="modal-upi-ref"
                    type="text"
                    value={upiRef}
                    onChange={(e) => setUpiRef(e.target.value)}
                    placeholder="e.g. 123456789012"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  id="btn-cancel-modal"
                  onClick={() => setShowPaymentModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-submit-payment"
                  disabled={paymentSubmitting}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white shadow transition disabled:opacity-50"
                >
                  {paymentSubmitting ? 'Recording...' : 'Confirm & Allocate Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reverse Payment Modal */}
      {showReversalModal && targetPayment && (
        <div
          role="dialog"
          aria-labelledby="reversal-modal-title"
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h2 id="reversal-modal-title" className="text-base font-bold text-white">
              Reverse Payment {targetPayment.receiptNo}
            </h2>

            <p className="text-xs text-slate-300">
              Amount to reverse:{' '}
              <strong className="text-rose-400 font-mono">
                {formatINR(asPaise(targetPayment.amount))}
              </strong>
              . This will create an immutable reversal record and restore the bill balance.
            </p>

            {reversalError && (
              <div role="alert" className="p-3 rounded-lg bg-rose-950 border border-rose-800 text-rose-300 text-xs font-medium">
                {reversalError}
              </div>
            )}

            <form onSubmit={handleSubmitReversal} className="space-y-4">
              <div>
                <label htmlFor="input-reversal-reason" className="block text-xs font-medium text-slate-400 mb-1">
                  Reason for Reversal *
                </label>
                <textarea
                  id="input-reversal-reason"
                  rows={3}
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="e.g. Payment mistakenly credited or patient refund issued"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  required
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReversalModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-confirm-reversal"
                  disabled={reversalSubmitting}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow transition disabled:opacity-50"
                >
                  {reversalSubmitting ? 'Reversing...' : 'Confirm Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Bill Modal */}
      {showCancelModal && (
        <div
          role="dialog"
          aria-labelledby="cancel-bill-title"
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h2 id="cancel-bill-title" className="text-base font-bold text-white">
              Cancel Bill {bill.billNo}
            </h2>

            <p className="text-xs text-slate-300">
              This action cancels the bill and frees the visit for a new bill. Bill records are kept permanently with status CANCELLED.
            </p>

            {cancelError && (
              <div role="alert" className="p-3 rounded-lg bg-rose-950 border border-rose-800 text-rose-300 text-xs font-medium">
                {cancelError}
              </div>
            )}

            <form onSubmit={handleSubmitCancelBill} className="space-y-4">
              <div>
                <label htmlFor="input-cancel-reason" className="block text-xs font-medium text-slate-400 mb-1">
                  Reason for Cancellation *
                </label>
                <textarea
                  id="input-cancel-reason"
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Incorrect treatment selected or duplicated bill"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  required
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-confirm-cancel-bill"
                  disabled={cancelSubmitting}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow transition disabled:opacity-50"
                >
                  {cancelSubmitting ? 'Cancelling...' : 'Confirm Cancel Bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
