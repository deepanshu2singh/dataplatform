import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type SecurityAction } from '../contexts/AuthContext';
import { useLatestRequest, isCanceledRequest } from '../hooks/useLatestRequest';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChanges';
import { getApiErrorInfo } from '../lib/apiError';

function PasswordField({ id, label, value, onChange, disabled, autoComplete }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  disabled: boolean; autoComplete: 'current-password' | 'new-password';
}) {
  const [visible, setVisible] = useState(false);
  return <div className="settings-field"><label htmlFor={id}>{label}</label>
    <div className="settings-password-input"><input id={id} name={id} type={visible ? 'text' : 'password'}
      autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)}
      disabled={disabled} required maxLength={256} spellCheck={false} autoCapitalize="none" />
      <button type="button" className="settings-password-toggle" disabled={disabled}
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible}
        onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
    </div></div>;
}

export function AccountSecurity({ profileBlocked, onBusyChange }: { profileBlocked: boolean; onBusyChange: (busy: boolean) => void }) {
  const { secureAccount } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [revokePassword, setRevokePassword] = useState('');
  const [busy, setBusy] = useState<SecurityAction | null>(null);
  const [error, setError] = useState('');
  const requestState = useLatestRequest();
  const dirty = Boolean(current || next || confirm || revokePassword);
  const { allowNextNavigation } = useUnsavedChangesGuard(dirty || Boolean(busy), 'You have unsaved security changes. Leave without saving?');
  const length = Array.from(next).length;
  const validText = (value: string) => Array.from(value).length <= 128 && !/[\p{Cs}]/u.test(value);
  const validChange = current.length > 0 && length >= 8 && validText(current) && validText(next) && next === confirm && next !== current;
  const validRevoke = revokePassword.length > 0 && validText(revokePassword);
  const disabled = Boolean(busy) || profileBlocked;

  const submit = async (event: FormEvent, action: SecurityAction) => {
    event.preventDefault();
    if (disabled || (action === 'password' ? !validChange : !validRevoke)) return;
    const request = requestState.begin();
    setBusy(action); onBusyChange(true); setError('');
    try {
      await secureAccount(action, action === 'password' ? current : revokePassword,
        action === 'password' ? next : undefined, () => {
          setCurrent(''); setNext(''); setConfirm(''); setRevokePassword('');
          allowNextNavigation();
          navigate('/login', { replace: true });
        });
    } catch (reason) {
      if (request.isCurrent() && !isCanceledRequest(reason)) {
        setCurrent(''); setRevokePassword('');
        const fallback = 'We could not confirm this security change. The request may have completed. Sign out of this browser, then sign in again to check your password.';
        const info = getApiErrorInfo(reason, fallback);
        setError(info.kind === 'network' || info.kind === 'timeout' ? fallback : info.message);
      }
    } finally {
      if (request.isCurrent()) { setBusy(null); onBusyChange(false); }
      request.finish();
    }
  };
  const clearDraft = () => { setCurrent(''); setNext(''); setConfirm(''); setRevokePassword(''); setError(''); };
  return <div className="settings-security">
    <div className="settings-section-heading"><h2>Account security</h2><p>Protect your password and control access to your workspace.</p></div>
    {profileBlocked && <p role="status" className="settings-feedback">Save or discard your profile changes before using these sign-out controls.</p>}
    <form aria-label="Change password" onSubmit={(event) => void submit(event, 'password')} aria-busy={busy === 'password'}>
      <div className="settings-security-title"><KeyRound size={19} aria-hidden="true" /><div><h3>Change password</h3><p>Choose a unique password of 8 to 128 characters. Spaces and password managers are welcome.</p></div></div>
      <div className="settings-fields">
        <PasswordField id="security-current" label="Current password" value={current} onChange={setCurrent} disabled={disabled} autoComplete="current-password" />
        <PasswordField id="security-new" label="New password" value={next} onChange={setNext} disabled={disabled} autoComplete="new-password" />
        <PasswordField id="security-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} disabled={disabled} autoComplete="new-password" />
      </div>
      {next && (length < 8 || !validText(next)) && <p className="settings-field-help is-invalid">Use 8 to 128 characters.</p>}
      {confirm && confirm !== next && <p className="settings-field-help is-invalid">The new passwords do not match.</p>}
      {next && next === current && <p className="settings-field-help is-invalid">Choose a different password.</p>}
      <p className="settings-security-note">Changing your password signs you out everywhere, including this browser. Sign in again with your new password.</p>
      <button className="primary-action" disabled={disabled || !validChange} type="submit">{busy === 'password' ? <LoaderCircle className="settings-spinner" size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}{busy === 'password' ? 'Changing password…' : 'Change password and sign out'}</button>
    </form>
    <form aria-label="Sign out everywhere" onSubmit={(event) => void submit(event, 'revoke')} aria-busy={busy === 'revoke'}>
      <div className="settings-security-title"><LogOut size={19} aria-hidden="true" /><div><h3>Sign out everywhere</h3><p>End access from existing sign-ins without changing your password.</p></div></div>
      <div className="settings-fields"><PasswordField id="security-revoke" label="Confirm your password" value={revokePassword} onChange={setRevokePassword} disabled={disabled} autoComplete="current-password" /></div>
      <p className="settings-security-note">This includes this browser. Other sessions must sign in again on their next protected request. Already-running requests may finish. Your saved work stays in your account.</p>
      <button className="settings-secondary" disabled={disabled || !validRevoke} type="submit">{busy === 'revoke' ? 'Signing out…' : 'Sign out everywhere'}</button>
    </form>
    {error && <p role="alert" className="settings-feedback is-error">{error}</p>}
    <div className="settings-security-footer"><p><ShieldCheck size={15} aria-hidden="true" />Both controls require your current password. These controls and Data export confirmations share five password attempts per 15 minutes.</p>
      <button type="button" className="settings-secondary" disabled={!dirty || Boolean(busy)} onClick={clearDraft}>Clear password fields</button></div>
    <div className="settings-unavailable"><ShieldCheck size={18} aria-hidden="true" /><div><h3>Additional protection</h3><p>Forgotten-password recovery is available from the sign-in screen when you are signed out. A device list and two-factor authentication are not available yet. Email verification confirms inbox access; it is not two-factor authentication.</p></div></div>
  </div>;
}
