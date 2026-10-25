import { Suspense } from 'react';
import { Metadata } from 'next';
import BillingClient from './billing-client';

export const metadata: Metadata = {
  title: 'Billing & Estimates | Dr. Susheel Dental Clinic',
  description: 'Manage patient estimates, bills, payments, and receipts.',
};

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center font-sans">
          Loading billing workspace...
        </div>
      }
    >
      <BillingClient />
    </Suspense>
  );
}
