import React, { Suspense } from 'react';
import DashboardClient from './dashboard-client';

export const metadata = {
  title: "Dashboard - Dr. Susheel's Clinical Practice",
  description: "Real-time clinical dashboard, daily operations, appointments, queue, and collections.",
};

export default function HomePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading clinical dashboard...</div>}>
      <DashboardClient />
    </Suspense>
  );
}
