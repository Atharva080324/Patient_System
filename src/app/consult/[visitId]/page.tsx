import { Suspense } from 'react';
import { Metadata } from 'next';
import ConsultClient from './consult-client';

export const metadata: Metadata = {
  title: 'Consultation & Prescription | Dr. Susheel Dental Clinic',
  description: 'Doctor consultation workspace, case sheet recording, and prescription generation.',
};

async function ConsultContent({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <ConsultClient visitId={visitId} />;
}

export default function ConsultPage(props: { params: Promise<{ visitId: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
          Loading consultation workspace...
        </div>
      }
    >
      <ConsultContent params={props.params} />
    </Suspense>
  );
}
