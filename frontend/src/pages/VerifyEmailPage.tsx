import { PrivacyLink } from '../components/PrivacyLink';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeControl } from '../components/ThemeControl';
import { useAuth } from '../contexts/AuthContext';
import { useLatestRequest, isCanceledRequest } from '../hooks/useLatestRequest';
import { api } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';

export function VerifyEmailPage() {
  const { user, verifyEmail, logout, refreshUser } = useAuth();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const sendRequest = useLatestRequest();

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  const sendCode = async () => {
    const request = sendRequest.begin();
    setBusy(true); setError(''); setMessage(''); setCode('');
    try {
      const response = await api.post('/auth/email-verification/send', {}, { signal: request.signal });
      if (request.isCurrent()) {
        if (response.data.status === 'already_verified') {
          await refreshUser();
        } else {
          setRemaining(response.data.retry_after_seconds ?? 60);
          setMessage('Email requested. Check your inbox and spam folder for an eight-digit code. It expires in 10 minutes.');
        }
      }
    } catch (reason) {
      if (request.isCurrent() && !isCanceledRequest(reason)) {
        if (axios.isAxiosError(reason) && reason.response?.status === 429) {
          const retryAfter = Number(reason.response.headers?.['retry-after']);
          setRemaining(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) : 60);
        }
        setError(getApiErrorMessage(reason, 'We could not confirm email delivery. Check your inbox; if no code arrives, try again in a minute.'));
      }
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  };

  const confirmCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await verifyEmail(code);
    } catch (reason) {
      if (!isCanceledRequest(reason)) setError(getApiErrorMessage(reason, 'We could not verify that code. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true); setError('');
    try { await logout(); }
    catch (reason) { setError(getApiErrorMessage(reason, 'We could not sign you out. Please try again.')); }
    finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4 py-12">
      <div className="absolute right-4 top-4"><ThemeControl /></div>
      <section className="workspace-panel max-w-md w-full space-y-6 p-6 sm:p-8" aria-labelledby="verification-heading">
        <div className="brand-auth"><BrandLogo centered /></div>
        <h1 id="verification-heading" className="text-center text-3xl font-bold text-gray-900 dark:text-white">Verify your email</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 break-words">
          Confirm access to <strong>{user?.email}</strong> before opening your workspace. Your saved work stays in your account.
        </p>
        {message && <p role="status" className="text-sm text-gray-700 dark:text-gray-200">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <button type="button" onClick={() => void sendCode()} disabled={busy || remaining > 0}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-gray-900 dark:text-white disabled:opacity-50">
          {remaining > 0 ? `Request another code in ${remaining}s` : 'Send verification code'}
        </button>
        <form onSubmit={(event) => void confirmCode(event)} className="space-y-4" aria-busy={busy}>
          <label htmlFor="verification-code" className="block text-sm font-medium text-gray-900 dark:text-white">Eight-digit code</label>
          <input id="verification-code" name="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code"
            required pattern="[0-9]{8}" maxLength={8} value={code} disabled={busy}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
            aria-describedby="verification-help"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-lg tracking-widest text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p id="verification-help" className="text-sm text-gray-600 dark:text-gray-300">Use the most recently requested code. Keep this page open while checking your email.</p>
          <button type="submit" disabled={busy || code.length !== 8}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Please wait…' : 'Verify email'}
          </button>
        </form>
        <button type="button" disabled={busy} onClick={() => void signOut()} className="w-full text-sm text-gray-600 dark:text-gray-300 underline">Sign out / use another account</button>
        <p className="text-center text-gray-600 dark:text-gray-300"><PrivacyLink /></p>
      </section>
    </main>
  );
}
