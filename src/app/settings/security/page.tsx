'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  totpEnabled: boolean;
}

export default function SecuritySettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);

  // 2FA Setup State
  const [totpSetupData, setTotpSetupData] = useState<{
    secret: string;
    qrCodeDataUrl: string;
    recoveryCodes: string[];
    hashedRecoveryCodes: Array<{ hash: string }>;
  } | null>(null);
  const [setupPassword, setSetupPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisableModal, setShowDisableModal] = useState(false);

  // Kiosk PIN State
  const [kioskDoctorPwd, setKioskDoctorPwd] = useState('');
  const [newKioskPin, setNewKioskPin] = useState('');
  const [kioskLoading, setKioskLoading] = useState(false);

  const router = useRouter();

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setProfile(data.user);
      }
    } catch {
      // Ignore fetch error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    if (newPassword !== confirmPassword) {
      setStatusMessage({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    if (newPassword.length < 12) {
      setStatusMessage({ type: 'error', text: 'Password must be at least 12 characters long.' });
      return;
    }

    setPwdLoading(true);
    try {
      const res = await fetch('/api/settings/security/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusMessage({ type: 'error', text: data.error || 'Failed to change password.' });
      } else {
        setStatusMessage({ type: 'success', text: 'Password changed successfully.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network communication error.' });
    } finally {
      setPwdLoading(false);
    }
  };

  const handleStart2FASetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/settings/security/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: setupPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusMessage({ type: 'error', text: data.error || 'Failed to start 2FA setup.' });
      } else {
        setTotpSetupData(data);
        setSetupPassword('');
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network communication error.' });
    } finally {
      setSetupLoading(false);
    }
  };

  const handleConfirm2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpSetupData) return;

    setSetupLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/settings/security/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: totpSetupData.secret,
          code: verifyCode.trim(),
          hashedRecoveryCodes: totpSetupData.hashedRecoveryCodes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusMessage({ type: 'error', text: data.error || 'Verification code failed.' });
      } else {
        setStatusMessage({ type: 'success', text: 'Two-factor authentication enabled successfully!' });
        setTotpSetupData(null);
        setVerifyCode('');
        fetchProfile();
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network communication error.' });
    } finally {
      setSetupLoading(false);
    }
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/settings/security/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusMessage({ type: 'error', text: data.error || 'Failed to disable 2FA.' });
      } else {
        setStatusMessage({ type: 'success', text: 'Two-factor authentication disabled.' });
        setShowDisableModal(false);
        setDisablePassword('');
        fetchProfile();
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network communication error.' });
    } finally {
      setSetupLoading(false);
    }
  };

  const handleRotateKioskPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setKioskLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/settings/security/kiosk-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: kioskDoctorPwd,
          newPin: newKioskPin.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusMessage({ type: 'error', text: data.error || 'Failed to update PIN.' });
      } else {
        setStatusMessage({ type: 'success', text: 'Kiosk PIN rotated and active sessions revoked.' });
        setKioskDoctorPwd('');
        setNewKioskPin('');
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network communication error.' });
    } finally {
      setKioskLoading(false);
    }
  };

  const handleSignOutAll = async () => {
    if (!confirm('This will sign out all active sessions across all devices. Proceed?')) {
      return;
    }

    try {
      await fetch('/api/settings/security/signout-all', { method: 'POST' });
      router.push('/login');
    } catch {
      setStatusMessage({ type: 'error', text: 'Failed to sign out all devices.' });
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen p-8 bg-[#f8fafc] flex items-center justify-center">
        <div className="text-sm text-[#475569]">Loading security preferences...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] p-6 lg:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="border-b border-[#cbd5e1] pb-5">
          <div className="text-xs font-semibold tracking-wider uppercase text-[#0a1a3f] mb-1">
            System Administration
          </div>
          <h1 className="text-2xl font-bold text-[#151a22]">
            Security &amp; Device Access Control
          </h1>
          <p className="text-sm text-[#475569] mt-1">
            Manage your doctor credentials, multi-factor authentication, and clinic kiosk authorization.
          </p>
        </header>

        {statusMessage && (
          <div
            role="alert"
            className={`p-4 rounded border-l-4 text-sm ${
              statusMessage.type === 'success'
                ? 'bg-[#f0fdf4] border-[#15803d] text-[#166534]'
                : 'bg-[#fef2f2] border-[#b91c1c] text-[#991b1b]'
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        {/* Section 1: Doctor Password */}
        <section aria-labelledby="heading-password" className="bg-white border border-[#cbd5e1] rounded-lg p-6 shadow-sm">
          <h2 id="heading-password" className="text-lg font-bold text-[#151a22] mb-1">
            Doctor Login Password
          </h2>
          <p className="text-xs text-[#475569] mb-5">
            Passwords must be at least 12 characters. Changing your password immediately revokes all existing sessions.
          </p>

          <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md" noValidate>
            <div>
              <label htmlFor="currentPassword" className="block text-xs font-semibold text-[#151a22] mb-1">
                Current Password
              </label>
              <input
                id="currentPassword"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#cbd5e1] rounded text-sm text-[#151a22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-xs font-semibold text-[#151a22] mb-1">
                New Password (minimum 12 characters)
              </label>
              <input
                id="newPassword"
                type="password"
                required
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#cbd5e1] rounded text-sm text-[#151a22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
              />
              <div className="text-[11px] text-[#475569] mt-1">
                Length: {newPassword.length} / 12 characters minimum
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-semibold text-[#151a22] mb-1">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#cbd5e1] rounded text-sm text-[#151a22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
              />
            </div>

            <button
              type="submit"
              disabled={pwdLoading}
              className="bg-[#0a1a3f] hover:bg-[#12285a] text-white font-medium text-xs rounded px-4 py-2.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {pwdLoading ? 'Updating Password...' : 'Change Password'}
            </button>
          </form>
        </section>

        {/* Section 2: Two-Factor Authentication */}
        <section aria-labelledby="heading-2fa" className="bg-white border border-[#cbd5e1] rounded-lg p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <h2 id="heading-2fa" className="text-lg font-bold text-[#151a22]">
                Two-Factor Authentication (TOTP)
              </h2>
              <p className="text-xs text-[#475569] mt-0.5">
                Secures your account using Google Authenticator or any RFC 6238 TOTP authenticator.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded ${
                  profile?.totpEnabled
                    ? 'bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0]'
                    : 'bg-[#f1f5f9] text-[#334155] border border-[#cbd5e1]'
                }`}
              >
                {profile?.totpEnabled ? 'Active / Protected' : 'Not Configured'}
              </span>
            </div>
          </div>

          {!profile?.totpEnabled && !totpSetupData && (
            <form onSubmit={handleStart2FASetup} className="space-y-4 max-w-md pt-2" noValidate>
              <div>
                <label htmlFor="setupPassword" className="block text-xs font-semibold text-[#151a22] mb-1">
                  Enter Password to Begin 2FA Setup
                </label>
                <input
                  id="setupPassword"
                  type="password"
                  required
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#cbd5e1] rounded text-sm text-[#151a22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
                  placeholder="Verify password"
                />
              </div>
              <button
                type="submit"
                disabled={setupLoading || !setupPassword}
                className="bg-[#0a1a3f] hover:bg-[#12285a] text-white font-medium text-xs rounded px-4 py-2.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {setupLoading ? 'Preparing...' : 'Set Up Two-Factor Authentication'}
              </button>
            </form>
          )}

          {/* 2FA Setup Wizard Active */}
          {totpSetupData && (
            <div className="mt-4 p-5 bg-[#f8fafc] border border-[#cbd5e1] rounded space-y-6">
              <div>
                <h3 className="text-sm font-bold text-[#151a22]">
                  Step 1: Scan QR Code with Authenticator App
                </h3>
                <p className="text-xs text-[#475569] mt-0.5">
                  Open your authenticator app and scan this barcode, or enter the secret manually.
                </p>
                <div className="mt-3 flex flex-col sm:flex-row items-center gap-4 bg-white p-4 border border-[#e2e8f0] rounded max-w-md">
                  <Image
                    src={totpSetupData.qrCodeDataUrl}
                    alt="2FA QR Code"
                    width={160}
                    height={160}
                    className="border border-[#e2e8f0]"
                    unoptimized
                  />
                  <div className="text-xs space-y-1">
                    <div className="font-semibold text-[#151a22]">Manual Secret Key:</div>
                    <code className="block bg-[#f1f5f9] p-2 rounded text-[11px] font-mono break-all text-[#0a1a3f]">
                      {totpSetupData.secret}
                    </code>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-[#151a22]">
                  Step 2: Save Emergency Recovery Codes
                </h3>
                <p className="text-xs text-[#475569] mt-0.5">
                  If you lose access to your authenticator, each code can be used exactly once. Store them securely.
                </p>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 bg-white p-3 border border-[#e2e8f0] rounded max-w-xl font-mono text-xs text-center">
                  {totpSetupData.recoveryCodes.map((code, idx) => (
                    <span key={idx} className="bg-[#f8fafc] p-1.5 border border-[#e2e8f0] rounded">
                      {code}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-[#151a22]">
                  Step 3: Verify Authenticator Code
                </h3>
                <form onSubmit={handleConfirm2FA} className="mt-2 flex flex-col sm:flex-row gap-2 max-w-md" noValidate>
                  <label htmlFor="verifyCode" className="sr-only">
                    6-digit verification code
                  </label>
                  <input
                    id="verifyCode"
                    type="text"
                    required
                    placeholder="123456"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    className="flex-1 px-3 py-2 bg-white border border-[#cbd5e1] rounded text-sm font-mono tracking-widest text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
                  />
                  <button
                    type="submit"
                    disabled={setupLoading || !verifyCode.trim()}
                    className="bg-[#15803d] hover:bg-[#166534] text-white font-medium text-xs rounded px-4 py-2.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {setupLoading ? 'Activating...' : 'Verify & Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTotpSetupData(null)}
                    className="bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#151a22] text-xs rounded px-3 py-2.5"
                  >
                    Cancel
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* 2FA Enabled - Option to Disable */}
          {profile?.totpEnabled && !showDisableModal && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowDisableModal(true)}
                className="text-xs text-[#b91c1c] hover:underline font-medium cursor-pointer"
              >
                Disable Two-Factor Authentication
              </button>
            </div>
          )}

          {showDisableModal && (
            <form onSubmit={handleDisable2FA} className="mt-4 p-4 bg-[#fef2f2] border border-[#fca5a5] rounded space-y-3 max-w-md" noValidate>
              <label htmlFor="disablePassword" className="block text-xs font-semibold text-[#991b1b]">
                Enter password to disable two-factor authentication:
              </label>
              <input
                id="disablePassword"
                type="password"
                required
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#cbd5e1] rounded text-sm text-[#151a22]"
                placeholder="Doctor password"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={setupLoading || !disablePassword}
                  className="bg-[#b91c1c] hover:bg-[#991b1b] text-white font-medium text-xs rounded px-3 py-2 cursor-pointer disabled:opacity-50"
                >
                  Confirm Disable
                </button>
                <button
                  type="button"
                  onClick={() => setShowDisableModal(false)}
                  className="bg-white border border-[#cbd5e1] text-[#151a22] text-xs rounded px-3 py-2"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Section 3: Kiosk PIN Rotation */}
        <section aria-labelledby="heading-kiosk" className="bg-white border border-[#cbd5e1] rounded-lg p-6 shadow-sm">
          <h2 id="heading-kiosk" className="text-lg font-bold text-[#151a22] mb-1">
            Kiosk Device PIN Rotation
          </h2>
          <p className="text-xs text-[#475569] mb-5">
            The kiosk PIN unlocks the tablet intake screen. Rotating the PIN immediately invalidates all active device sessions.
          </p>

          <form onSubmit={handleRotateKioskPin} className="space-y-4 max-w-md" noValidate>
            <div>
              <label htmlFor="kioskDoctorPwd" className="block text-xs font-semibold text-[#151a22] mb-1">
                Doctor Password Confirmation
              </label>
              <input
                id="kioskDoctorPwd"
                type="password"
                required
                value={kioskDoctorPwd}
                onChange={(e) => setKioskDoctorPwd(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#cbd5e1] rounded text-sm text-[#151a22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
              />
            </div>

            <div>
              <label htmlFor="newKioskPin" className="block text-xs font-semibold text-[#151a22] mb-1">
                New Kiosk PIN (4 to 10 digits)
              </label>
              <input
                id="newKioskPin"
                type="password"
                inputMode="numeric"
                required
                minLength={4}
                maxLength={10}
                value={newKioskPin}
                onChange={(e) => setNewKioskPin(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#cbd5e1] rounded text-sm text-[#151a22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a1a3f]"
                placeholder="e.g. 5821"
              />
            </div>

            <button
              type="submit"
              disabled={kioskLoading}
              className="bg-[#0a1a3f] hover:bg-[#12285a] text-white font-medium text-xs rounded px-4 py-2.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {kioskLoading ? 'Rotating PIN...' : 'Rotate Kiosk PIN'}
            </button>
          </form>
        </section>

        {/* Section 4: Device Sessions */}
        <section aria-labelledby="heading-sessions" className="bg-white border border-[#cbd5e1] rounded-lg p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 id="heading-sessions" className="text-lg font-bold text-[#151a22]">
                Active Doctor Sessions
              </h2>
              <p className="text-xs text-[#475569] mt-0.5">
                Revoke all active device logins if you suspect unapproved access.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOutAll}
              className="bg-[#b91c1c] hover:bg-[#991b1b] text-white font-medium text-xs rounded px-4 py-2.5 transition-colors cursor-pointer"
            >
              Sign Out Everywhere
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
