'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatINR, amountInWordsINR, asPaise } from '@/lib/money';
import { clock } from '@/lib/clock';

interface PrintBillClientProps {
  billId: string;
}

export default function PrintBillClient({ billId }: PrintBillClientProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<any | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [paperSize, setPaperSize] = useState<'A5' | 'A4'>('A5');
  const [isReprint, setIsReprint] = useState(false);

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
          setIsReprint((data.bill?.printCount || 0) > 0);
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

  const handlePrint = async () => {
    try {
      await fetch(`/api/bills/${billId}/print`, { method: 'POST' });
      setIsReprint(true);
    } catch (err) {
      console.error('Audit bill print failed:', err);
    }
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-800 font-sans">
        <p className="text-base font-semibold">Loading bill document...</p>
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-800 font-sans">
        <div className="bg-white p-8 rounded-xl shadow border border-slate-300 max-w-md text-center">
          <h1 className="text-lg font-bold text-rose-600 mb-2">Bill Unavailable</h1>
          <p className="text-sm text-slate-600 mb-4">{error || 'Bill document not found.'}</p>
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

  const items = bill.items || [];
  const isCancelled = bill.status === 'CANCELLED';

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
            {bill.billNo || 'BILL'}
          </span>
          {isReprint && (
            <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-700/60 text-xs font-bold">
              Reprint
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
            <span>Print Bill</span>
          </button>
        </div>
      </div>

      {/* Printable Paper Document */}
      <div
        id="bill-document"
        className={`relative bg-white text-slate-900 shadow-2xl p-6 sm:p-8 flex flex-col justify-between overflow-hidden font-sans border border-slate-300 print:shadow-none print:border-none print:m-0 print:p-6 ${
          paperSize === 'A5'
            ? 'w-[148mm] min-h-[210mm] max-w-full'
            : 'w-[210mm] min-h-[297mm] max-w-full'
        }`}
      >
        {/* Cancelled Watermark */}
        {isCancelled && (
          <div
            id="cancelled-watermark"
            className="pointer-events-none absolute inset-0 flex items-center justify-center select-none z-10"
          >
            <div className="transform -rotate-45 text-rose-600/20 font-black text-6xl sm:text-8xl border-8 border-rose-600/20 px-8 py-4 rounded-3xl tracking-widest uppercase">
              CANCELLED
            </div>
          </div>
        )}

        <div>
          {/* Letterhead Header */}
          <div className="border-b-2 border-slate-900 pb-3 mb-4">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight uppercase">
                  Dr. Susheel&apos;s Advanced Dental Clinic & Implant Center
                </h1>
                <p className="text-xs text-slate-700 leading-tight mt-0.5 max-w-md">
                  Station Road, Chhatrapati Sambhajinagar, Maharashtra
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  📞 +91-98220-12345 | Reg No: MH-AUR-2024-0891
                </p>
              </div>

              <div className="text-right">
                <p className="text-sm font-bold text-slate-900">Dr. Susheel Shinde</p>
                <p className="text-xs text-slate-700">BDS, MDS (Oral & Maxillofacial Implantology)</p>
                <div className="inline-block mt-1 px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-900 text-[11px] font-bold uppercase tracking-wider">
                  Official Bill / Invoice
                </div>
              </div>
            </div>
          </div>

          {/* Meta Banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Bill Number:</span>
              <span className="font-bold text-slate-900 font-mono">{bill.billNo}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Bill Date:</span>
              <span className="font-medium text-slate-800">
                {new Date(bill.createdAt || clock.now()).toLocaleDateString('en-IN')}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Status:</span>
              <span
                className={`font-bold inline-block px-1.5 py-0.5 rounded text-[10px] ${
                  bill.status === 'PAID'
                    ? 'bg-emerald-100 text-emerald-800'
                    : bill.status === 'PARTIAL'
                    ? 'bg-amber-100 text-amber-800'
                    : bill.status === 'CANCELLED'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-slate-200 text-slate-800'
                }`}
              >
                {bill.status}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Balance Due:</span>
              <span className="font-bold text-rose-700 font-mono">
                {formatINR(asPaise(bill.balance))}
              </span>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="mb-4">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-slate-900 text-slate-800">
                  <th className="py-2 px-1 font-bold w-10">#</th>
                  <th className="py-2 px-1 font-bold">Treatment / Procedure</th>
                  <th className="py-2 px-1 font-bold text-center w-20">Teeth</th>
                  <th className="py-2 px-1 font-bold text-center w-14">Qty</th>
                  <th className="py-2 px-1 font-bold text-right w-24">Unit Price</th>
                  <th className="py-2 px-1 font-bold text-right w-28">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((item: any, idx: number) => (
                  <tr key={idx}>
                    <td className="py-2 px-1 font-medium text-slate-500">{idx + 1}</td>
                    <td className="py-2 px-1 font-semibold text-slate-900">{item.description}</td>
                    <td className="py-2 px-1 text-center font-mono text-slate-700">
                      {item.teeth && item.teeth.length > 0 ? item.teeth.join(', ') : '—'}
                    </td>
                    <td className="py-2 px-1 text-center font-medium text-slate-700">{item.qty}</td>
                    <td className="py-2 px-1 text-right font-mono text-slate-800">
                      {formatINR(asPaise(item.unitPrice))}
                    </td>
                    <td className="py-2 px-1 text-right font-mono font-bold text-slate-900">
                      {formatINR(asPaise(item.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Financial Totals */}
          <div className="flex justify-end mb-4">
            <div className="w-64 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-mono">{formatINR(asPaise(bill.subtotal))}</span>
              </div>
              {bill.discount > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Discount:</span>
                  <span className="font-mono">- {formatINR(asPaise(bill.discount))}</span>
                </div>
              )}
              <div className="border-t border-slate-300 pt-1 flex justify-between font-bold text-slate-900">
                <span>Total Bill Amount:</span>
                <span className="font-mono">{formatINR(asPaise(bill.total))}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-medium">
                <span>Total Paid:</span>
                <span className="font-mono">{formatINR(asPaise(bill.paid))}</span>
              </div>
              <div className="border-t border-slate-400 pt-1.5 flex justify-between text-sm font-black text-rose-700">
                <span>Outstanding Balance:</span>
                <span className="font-mono">{formatINR(asPaise(bill.balance))}</span>
              </div>
            </div>
          </div>

          {/* Payment History (if any) */}
          {payments.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-1.5">
                Payments & Receipts Recorded
              </h3>
              <table className="w-full text-left border-collapse text-xs border border-slate-200">
                <thead className="bg-slate-100">
                  <tr className="border-b border-slate-200 text-slate-700">
                    <th className="py-1.5 px-2">Receipt No</th>
                    <th className="py-1.5 px-2">Date</th>
                    <th className="py-1.5 px-2">Method</th>
                    <th className="py-1.5 px-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150">
                  {payments.map((p, idx) => (
                    <tr key={idx} className={p.isReversal ? 'bg-rose-50/70 text-rose-800' : ''}>
                      <td className="py-1.5 px-2 font-mono font-medium">
                        {p.receiptNo} {p.isReversal && '(Reversal)'}
                      </td>
                      <td className="py-1.5 px-2 text-slate-600">
                        {new Date(p.receivedAt || p.createdAt).toLocaleDateString('en-IN')}
                      </td>
                      <td className="py-1.5 px-2 font-medium">{p.method}</td>
                      <td className="py-1.5 px-2 text-right font-mono font-bold">
                        {p.amount < 0 ? `- ${formatINR(asPaise(Math.abs(p.amount)))}` : formatINR(asPaise(p.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Amount in words */}
          <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs">
            <span className="text-slate-500 font-semibold block text-[10px] uppercase">
              Total Amount in Words:
            </span>
            <span className="font-bold text-slate-800">{amountInWordsINR(asPaise(bill.total))}</span>
          </div>
        </div>

        {/* Footer & Doctor Signature */}
        <div className="pt-6 border-t border-slate-300 mt-6 flex justify-between items-end text-xs">
          <div className="text-slate-500 text-[10px] space-y-0.5">
            <p>Printed on: {clock.now().toLocaleDateString('en-IN')}</p>
            <p>Dr. Susheel Dental Clinic Management System</p>
          </div>

          <div className="text-center w-48">
            <div className="border-b border-slate-400 mb-1 h-12"></div>
            <p className="font-bold text-slate-800">Doctor&apos;s Signature</p>
            <p className="text-[10px] text-slate-500">Dr. Susheel Shinde</p>
          </div>
        </div>
      </div>
    </div>
  );
}
