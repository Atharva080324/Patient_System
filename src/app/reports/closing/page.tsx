import { Suspense } from 'react';
import { ClosingReportClient } from './closing-client';

export const metadata = {
  title: "End of Day Closing Report | Dr. Susheel's Dental Clinic",
  description: 'Daily reconciliation of patient visits, token allocation, and wait time metrics',
};

export default function ClosingReportPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading closing report...</div>}>
      <ClosingReportClient />
    </Suspense>
  );
}
