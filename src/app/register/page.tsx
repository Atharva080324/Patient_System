import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { validateKioskToken, getKioskCookieName } from '@/lib/auth';
import { KioskClient } from './kiosk-client';

export const metadata = {
  title: 'Walk-in Patient Registration | Dr. Susheel Dental Clinic',
  description: 'Patient self-registration kiosk for walk-in appointments',
};

async function KioskLoader() {
  const cookieStore = await cookies();
  const kioskCookie = cookieStore.get(getKioskCookieName())?.value;
  let isUnlocked = false;

  if (kioskCookie) {
    try {
      const device = await validateKioskToken(kioskCookie);
      isUnlocked = !!device;
    } catch {
      isUnlocked = false;
    }
  }

  return <KioskClient initialUnlocked={isUnlocked} />;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading terminal...</div>}>
      <KioskLoader />
    </Suspense>
  );
}
