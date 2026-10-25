import { Suspense } from 'react';
import { Metadata } from 'next';
import BillDetailClient from './bill-detail-client';

export const metadata: Metadata = {
  title: 'Bill Details & Payments | Dr. Susheel Dental Clinic',
  description: 'View patient bill, record payments, and manage receipts.',
};

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillDetailClient billId={id} />;
}

export default function BillDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center font-sans">
          Loading bill details...
        </div>
      }
    >
      <Content params={props.params} />
    </Suspense>
  );
}
