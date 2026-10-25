import React, { Suspense } from 'react';
import PatientsClient from './patients-client';

export const metadata = {
  title: "Patients Directory - Dr. Susheel's Clinical Practice",
  description: "Search, filter, view, and export clinical patient records.",
};

export default function PatientsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading patients directory...</div>}>
      <PatientsClient />
    </Suspense>
  );
}
