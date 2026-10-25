import { Suspense } from 'react';
import { Metadata } from 'next';
import BillBuilderClient from './bill-builder-client';

export const metadata: Metadata = {
  title: 'New Bill | Dr. Susheel Dental Clinic',
  description: 'Create a new patient treatment bill and record initial payment.',
};

export default function NewBillPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center font-sans">
          Loading bill builder...
        </div>
      }
    >
      <BillBuilderClient />
    </Suspense>
  );
}
