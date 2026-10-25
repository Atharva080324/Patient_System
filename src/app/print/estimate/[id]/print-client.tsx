'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatINR, amountInWordsINR, asPaise } from '@/lib/money';
import { clock } from '@/lib/clock';

interface PrintEstimateClientProps {
  estimateId: string;
}

export default function PrintEstimateClient({ estimateId }: PrintEstimateClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<any | null>(null);
  const [paperSize, setPaperSize] = useState<'A5' | 'A4'>('A5');
  const [isReprint, setIsReprint] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/estimates/${estimateId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
        } else {
          setEstimate(data.estimate);
          setIsReprint((data.estimate?.printCount || 0) > 0);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Error loading estimate');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [estimateId]);

  const handleConvert = async () => {
    try {
      setConverting(true);
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
      setConverting(false);
    }
  };

  const handlePrint = async () => {
    try {
      await fetch(`/api/estimates/${estimateId}/print`, { method: 'POST' });
      setIsReprint(true);
    } catch (err) {
      console.error('Audit estimate print failed:', err);
    }
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-800 font-sans">
        <p className="text-base font-semibold">Loading treatment estimate document...</p>
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-800 font-sans">
        <div className="bg-white p-8 rounded-xl shadow border border-slate-300 max-w-md text-center">
          <h1 className="text-lg font-bold text-rose-600 mb-2">Estimate Unavailable</h1>
          <p className="text-sm text-slate-600 mb-4">{error || 'Estimate document not found.'}</p>
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

  const snapshot = estimate.snapshot || {};
  const clinic = snapshot.clinic || {};
  const doctor = snapshot.doctor || {};
  const patient = snapshot.patient || {};
  const items = snapshot.items || estimate.items || [];
  const isCancelled = estimate.status === 'CANCELLED';

  return (
    <div className="min-h-screen bg-slate-200 py-6 px-2 sm:px-4 flex flex-col items-center">
      {/* Screen Controls (Hidden during printing) */}
      <div className="print:hidden max-w-3xl w-full mb-6 bg-slate-900 text-white p-4 rounded-xl shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/billing"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
          >
            ← Back to Billing
          </Link>
          <span className="font-mono text-sm font-bold text-emerald-400">
            {estimate.estimateNo || 'DRAFT ESTIMATE'}
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

          {estimate.status === 'ISSUED' && (
            <button
              type="button"
              id="btn-convert-estimate-toolbar"
              onClick={handleConvert}
              disabled={converting}
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold shadow transition disabled:opacity-50 flex items-center space-x-1.5"
            >
              <span>✓</span>
              <span>{converting ? 'Converting...' : 'Convert to Bill'}</span>
            </button>
          )}

          <button
            type="button"
            id="btn-trigger-print"
            onClick={handlePrint}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow transition flex items-center space-x-1.5"
          >
            <span>🖨️</span>
            <span>Print Estimate</span>
          </button>
        </div>
      </div>

      {/* Printable Paper Document */}
      <div
        id="estimate-document"
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
                <p className="text-sm font-bold text-slate-900">{doctor.name || 'Dr. Susheel Shinde'}</p>
                <p className="text-xs text-slate-700">{doctor.qualification || 'BDS, MDS (Oral & Maxillofacial Implantology)'}</p>
                <div className="inline-block mt-1 px-2.5 py-0.5 rounded bg-blue-100 text-blue-900 text-[11px] font-bold uppercase tracking-wider">
                  Treatment Estimate
                </div>
              </div>
            </div>
          </div>

          {/* Patient Details & Estimate Meta */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Patient Name:</span>
              <span className="font-bold text-slate-900">{patient.name || 'Patient'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Patient ID / Age / Sex:</span>
              <span className="font-medium text-slate-800">
                {patient.patientCode || 'P-0001'} | {patient.ageYears || 0}y | {patient.sex || 'Unknown'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Estimate No & Date:</span>
              <span className="font-bold text-slate-900">
                {estimate.estimateNo || 'DRAFT'} ({snapshot.date || 'Today'})
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Valid Until:</span>
              <span className="font-bold text-amber-700">
                {estimate.validUntil || '30 days from date'}
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
                  <th className="py-2 px-1 font-bold text-center w-20">Teeth (FDI)</th>
                  <th className="py-2 px-1 font-bold text-center w-14">Qty</th>
                  <th className="py-2 px-1 font-bold text-right w-24">Unit Price</th>
                  <th className="py-2 px-1 font-bold text-right w-28">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
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
                <span className="font-mono">{formatINR(asPaise(estimate.subtotal))}</span>
              </div>
              {estimate.discount > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Discount:</span>
                  <span className="font-mono">- {formatINR(asPaise(estimate.discount))}</span>
                </div>
              )}
              <div className="border-t border-slate-300 pt-1.5 flex justify-between text-sm font-black text-slate-900">
                <span>Total Estimated:</span>
                <span className="font-mono text-blue-900">{formatINR(asPaise(estimate.total))}</span>
              </div>
            </div>
          </div>

          {/* Amount in Words */}
          <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs">
            <span className="text-slate-500 font-semibold block text-[10px] uppercase">Amount in Words:</span>
            <span className="font-bold text-slate-800">{amountInWordsINR(asPaise(estimate.total))}</span>
          </div>

          {/* Notes */}
          {estimate.notes && (
            <div className="mb-4 text-xs text-slate-600 bg-amber-50/60 border border-amber-200/80 rounded-lg p-2.5">
              <span className="font-bold text-amber-900 block text-[10px] uppercase">Notes / Instructions:</span>
              <p className="mt-0.5 whitespace-pre-wrap">{estimate.notes}</p>
            </div>
          )}

          {/* Prominent Legal Disclaimer */}
          <div className="mt-4 p-2 bg-amber-100 border border-amber-300 rounded text-center text-xs font-bold text-amber-950 uppercase tracking-wide">
            ⚠ This is an estimate, not a bill
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
            <p className="text-[10px] text-slate-500">{doctor.name || 'Dr. Susheel Shinde'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
