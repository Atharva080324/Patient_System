'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid credentials. Please verify your email and password.');
        setLoading(false);
        return;
      }

      if (data.requires2FA) {
        router.push(`/login/2fa?email=${encodeURIComponent(email)}`);
        return;
      }

      router.push('/settings/security');
    } catch {
      setError('Unable to reach the server. Please check your network connection.');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#f8fafc]">
      <div className="w-full max-w-md bg-white border border-[#cbd5e1] rounded-lg p-8 shadow-sm">
        <header className="mb-6">
          <div className="text-xs font-semibold tracking-wider uppercase text-[#0a1a3f] mb-1">
            Clinical System Login
          </div>
          <h1 className="text-xl font-bold text-[#151a22] leading-tight">
            Dr. Susheel&apos;s Advanced Dental Clinic
          </h1>
          <p className="text-sm text-[#475569] mt-1">
            Chhatrapati Sambhaginar | Doctor Console
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
              htmlFor="email"
              className="block text-sm font-medium text-[#151a22] mb-1.5"
            >
              Doctor Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-[#cbd5e1] rounded text-[#151a22] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
              placeholder="doctor@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[#151a22] mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-[#cbd5e1] rounded text-[#151a22] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
              placeholder="••••••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center bg-[#0a1a3f] hover:bg-[#12285a] text-white font-medium text-sm rounded px-4 py-3 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying Credentials...' : 'Sign In to Console'}
          </button>
        </form>

        <footer className="mt-8 pt-4 border-t border-[#e2e8f0] text-center text-xs text-[#64748b]">
          Single Doctor Medical Records &bull; Encrypted Storage
        </footer>
      </div>
    </main>
  );
}
