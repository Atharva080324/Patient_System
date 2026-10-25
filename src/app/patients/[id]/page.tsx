import React, { Suspense } from 'react';
import PatientDetailClient from './patient-detail-client';

export const metadata = {
  title: "Patient Profile - Dr. Susheel's Clinical Practice",
  description: "View patient clinical profile, chronological timeline, billing summary, and notes.",
};

async function PatientDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PatientDetailClient patientId={id} />;
}

export default function PatientDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading patient profile...</div>}>
      <PatientDetailContent params={props.params} />
    </Suspense>
  );
}
