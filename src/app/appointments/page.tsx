import { Suspense } from 'react';
import AppointmentsClient from './appointments-client';

export const metadata = {
  title: "Appointments | Dr. Susheel's Dental Clinic",
  description: 'Manage clinic appointments, schedule slots, and check-in to live queue',
};

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading appointments...</div>}>
      <AppointmentsClient />
    </Suspense>
  );
}
