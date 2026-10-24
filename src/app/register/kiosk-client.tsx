'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface KioskClientProps {
  initialUnlocked: boolean;
}

const QUICK_REASONS = [
  'Toothache / Pain',
  'Teeth Cleaning / Scaling',
  'Routine Checkup',
  'Bleeding Gums',
  'Cavity / Filling',
  'Dental Implant',
  'Crown / Bridge Fix',
  'Braces / Alignment',
];

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (
      +c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
    ).toString(16)
  );
}

export function KioskClient({ initialUnlocked }: KioskClientProps) {
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [ageMode, setAgeMode] = useState<'age' | 'dob'>('age');
  const [ageYears, setAgeYears] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [phone, setPhone] = useState('');
  const [reasonForVisit, setReasonForVisit] = useState('');
  const [consent, setConsent] = useState(false);
  const [confirmHp, setConfirmHp] = useState(''); // Honeypot

  // Form state
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(generateIdempotencyKey);

  // Success state
  const [tokenResult, setTokenResult] = useState<number | null>(null);
  const [resetCountdown, setResetCountdown] = useState(10);

  const handleResetForm = useCallback(() => {
    setName('');
    setAgeMode('age');
    setAgeYears('');
    setDob('');
    setSex('Male');
    setPhone('');
    setReasonForVisit('');
    setConsent(false);
    setConfirmHp('');
    setFormError('');
    setTokenResult(null);
    setResetCountdown(10);
    setIdempotencyKey(generateIdempotencyKey());
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/register');
    }
  }, []);

  // Countdown timer for success screen auto-reset (10 seconds)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (tokenResult !== null) {
      timer = setInterval(() => {
        setResetCountdown((prev) => {
          if (prev <= 1) {
            handleResetForm();
            return 10;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [tokenResult, handleResetForm]);

  // Prevent browser back button from restoring previous entry
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/register');
      const handlePopState = () => {
        handleResetForm();
      };
      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  }, [handleResetForm]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    setPinLoading(true);

    try {
      const res = await fetch('/api/kiosk/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      if (res.ok) {
        setUnlocked(true);
        setPin('');
      } else {
        const data = await res.json().catch(() => ({}));
        setPinError(data.error || 'Invalid PIN. Please try again.');
      }
    } catch {
      setPinError('Connection error. Please try again.');
    } finally {
      setPinLoading(false);
    }
  };

  const handleLock = async () => {
    try {
      await fetch('/api/kiosk/lock', { method: 'POST' });
    } catch {
      // Ignore network error on lock
    }
    setUnlocked(false);
    handleResetForm();
  };

  const handleChipClick = (chip: string) => {
    if (!reasonForVisit) {
      setReasonForVisit(chip);
    } else if (!reasonForVisit.includes(chip)) {
      setReasonForVisit(`${reasonForVisit}, ${chip}`.slice(0, 200));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim()) {
      setFormError('Please enter your full name.');
      return;
    }

    if (ageMode === 'age') {
      const ageNum = parseInt(ageYears, 10);
      if (isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
        setFormError('Please enter a valid age between 0 and 120.');
        return;
      }
    } else {
      if (!dob) {
        setFormError('Please select your date of birth.');
        return;
      }
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setFormError('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      return;
    }

    if (!reasonForVisit.trim()) {
      setFormError('Please provide a reason for your visit.');
      return;
    }

    if (!consent) {
      setFormError('Please agree to the registration consent to continue.');
      return;
    }

    setSubmitting(true);

    const payload: any = {
      name: name.trim(),
      sex,
      phone: cleanPhone,
      reasonForVisit: reasonForVisit.trim().slice(0, 200),
      consent: true,
      consentTextVersion: '1.0',
      idempotencyKey,
    };

    if (ageMode === 'age') {
      payload.ageYears = parseInt(ageYears, 10);
    } else {
      payload.dob = dob;
    }

    if (confirmHp) {
      payload.confirm_hp = confirmHp;
    }

    try {
      const res = await fetch('/api/kiosk/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        setUnlocked(false);
        setPinError('Kiosk session expired. Please unlock again.');
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setTokenResult(data.token);
      } else {
        setFormError(data.error || 'Failed to complete registration. Please speak to clinic reception.');
      }
    } catch {
      setFormError('Unable to reach the server. Please check connection or speak to the desk.');
    } finally {
      setSubmitting(false);
    }
  };

  // 1. PIN Screen (Locked)
  if (!unlocked) {
    return (
      <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Dr. Susheel&apos;s Dental Clinic
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Patient Registration Tablet • Kiosk Terminal
            </p>
            <div className="inline-flex items-center gap-2 mt-4 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold uppercase tracking-wider border border-amber-500/20">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Terminal Locked
            </div>
          </div>

          {pinError && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-6 p-4 rounded-xl bg-red-950/50 border border-red-500/50 text-red-200 text-sm text-center font-medium"
            >
              {pinError}
            </div>
          )}

          <form onSubmit={handleUnlock} className="space-y-6">
            <div>
              <label
                htmlFor="kiosk-pin"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                Enter Staff PIN to Unlock
              </label>
              <input
                id="kiosk-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={10}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••"
                className="w-full text-center text-3xl tracking-widest font-mono bg-slate-900 border border-slate-700 text-white rounded-xl py-4 px-4 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-slate-600 transition"
                autoComplete="off"
              />
            </div>

            <button
              id="btn-unlock-kiosk"
              type="submit"
              disabled={pinLoading || pin.length < 4}
              className="w-full py-4 px-6 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-blue-600/30 text-lg cursor-pointer"
            >
              {pinLoading ? 'Unlocking...' : 'Unlock Kiosk'}
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            Authorized clinic staff only. Walk-in patients cannot access terminal settings.
          </p>
        </div>
      </main>
    );
  }

  // 2. Success Screen (Token Assigned)
  if (tokenResult !== null) {
    return (
      <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-slate-900">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl p-8 sm:p-12 shadow-xl text-center">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <span className="text-sm font-semibold text-emerald-700 tracking-wider uppercase bg-emerald-50 px-4 py-1.5 rounded-full border border-emerald-200">
            Registration Complete
          </span>

          <h1 className="text-2xl font-bold text-slate-900 mt-6">
            Your Token Number
          </h1>

          <div
            id="token-display"
            className="my-6 py-6 px-8 bg-slate-900 text-white rounded-2xl shadow-inner inline-block min-w-[200px]"
          >
            <span className="text-6xl sm:text-7xl font-extrabold tracking-tight font-mono text-emerald-400">
              #{tokenResult}
            </span>
          </div>

          <p className="text-lg text-slate-600 max-w-sm mx-auto leading-relaxed">
            Please take a seat in the waiting lounge. Dr. Susheel will call token{' '}
            <strong className="text-slate-900">#{tokenResult}</strong> shortly.
          </p>

          <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col items-center gap-4">
            <p className="text-sm text-slate-600">
              Screen will reset automatically in{' '}
              <span className="font-semibold text-slate-700 font-mono">
                {resetCountdown}s
              </span>
            </p>
            <button
              id="btn-new-registration"
              onClick={handleResetForm}
              className="py-3 px-8 rounded-xl font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 transition text-sm cursor-pointer"
            >
              Done / Next Patient
            </button>
          </div>
        </div>
      </main>
    );
  }

  // 3. Unlocked Registration Form (Tablet-Friendly 820px+)
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Top Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-20">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">
            Dr. Susheel&apos;s Dental Clinic &amp; Implant Center
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Patient Self-Registration Tablet
          </p>
        </div>

        <button
          id="btn-lock-kiosk"
          onClick={handleLock}
          type="button"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 transition cursor-pointer"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          Lock Kiosk
        </button>
      </header>

      {/* Main Form Container */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900">
              Welcome! Please Register for Today&apos;s Visit
            </h2>
            <p className="text-slate-500 text-sm mt-1">
              Fill in your details below to receive your clinic token.
            </p>
          </div>

          {formError && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-3"
            >
              <svg
                className="w-5 h-5 text-red-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            {/* Honeypot field (hidden from real users) */}
            <div
              style={{
                position: 'absolute',
                left: '-9999px',
                width: '1px',
                height: '1px',
                overflow: 'hidden',
              }}
              aria-hidden="true"
            >
              <label htmlFor="confirm_hp">Do not fill this field</label>
              <input
                id="confirm_hp"
                type="text"
                name="confirm_hp"
                tabIndex={-1}
                autoComplete="off"
                value={confirmHp}
                onChange={(e) => setConfirmHp(e.target.value)}
              />
            </div>

            {/* Full Name */}
            <div>
              <label
                htmlFor="kiosk-name"
                className="block text-sm font-semibold text-slate-700 mb-2"
              >
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                id="kiosk-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ramesh Patil"
                className="w-full text-lg px-4 py-3.5 rounded-xl border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition placeholder-slate-400"
              />
            </div>

            {/* Age / Date of Birth Selector */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700">
                  Age / Date of Birth <span className="text-red-500">*</span>
                </span>
                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setAgeMode('age')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                      ageMode === 'age'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Age in Years
                  </button>
                  <button
                    type="button"
                    onClick={() => setAgeMode('dob')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                      ageMode === 'dob'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Date of Birth
                  </button>
                </div>
              </div>

              {ageMode === 'age' ? (
                <div>
                  <label htmlFor="kiosk-age" className="sr-only">
                    Age in Years
                  </label>
                  <input
                    id="kiosk-age"
                    type="number"
                    min="0"
                    max="120"
                    placeholder="Enter age in years (e.g. 35)"
                    value={ageYears}
                    onChange={(e) => setAgeYears(e.target.value)}
                    className="w-full text-lg px-4 py-3.5 rounded-xl border border-slate-300 bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="kiosk-dob" className="sr-only">
                    Date of Birth
                  </label>
                  <input
                    id="kiosk-dob"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full text-lg px-4 py-3.5 rounded-xl border border-slate-300 bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition"
                  />
                </div>
              )}
            </div>

            {/* Sex */}
            <div>
              <span className="block text-sm font-semibold text-slate-700 mb-2">
                Sex <span className="text-red-500">*</span>
              </span>
              <div className="grid grid-cols-3 gap-3">
                {(['Male', 'Female', 'Other'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSex(s)}
                    className={`py-3.5 text-base font-semibold rounded-xl border transition cursor-pointer ${
                      sex === s
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Number */}
            <div>
              <label
                htmlFor="kiosk-phone"
                className="block text-sm font-semibold text-slate-700 mb-2"
              >
                Mobile Number <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 font-semibold text-lg">
                  +91
                </span>
                <input
                  id="kiosk-phone"
                  type="tel"
                  required
                  maxLength={10}
                  inputMode="numeric"
                  placeholder="98220 12345"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  className="w-full text-lg pl-16 pr-4 py-3.5 rounded-xl border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition font-mono tracking-wider"
                />
              </div>
            </div>

            {/* Reason for Visit + Quick Pick Chips */}
            <div>
              <label
                htmlFor="kiosk-reason"
                className="block text-sm font-semibold text-slate-700 mb-2"
              >
                Reason for Visit <span className="text-red-500">*</span>
              </label>

              {/* Quick Pick Chips */}
              <div className="flex flex-wrap gap-2 mb-3">
                {QUICK_REASONS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleChipClick(chip)}
                    className="px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition cursor-pointer"
                  >
                    + {chip}
                  </button>
                ))}
              </div>

              <textarea
                id="kiosk-reason"
                rows={3}
                required
                maxLength={200}
                placeholder="Describe your issue or select from the options above..."
                value={reasonForVisit}
                onChange={(e) => setReasonForVisit(e.target.value)}
                className="w-full text-base p-4 rounded-xl border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition placeholder-slate-400"
              />
              <span className="block text-right text-xs text-slate-600 mt-1">
                {reasonForVisit.length}/200
              </span>
            </div>

            {/* Consent Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-3.5 p-4 rounded-2xl bg-blue-50/60 border border-blue-200 cursor-pointer">
                <input
                  id="kiosk-consent"
                  type="checkbox"
                  required
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer shrink-0"
                />
                <span className="text-xs sm:text-sm text-slate-700 leading-snug">
                  I agree to register as a walk-in patient at{' '}
                  <strong>
                    Dr. Susheel&apos;s Advanced Dental Clinic &amp; Implant Center
                  </strong>{' '}
                  and consent to clinical examination & treatment records.
                </span>
              </label>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                id="btn-register-submit"
                type="submit"
                disabled={submitting}
                className="w-full py-4 px-6 rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-blue-600/25 text-lg cursor-pointer flex items-center justify-center gap-3"
              >
                {submitting ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>Registering...</span>
                  </>
                ) : (
                  <span>Register & Get Token</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
