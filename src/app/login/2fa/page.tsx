'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function TwoFactorForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email') || '';

  const [code, setCode] = useState('');
  const [isRecoveryCode, setIsRecoveryCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailParam,
          code: code.trim(),
          isRecoveryCode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Verification code failed. Please try again.');
        setLoading(false);
        return;
      }

      router.push('/settings/security');
    } catch {
      setError('Network communication failed. Please retry.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-lg p-8 shadow-sm">
      <header className="mb-6">
        <div className="text-xs font-semibold tracking-wider uppercase text-[#0a1a3f] mb-1">
          Two-Factor Authentication
        </div>
        <h1 className="text-xl font-bold text-[#151a22] leading-tight">
          Verify Identity
        </h1>
        <p className="text-sm text-[#475569] mt-1">
          {isRecoveryCode
            ? 'Enter one of your emergency recovery codes'
            : 'Enter the 6-digit code from your authenticator app'}
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 p-3 bg-[#fef2f2] border-l-4 border-[#b91c1c] text-sm text-[#991b1b] rounded"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label
            htmlFor="code"
            className="block text-sm font-medium text-[#151a22] mb-1.5"
          >
            {isRecoveryCode ? '10-Character Recovery Code' : '6-Digit TOTP Code'}
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode={isRecoveryCode ? 'text' : 'numeric'}
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-3 py-2.5 bg-white border border-[#cbd5e1] rounded text-[#151a22] text-sm tracking-widest font-mono text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
            placeholder={isRecoveryCode ? 'A1B2C3D4E5' : '123456'}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="w-full flex items-center justify-center bg-[#0a1a3f] hover:bg-[#12285a] text-white font-medium text-sm rounded px-4 py-3 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Verifying...' : 'Verify & Continue'}
        </button>

        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => {
              setIsRecoveryCode(!isRecoveryCode);
              setCode('');
              setError(null);
            }}
            className="text-xs text-[#0a1a3f] hover:underline cursor-pointer"
          >
            {isRecoveryCode
              ? '← Use standard authenticator code instead'
              : 'Lost access to device? Use recovery code'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function TwoFactorPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#f8fafc]">
      <Suspense fallback={<div className="text-sm text-[#475569]">Loading verification...</div>}>
        <TwoFactorForm />
      </Suspense>
    </main>
  );
}
