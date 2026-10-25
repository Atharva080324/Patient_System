import { Suspense } from 'react';
import { Metadata } from 'next';
import EstimateBuilderClient from './estimate-builder-client';

export const metadata: Metadata = {
  title: 'New Treatment Estimate | Dr. Susheel Dental Clinic',
  description: 'Create and issue a patient dental treatment estimate.',
};

export default function NewEstimatePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center font-sans">
          Loading estimate builder...
        </div>
      }
    >
      <EstimateBuilderClient />
    </Suspense>
  );
}
