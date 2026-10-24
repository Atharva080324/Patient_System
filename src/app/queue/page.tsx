import { Suspense } from 'react';
import { QueueClient } from './queue-client';

export const metadata = {
  title: "Live Queue | Dr. Susheel's Dental Clinic",
  description: 'Real-time patient queue, operatory status, and clinical transitions',
};

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading queue...</div>}>
      <QueueClient />
    </Suspense>
  );
}
