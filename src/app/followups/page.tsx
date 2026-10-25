import { Suspense } from 'react';
import FollowUpsClient from './followups-client';

export const metadata = {
  title: "Follow-ups | Dr. Susheel's Dental Clinic",
  description: 'Track and manage patient dental follow-ups, overdue care, and scheduling',
};

export default function FollowUpsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading follow-ups...</div>}>
      <FollowUpsClient />
    </Suspense>
  );
}
