import { Suspense } from 'react';
import { Metadata } from 'next';
import PrintPrescriptionClient from './print-client';

export const metadata: Metadata = {
  title: 'Print Prescription | Dr. Susheel Dental Clinic',
  description: 'Official clinical prescription print and reprint view.',
};

async function PrintContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintPrescriptionClient prescriptionId={id} />;
}

export default function PrintPrescriptionPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center">
          Loading print view...
        </div>
      }
    >
      <PrintContent params={props.params} />
    </Suspense>
  );
}
