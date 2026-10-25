'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatINR, amountInWordsINR, asPaise } from '@/lib/money';
import { clock } from '@/lib/clock';

interface PrintReceiptClientProps {
  paymentId: string;
}

export default function PrintReceiptClient({ paymentId }: PrintReceiptClientProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<any | null>(null);
  const [paperSize, setPaperSize] = useState<'A5' | 'A4'>('A5');
  const [isReprint, setIsReprint] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/payments/${paymentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
        } else {
          setPayment(data.payment);
          setIsReprint((data.payment?.printCount || 0) > 0);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Error loading receipt');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [paymentId]);

  const handlePrint = async () => {
    try {
      await fetch(`/api/payments/${paymentId}/print`, { method: 'POST' });
      setIsReprint(true);
    } catch (err) {
      console.error('Audit receipt print failed:', err);
    }
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-800 font-sans">
        <p className="text-base font-semibold">Loading receipt document...</p>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-800 font-sans">
        <div className="bg-white p-8 rounded-xl shadow border border-slate-300 max-w-md text-center">
          <h1 className="text-lg font-bold text-rose-600 mb-2">Receipt Unavailable</h1>
          <p className="text-sm text-slate-600 mb-4">{error || 'Receipt document not found.'}</p>
          <Link
            href="/billing"
            className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg inline-block"
          >
            ← Back to Billing
          </Link>
        </div>
      </div>
    );
  }

  const snapshot = payment.snapshot || {};
  const clinic = snapshot.clinic || {};
  const patient = snapshot.patient || {};
  const isReversal = payment.isReversal || snapshot.isReversal;
  const absAmount = Math.abs(payment.amount);
  const amountWords =
    snapshot.amountInWords ||
    (isReversal
      ? `Minus ${amountInWordsINR(asPaise(absAmount))}`
      : amountInWordsINR(asPaise(absAmount)));

  return (
    <div className="min-h-screen bg-slate-200 py-6 px-2 sm:px-4 flex flex-col items-center">
      {/* Screen Controls */}
      <div className="print:hidden max-w-3xl w-full mb-6 bg-slate-900 text-white p-4 rounded-xl shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/billing"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
          >
            ← Back to Billing
          </Link>
          <span className="font-mono text-sm font-bold text-emerald-400">
            {payment.receiptNo}
          </span>
          {isReprint && (
            <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-700/60 text-xs font-bold">
              Reprint
            </span>
          )}
          {isReversal && (
            <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-700/60 text-xs font-bold">
              Reversal
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex rounded-lg bg-slate-800 p-1 border border-slate-700 text-xs font-medium">
            <button
              type="button"
              id="btn-paper-a5"
              onClick={() => setPaperSize('A5')}
              className={`px-3 py-1 rounded transition ${
                paperSize === 'A5' ? 'bg-emerald-700 text-white font-bold' : 'text-slate-400'
              }`}
            >
              A5 (Default)
            </button>
            <button
              type="button"
              id="btn-paper-a4"
              onClick={() => setPaperSize('A4')}
              className={`px-3 py-1 rounded transition ${
                paperSize === 'A4' ? 'bg-emerald-700 text-white font-bold' : 'text-slate-400'
              }`}
            >
              A4
            </button>
          </div>

          <button
            type="button"
            id="btn-trigger-print"
            onClick={handlePrint}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow transition flex items-center space-x-1.5"
          >
            <span>🖨️</span>
            <span>Print Receipt</span>
          </button>
        </div>
      </div>

      {/* Printable Receipt Paper Document */}
      <div
        id="receipt-document"
        className={`relative bg-white text-slate-900 shadow-2xl p-6 sm:p-8 flex flex-col justify-between overflow-hidden font-sans border border-slate-300 print:shadow-none print:border-none print:m-0 print:p-6 ${
          paperSize === 'A5'
            ? 'w-[148mm] min-h-[210mm] max-w-full'
            : 'w-[210mm] min-h-[297mm] max-w-full'
        }`}
      >
        {isReversal && (
          <div
            id="reversal-watermark"
            className="pointer-events-none absolute inset-0 flex items-center justify-center select-none z-10"
          >
            <div className="transform -rotate-45 text-rose-600/15 font-black text-6xl sm:text-8xl border-8 border-rose-600/15 px-8 py-4 rounded-3xl tracking-widest uppercase">
              REVERSAL
            </div>
          </div>
        )}

        <div>
          {/* Clinic Letterhead */}
          <div className="border-b-2 border-slate-900 pb-3 mb-4">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight uppercase">
                  {clinic.name || "Dr. Susheel's Advanced Dental Clinic & Implant Center"}
                </h1>
                <p className="text-xs text-slate-700 leading-tight mt-0.5 max-w-md">
                  {clinic.address || 'Station Road, Chhatrapati Sambhajinagar, Maharashtra'}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  📞 {clinic.phone || '+91-98220-12345'} | Reg No: {clinic.registrationNo || 'MH-AUR-2024-0891'}
                </p>
              </div>

              <div className="text-right">
                <div
                  className={`inline-block px-3 py-1 rounded text-xs font-black uppercase tracking-wider ${
                    isReversal
                      ? 'bg-rose-100 text-rose-900 border border-rose-300'
                      : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                  }`}
                >
                  {isReversal ? 'Receipt Reversal' : 'Payment Receipt'}
                </div>
              </div>
            </div>
          </div>

          {/* Receipt & Patient Meta */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5 text-xs grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Receipt Number:</span>
              <span className="font-bold text-slate-900 font-mono text-sm">{payment.receiptNo}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Date of Receipt:</span>
              <span className="font-bold text-slate-800">
                {snapshot.date || new Date(payment.receivedAt || clock.now()).toLocaleDateString('en-IN')}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Against Bill Number:</span>
              <span className="font-mono font-bold text-slate-900">{snapshot.billNo || 'BILL'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Patient Name:</span>
              <span className="font-bold text-slate-900 text-sm">{patient.name || 'Patient'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Patient Code:</span>
              <span className="font-mono font-medium text-slate-800">{patient.patientCode || 'P-0001'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Payment Method:</span>
              <span className="font-bold text-slate-900">
                {payment.method} {payment.upiRef ? `(Ref: ${payment.upiRef})` : ''}
              </span>
            </div>
          </div>

          {/* Reversal Note if applicable */}
          {isReversal && (
            <div className="mb-5 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900">
              <div className="font-bold uppercase tracking-wider text-[11px] mb-1">
                Notice of Payment Reversal
              </div>
              <p>
                <strong>Original Receipt No:</strong>{' '}
                <span className="font-mono">{snapshot.originalReceiptNo || payment.reversalOf}</span>
              </p>
              <p className="mt-0.5">
                <strong>Reason for Reversal:</strong>{' '}
                {snapshot.reversalReason || payment.reversalReason || 'Correction'}
              </p>
            </div>
          )}

          {/* Payment Amount Box */}
          <div className="border-2 border-slate-900 rounded-xl p-5 mb-5 bg-slate-50/50">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs uppercase font-bold text-slate-600 tracking-wider">
                {isReversal ? 'Amount Reversed:' : 'Amount Received:'}
              </span>
              <span
                className={`font-mono text-2xl sm:text-3xl font-black ${
                  isReversal ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                {isReversal ? `- ${formatINR(asPaise(absAmount))}` : formatINR(asPaise(absAmount))}
              </span>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <span className="text-slate-500 font-semibold block text-[10px] uppercase">
                Amount in Words:
              </span>
              <span className="font-bold text-slate-900 text-sm leading-tight block mt-0.5">
                {amountWords}
              </span>
            </div>
          </div>

          {/* Balance Remaining After This Payment */}
          <div className="bg-slate-100 rounded-lg p-3 text-xs flex justify-between items-center mb-6">
            <span className="font-semibold text-slate-700">Remaining Bill Balance After Transaction:</span>
            <span className="font-mono font-black text-slate-900 text-sm">
              {formatINR(asPaise(snapshot.balanceAfterPayment ?? 0))}
            </span>
          </div>
        </div>

        {/* Footer & Signature Block */}
        <div className="pt-6 border-t border-slate-300 mt-6 flex justify-between items-end text-xs">
          <div className="text-slate-500 text-[10px] space-y-0.5">
            <p>Printed on: {clock.now().toLocaleDateString('en-IN')}</p>
            <p>Dr. Susheel Dental Clinic Management System</p>
            <p className="italic">Computer-generated official receipt.</p>
          </div>

          <div className="text-center w-48">
            <div className="border-b border-slate-400 mb-1 h-12"></div>
            <p className="font-bold text-slate-800">Authorized Signature</p>
            <p className="text-[10px] text-slate-500">Dr. Susheel Dental Clinic</p>
          </div>
        </div>
      </div>
    </div>
  );
}
