'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

type Step = 'email' | 'password' | 'otp-sent' | 'set-password';

export default function LoginPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [displayName, setDisplayName] = useState('');

  const apiCall = async (action: string, extra: Record<string, string> = {}) => {
    const res = await fetch('/api/auth/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, email, ...extra }),
    });
    return res.json();
  };

  // Step 1: Check email
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');

    try {
      const data = await apiCall('check');

      if (!data.authorized) {
        setError(data.error || 'Not authorized');
        setLoading(false);
        return;
      }

      setDisplayName(data.displayName || email.split('@')[0]);

      if (data.hasPassword) {
        // User has a password — show password field
        setStep('password');
      } else {
        // No password yet — send OTP
        const otpResult = await apiCall('send');
        setMessage(otpResult.message || 'Code sent');
        setStep('otp-sent');
      }
    } catch {
      setError('Connection error. Try again.');
    }
    setLoading(false);
  };

  // Step 2a: Login with password
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      mode: 'password',
      redirect: false,
    });

    if (result?.error) {
      setError('Wrong password');
      setLoading(false);
    } else {
      window.location.href = '/dashboard';
    }
  };

  // Step 2b: Verify OTP
  const handleOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) return;
    setLoading(true);
    setError('');

    try {
      const data = await apiCall('verify', { code: otp });
      if (data.success) {
        setStep('set-password');
      } else {
        setError(data.error || 'Invalid code');
      }
    } catch {
      setError('Verification failed');
    }
    setLoading(false);
  };

  // Step 3: Set password after OTP verification
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('Minimum 6 characters');
      return;
    }
    setLoading(true);
    setError('');

    try {
      await apiCall('set-password', { password: newPassword });

      // Now sign in with OTP mode (already verified)
      // Re-send OTP for the sign-in since we consumed it during verify
      const otpResult = await apiCall('send');
      // Wait briefly for OTP to be stored
      await new Promise(r => setTimeout(r, 500));

      // Actually, let's sign in with the new password directly
      const result = await signIn('credentials', {
        email,
        password: newPassword,
        mode: 'password',
        redirect: false,
      });

      if (result?.error) {
        setError('Login failed after setting password');
        setLoading(false);
      } else {
        window.location.href = '/dashboard';
      }
    } catch {
      setError('Failed to set password');
      setLoading(false);
    }
  };

  // Forgot password — send new OTP
  const handleForgotPassword = async () => {
    setLoading(true);
    setError('');
    const data = await apiCall('send');
    setMessage(data.message || 'Code sent');
    setOtp('');
    setStep('otp-sent');
    setLoading(false);
  };

  // Go back to email
  const handleBack = () => {
    setStep('email');
    setError('');
    setMessage('');
    setOtp('');
    setPassword('');
    setNewPassword('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-sm px-6">
        {/* Logo */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">G-STAR</h1>
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-[0.3em] mt-1">
            AI Studio
          </p>
        </div>

        {/* ── Step: Email ── */}
        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@g-star.com"
                className="w-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:border-neutral-900"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-neutral-900 text-white px-6 py-3 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
            >
              {loading ? 'Checking...' : 'Continue'}
            </button>

            <p className="text-xs text-center text-neutral-400">
              Authorized for @g-star.com, @gstar-raw.com, @fiberandface.com and whitelisted accounts
            </p>
          </form>
        )}

        {/* ── Step: Password ── */}
        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <p className="text-sm text-neutral-600">
              Welcome back, <span className="font-medium text-neutral-900">{displayName}</span>
            </p>

            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:border-neutral-900"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-neutral-900 text-white px-6 py-3 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>

            <div className="flex justify-between">
              <button type="button" onClick={handleBack} className="text-xs text-neutral-400 hover:text-neutral-600">
                Use different email
              </button>
              <button type="button" onClick={handleForgotPassword} className="text-xs text-neutral-400 hover:text-neutral-600">
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {/* ── Step: OTP Sent ── */}
        {step === 'otp-sent' && (
          <form onSubmit={handleOTPSubmit} className="space-y-4">
            <p className="text-sm text-neutral-600">
              We sent a 6-digit code to <span className="font-medium text-neutral-900">{email}</span>
            </p>

            <div>
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full border border-neutral-300 px-4 py-3 text-2xl text-center tracking-[0.5em] font-mono focus:outline-none focus:border-neutral-900"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-neutral-900 text-white px-6 py-3 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>

            <div className="flex justify-between">
              <button type="button" onClick={handleBack} className="text-xs text-neutral-400 hover:text-neutral-600">
                Use different email
              </button>
              <p className="text-xs text-neutral-400">Code expires in 5 min</p>
            </div>
          </form>
        )}

        {/* ── Step: Set Password ── */}
        {step === 'set-password' && (
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div className="text-center mb-2">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-neutral-600">Email verified. Now set your password.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Choose a password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min. 6 characters"
                className="w-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:border-neutral-900"
                autoFocus
                minLength={6}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || newPassword.length < 6}
              className="w-full bg-neutral-900 text-white px-6 py-3 text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-30"
            >
              {loading ? 'Setting up...' : 'Set password & sign in'}
            </button>
          </form>
        )}

        {/* Messages */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 text-center">
            {error}
          </div>
        )}
        {message && !error && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 text-sm text-blue-700 text-center">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
