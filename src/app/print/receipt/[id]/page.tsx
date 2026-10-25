import { Suspense } from 'react';
import { Metadata } from 'next';
import PrintReceiptClient from './print-client';

export const metadata: Metadata = {
  title: 'Print Payment Receipt | Dr. Susheel Dental Clinic',
  description: 'Official clinical payment receipt print view.',
};

async function PrintContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintReceiptClient paymentId={id} />;
}

export default function PrintReceiptPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center font-sans">
          Loading receipt document for print...
        </div>
      }
    >
      <PrintContent params={props.params} />
    </Suspense>
  );
}
