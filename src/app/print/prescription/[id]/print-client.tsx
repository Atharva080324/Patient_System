'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface PrintClientProps {
  prescriptionId: string;
}

export default function PrintPrescriptionClient({ prescriptionId }: PrintClientProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rx, setRx] = useState<any | null>(null);
  const [paperSize, setPaperSize] = useState<'A5' | 'A4'>('A5');
  const [isReprint, setIsReprint] = useState(false);

  const fetchRx = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/prescriptions/${prescriptionId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load prescription');
      }
      setRx(data.prescription);
      setIsReprint((data.prescription.printCount || 0) > 0);
    } catch (err: any) {
      setError(err.message || 'Error loading prescription');
    } finally {
      setLoading(false);
    }
  }, [prescriptionId]);

  useEffect(() => {
    fetchRx();
  }, [fetchRx]);

  const handlePrint = async () => {
    try {
      // Record print audit
      await fetch(`/api/prescriptions/${prescriptionId}/print`, { method: 'POST' });
      setIsReprint(true);
    } catch (err) {
      console.error('Audit print failed:', err);
    }
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-800 font-sans">
        <p className="text-base font-semibold">Loading prescription document for print...</p>
      </div>
    );
  }

  if (error || !rx) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-800 font-sans">
        <div className="bg-white p-8 rounded-xl shadow border border-slate-300 max-w-md text-center">
          <h1 className="text-lg font-bold text-rose-600 mb-2">Prescription Unavailable</h1>
          <p className="text-sm text-slate-600 mb-4">{error || 'Prescription document not found.'}</p>
          <Link
            href="/queue"
            className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg inline-block"
          >
            ← Back to Queue
          </Link>
        </div>
      </div>
    );
  }

  const snapshot = rx.snapshot || {};
  const clinic = snapshot.clinic || {};
  const doctor = snapshot.doctor || {};
  const patient = snapshot.patient || {};
  const items = snapshot.items || rx.items || [];
  const isVoid = rx.status === 'VOID';

  return (
    <div className="min-h-screen bg-slate-200 py-6 px-2 sm:px-4 flex flex-col items-center">
      {/* Embedded Devanagari font for Marathi/Hindi fidelity */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap"
      />

      {/* Screen Controls Header (Hidden in Print) */}
      <div className="print:hidden max-w-3xl w-full mb-6 bg-slate-900 text-white p-4 rounded-xl shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/queue"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
          >
            ← Back to Queue
          </Link>
          <span className="font-mono text-sm font-bold text-emerald-400">
            {rx.rxNumber || 'DRAFT'}
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
            <span>Print Prescription</span>
          </button>
        </div>
      </div>

      {/* Printable Paper Document */}
      <div
        id="prescription-document"
        className={`relative bg-white text-slate-900 shadow-2xl p-6 sm:p-8 flex flex-col justify-between overflow-hidden font-sans border border-slate-300 print:shadow-none print:border-none print:m-0 print:p-6 ${
          paperSize === 'A5'
            ? 'w-[148mm] min-h-[210mm] max-w-full'
            : 'w-[210mm] min-h-[297mm] max-w-full'
        }`}
        style={{ fontFamily: "'Noto Sans Devanagari', system-ui, -apple-system, sans-serif" }}
      >
        {/* VOID Watermark */}
        {isVoid && (
          <div
            id="void-watermark"
            className="pointer-events-none absolute inset-0 flex items-center justify-center select-none z-10"
          >
            <div className="transform -rotate-45 text-rose-600/20 font-black text-7xl sm:text-9xl border-8 border-rose-600/20 px-8 py-4 rounded-3xl tracking-widest uppercase">
              VOID
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
                  {clinic.address || 'Chhatrapati Sambhajinagar, Maharashtra, India'}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  📞 {clinic.phone || '+91-98220-00000'} | Reg No: {clinic.registrationNo || 'MH-REG-DENT-001'}
                </p>
              </div>

              <div className="text-right">
                <p className="text-sm font-bold text-slate-900">{doctor.name || 'Dr. Susheel'}</p>
                <p className="text-xs text-slate-700">{doctor.qualification || 'BDS, MDS (Prosthodontics)'}</p>
                <p className="text-xs text-slate-600 font-mono">Reg: {doctor.registrationNumber || 'MH-DC-12345'}</p>
                {isReprint && (
                  <span className="inline-block mt-1 px-2 py-0.5 rounded bg-slate-150 text-slate-700 border border-slate-300 text-[10px] font-bold uppercase">
                    Reprint
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Patient Details & Date / RX Banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <span className="text-slate-600 block text-[10px] uppercase">Patient Name:</span>
              <span className="font-bold text-slate-900">{patient.name || 'Patient'}</span>
            </div>
            <div>
              <span className="text-slate-600 block text-[10px] uppercase">Patient Code / ID:</span>
              <span className="font-mono text-slate-800">{patient.patientCode || 'P-000000'}</span>
            </div>
            <div>
              <span className="text-slate-600 block text-[10px] uppercase">Age / Sex:</span>
              <span className="text-slate-800">
                {patient.ageYears ? `${patient.ageYears}y` : '—'} / {patient.sex || '—'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-600 block text-[10px] uppercase">RX Number & Date:</span>
              <span className="font-mono font-bold text-slate-900 block">{rx.rxNumber || 'DRAFT'}</span>
              <span className="text-slate-600 text-[11px]">{snapshot.date || 'Today'}</span>
            </div>
          </div>

          {/* Rx Symbol */}
          <div className="text-2xl font-serif font-black text-slate-900 mb-2">℞</div>

          {/* Numbered Medicines Table */}
          <div className="mb-6">
            <table className="w-full text-xs text-left text-slate-900 border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-300 text-[10px] font-bold uppercase text-slate-600">
                  <th className="py-1.5 px-2 w-8">#</th>
                  <th className="py-1.5 px-2">Medicine Name & Form</th>
                  <th className="py-1.5 px-2">Dose</th>
                  <th className="py-1.5 px-2">Frequency</th>
                  <th className="py-1.5 px-2">Duration</th>
                  <th className="py-1.5 px-2">Instructions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-400 italic">
                      No medicines listed on this prescription.
                    </td>
                  </tr>
                ) : (
                  items.map((item: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="py-2 px-2 font-mono text-slate-600">{idx + 1}</td>
                      <td className="py-2 px-2">
                        <span className="font-bold text-slate-900 text-xs block">{item.name}</span>
                        <span className="text-[11px] text-slate-600">
                          {item.form} • {item.strength}
                        </span>
                      </td>
                      <td className="py-2 px-2">{item.dose || '—'}</td>
                      <td className="py-2 px-2 font-semibold text-slate-900">{item.frequency}</td>
                      <td className="py-2 px-2 font-medium">{item.duration}</td>
                      <td className="py-2 px-2 text-slate-700 italic">{item.instruction || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Advice & Follow-Up Section */}
          <div className="space-y-3 border-t border-slate-200 pt-3 text-xs">
            {snapshot.advice && (
              <div>
                <span className="font-bold text-slate-800 uppercase text-[10px] block">Doctor Advice:</span>
                <p className="text-slate-800 whitespace-pre-line mt-0.5">{snapshot.advice}</p>
              </div>
            )}

            {snapshot.followUpDate && (
              <div>
                <span className="font-bold text-slate-800 uppercase text-[10px] block">Next Visit / Follow-up:</span>
                <p className="text-slate-800 mt-0.5">{snapshot.followUpDate}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer & Doctor Signature Block */}
        <div className="border-t border-slate-300 pt-4 mt-8 flex justify-between items-end text-xs">
          <div className="text-[10px] text-slate-600">
            <p>Dr. Susheel&apos;s Advanced Dental Clinic</p>
            <p className="font-mono mt-0.5">Valid with doctor signature & stamp</p>
          </div>

          <div className="text-center w-48">
            <div className="h-12 border-b border-dashed border-slate-400 mb-1" />
            <p className="font-bold text-slate-900">{doctor.name || 'Dr. Susheel'}</p>
            <p className="text-[10px] text-slate-600">Authorized Signature & Seal</p>
          </div>
        </div>
      </div>
    </div>
  );
}
