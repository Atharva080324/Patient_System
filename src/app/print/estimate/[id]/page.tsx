import { Suspense } from 'react';
import { Metadata } from 'next';
import PrintEstimateClient from './print-client';

export const metadata: Metadata = {
  title: 'Print Estimate | Dr. Susheel Dental Clinic',
  description: 'Official treatment estimate document print view.',
};

async function PrintContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintEstimateClient estimateId={id} />;
}

export default function PrintEstimatePage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center font-sans">
          Loading estimate for printing...
        </div>
      }
    >
      <PrintContent params={props.params} />
    </Suspense>
  );
}
