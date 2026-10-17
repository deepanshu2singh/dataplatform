import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeControl } from '../components/ThemeControl';
import { api } from '../lib/api';
import { getApiErrorInfo } from '../lib/apiError';
import { isCanceledRequest, useLatestRequest } from '../hooks/useLatestRequest';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChanges';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const requests = useLatestRequest();
  const remaining = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const length = Array.from(password).length;
  const validPassword = length >= 8 && length <= 128 && !/[\p{Cs}]/u.test(password);
  useUnsavedChangesGuard(busy || Boolean(code || password || confirmation), 'You have unfinished password recovery fields. Leave without resetting your password?');

  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => {
      const time = Date.now(); setNow(time);
      if (time >= retryUntil) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || remaining > 0) return;
    const request = requests.begin();
    setBusy(true); setError(''); setMessage('');
    try {
      await api.post('/auth/password-recovery/request', { email: email.trim().toLowerCase() }, { signal: request.signal });
      if (!request.isCurrent()) return;
      setStep('code'); setCode('');
      setNow(Date.now()); setRetryUntil(Date.now() + 60_000);
      setMessage('If an active account uses this address, check its inbox and spam folder for a reset code. Sending limits may delay it.');
    } catch (reason) {
      if (request.isCurrent() && !isCanceledRequest(reason)) {
        const info = getApiErrorInfo(reason, 'We could not confirm your request. Check your inbox before trying again.');
        const uncertain = info.kind === 'network' || info.kind === 'timeout' || (info.status !== undefined && info.status >= 500);
        setError(uncertain ? 'We could not confirm delivery. Check your inbox; if a code arrives, you can use it here.' : info.message);
        // Invalid input stays editable. An uncertain send may still arrive;
        // preserve a route to entering that code without sending another one.
        if (uncertain && step === 'email') setStep('code');
        if (uncertain || info.status === 429) {
          setNow(Date.now()); setRetryUntil(Date.now() + 60_000);
        }
      }
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  };
  const reset = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || code.length !== 8 || !validPassword || password !== confirmation) return;
    const request = requests.begin();
    setBusy(true); setError(''); setMessage('');
    try {
      await api.post('/auth/password-recovery/confirm', { email: email.trim().toLowerCase(), code, new_password: password }, { signal: request.signal });
      if (!request.isCurrent()) return;
      setCode(''); setPassword(''); setConfirmation(''); setStep('done');
    } catch (reason) {
      if (request.isCurrent() && !isCanceledRequest(reason)) {
        const fallback = 'We could not confirm the reset. It may have completed. Try signing in with your new password before requesting another code.';
        const info = getApiErrorInfo(reason, fallback);
        setError(info.kind === 'network' || info.kind === 'timeout' ? fallback : info.message);
        setCode('');
      }
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  };
  const inputClass = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60';
  const passwordFields = [
    { id: 'recovery-new', label: 'New password', value: password, change: setPassword },
    { id: 'recovery-confirm', label: 'Confirm new password', value: confirmation, change: setConfirmation },
  ];
  return <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4 py-16">
    <div className="absolute right-4 top-4"><ThemeControl /></div>
    <section className="workspace-panel max-w-md w-full space-y-6 p-6 sm:p-8" aria-labelledby="recovery-heading">
      <div className="brand-auth"><BrandLogo centered /></div>
      <div><h1 id="recovery-heading" className="text-center text-3xl font-bold text-gray-900 dark:text-white">{step === 'done' ? 'Password reset' : 'Forgot your password?'}</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{step === 'done' ? 'Your next sign-in uses your new password.' : 'Request a code by email, then choose a new password. Your saved work stays in your account.'}</p></div>
      {step === 'done' ? <p role="status" className="text-sm text-green-800 dark:text-green-200">Your password was reset and existing sign-ins were ended. Sign in with your new password. Your email verification status is unchanged.</p> : <>
        {message && <p role="status" className="text-sm text-gray-700 dark:text-gray-200">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {step === 'email' ? <form onSubmit={(event) => void send(event)} className="space-y-4" aria-busy={busy}>
          <label htmlFor="recovery-email" className="block text-sm font-medium text-gray-900 dark:text-white">Account email address</label>
          <input id="recovery-email" name="email" type="email" autoComplete="email" required maxLength={255} value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
          <button type="submit" disabled={busy || remaining > 0} className="primary-action w-full justify-center">{busy ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}{busy ? 'Requesting code…' : remaining > 0 ? `Try again in ${remaining}s` : 'Send reset code'}</button>
        </form> : <>
          <p className="break-words text-sm text-gray-700 dark:text-gray-200">Recovering: <strong>{email.trim().toLowerCase()}</strong></p>
          <form onSubmit={(event) => void reset(event)} className="space-y-4" aria-busy={busy}>
            <div><label htmlFor="recovery-code" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Eight-digit reset code</label>
              <input id="recovery-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{8}" maxLength={8} value={code} disabled={busy} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 8))} className={inputClass} aria-describedby="recovery-code-help" />
              <p id="recovery-code-help" className="mt-2 text-sm text-gray-600 dark:text-gray-300">Use the newest code received. It expires after 10 minutes and works once.</p></div>
            {passwordFields.map(({ id, label, value, change }) => <div key={id}>
              <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{label}</label>
              <input id={id} name={id} type={visible ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} autoCapitalize="none" required maxLength={256} disabled={busy} value={value} onChange={(event) => change(event.target.value)} className={inputClass} />
            </div>)}
            <button type="button" disabled={busy} aria-pressed={visible} onClick={() => setVisible(!visible)} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">{visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{visible ? 'Hide passwords' : 'Show passwords'}</button>
            <p className="text-sm text-gray-600 dark:text-gray-300">Use 8 to 128 characters. Spaces and password managers are welcome. Resetting signs out existing sessions.</p>
            {password && !validPassword && <p className="text-sm text-red-700 dark:text-red-300">Use 8 to 128 valid characters.</p>}
            {confirmation && password !== confirmation && <p className="text-sm text-red-700 dark:text-red-300">The new passwords do not match.</p>}
            <button type="submit" disabled={busy || code.length !== 8 || !validPassword || password !== confirmation} className="primary-action w-full justify-center">{busy ? 'Please wait…' : 'Reset password and sign out'}</button>
          </form>
          <div className="flex flex-wrap gap-4 text-sm text-gray-700 dark:text-gray-200">
            <button type="button" disabled={busy || remaining > 0} onClick={() => void send()} className="underline disabled:opacity-60">{remaining > 0 ? `Request another code in ${remaining}s` : 'Send another reset code'}</button>
            <button type="button" disabled={busy} onClick={() => { setStep('email'); setRetryUntil(0); setCode(''); setPassword(''); setConfirmation(''); setError(''); setMessage(''); }} className="underline">Use another email</button>
          </div>
        </>}
      </>}
      <Link to="/login" className="block text-center text-sm text-blue-700 dark:text-blue-300 underline">Back to sign in</Link>
    </section>
  </main>;
}
