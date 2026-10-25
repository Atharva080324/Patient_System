import { Suspense } from 'react';
import { Metadata } from 'next';
import PrintBillClient from './print-client';

export const metadata: Metadata = {
  title: 'Print Bill | Dr. Susheel Dental Clinic',
  description: 'Official treatment bill document print view.',
};

async function PrintContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintBillClient billId={id} />;
}

export default function PrintBillPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center font-sans">
          Loading bill for printing...
        </div>
      }
    >
      <PrintContent params={props.params} />
    </Suspense>
  );
}
