import { ThemeStorageControl } from '../components/ThemeStorageControl';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Bell, Check, CheckCircle2, Database, Info, Laptop, LoaderCircle, Mail, Moon, Shield, Sun, SunMoon, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme, type ThemePreference } from '../contexts/theme';
import { getApiErrorMessage } from '../lib/apiError';
import { isCanceledRequest, useLatestRequest } from '../hooks/useLatestRequest';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChanges';
import { AccountSecurity } from '../components/AccountSecurity';
import { AccountData } from '../components/AccountData';
import './SettingsPage.css';

type SettingsTab = 'profile' | 'appearance' | 'security' | 'notifications' | 'data';
const tabs = [
  { id: 'profile' as const, label: 'Profile', icon: User },
  { id: 'appearance' as const, label: 'Appearance', icon: SunMoon },
  { id: 'security' as const, label: 'Security', icon: Shield },
  { id: 'notifications' as const, label: 'Notifications', icon: Bell },
  { id: 'data' as const, label: 'Data', icon: Database },
];
const appearances: { value: ThemePreference; label: string; description: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', description: 'Warm surfaces, clear detail.', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'A quieter canvas after hours.', icon: Moon },
  { value: 'system', label: 'System', description: 'Follow your device setting.', icon: Laptop },
];
function UnavailableCard({ title, description }: { title: string; description: string }) {
  return <div className="settings-unavailable"><Info size={18} aria-hidden="true" /><div><h3>{title}</h3><p>{description}</p></div></div>;
}

export function SettingsPage() {
  const { user, updateProfile } = useAuth();
  const { preference, resolvedTheme, setPreference } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const storedName = user?.full_name ?? null;
  const [profile, setProfile] = useState({ name: storedName ?? '', originalName: storedName });
  const [busy, setBusy] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const saveRequest = useLatestRequest();
  const normalizedName = profile.name.trim() || null;
  const dirty = normalizedName !== profile.originalName;
  const nameLength = Array.from(profile.name).length;
  const invalidName = nameLength > 255 || /[\p{Cc}\p{Cs}]/u.test(profile.name);
  useUnsavedChangesGuard(dirty || busy, 'You have unsaved profile changes. Leave without saving?');
  // Adjust only a clean form when shared account state changes. An edited draft
  // keeps its original snapshot so the backend can detect a conflicting save.
  if (!dirty && !busy && storedName !== profile.originalName) {
    setProfile({ name: storedName ?? '', originalName: storedName });
  }

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || busy || invalidName) return;
    const request = saveRequest.begin();
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await updateProfile(normalizedName, profile.originalName);
      if (request.isCurrent()) {
        setProfile({ name: saved.full_name ?? '', originalName: saved.full_name });
        setMessage('Your profile has been saved.');
      }
    } catch (reason) {
      if (request.isCurrent() && !isCanceledRequest(reason)) {
        setError(getApiErrorMessage(reason, 'We could not save your profile. Your edits are kept; please try again.'));
      }
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (securityBusy || dataBusy) return;
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex];
    setActiveTab(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };

  const initial = Array.from(user?.full_name?.trim() || user?.email || 'U')[0]?.toUpperCase();
  return <div className="settings-page workspace-enter">
    <header className="settings-heading">
      <div><p className="eyebrow">Personal workspace</p><h1>Settings</h1><p>Make this space feel like yours.</p></div>
      {dirty && <span className="settings-draft">Unsaved name</span>}
    </header>
    <section className="settings-account workspace-panel" aria-label="Account overview">
      <div className="settings-avatar" aria-hidden="true">{initial}</div>
      <div className="settings-account-copy"><h2>{user?.full_name || 'Your account'}</h2><p>{user?.email}</p></div>
      <span className={`settings-verification ${user?.email_verified ? 'is-verified' : ''}`}>
        {user?.email_verified ? <CheckCircle2 size={15} aria-hidden="true" /> : <Mail size={15} aria-hidden="true" />}
        {user?.email_verified ? 'Email verified' : 'Email not verified'}
      </span>
    </section>
    <section className="settings-content workspace-panel" aria-label="Account settings">
      <nav role="tablist" aria-label="Settings sections" className="settings-tabs">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          return <button key={tab.id} id={`settings-tab-${tab.id}`} type="button" role="tab"
            aria-selected={activeTab === tab.id} aria-controls={`settings-panel-${tab.id}`}
            disabled={securityBusy || dataBusy} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}>
            <Icon size={16} aria-hidden="true" />{tab.label}
          </button>;
        })}
      </nav>
      <div id={`settings-panel-${activeTab}`} role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`} tabIndex={0} className="settings-panel">
        {activeTab === 'profile' && <>
          <div className="settings-section-heading"><h2>Personal details</h2><p>Your name appears across your workspace.</p></div>
          <form onSubmit={(event) => void saveProfile(event)} aria-busy={busy}>
            <div className="settings-fields">
              <div className="settings-field"><label htmlFor="settings-full-name">Full name <span>Optional</span></label>
                <input id="settings-full-name" name="full_name" autoComplete="name" value={profile.name} maxLength={510}
                  disabled={busy} aria-invalid={invalidName} aria-describedby="settings-name-help"
                  onChange={(event) => { setProfile((current) => ({ ...current, name: event.target.value })); setError(''); setMessage(''); }} />
                <div id="settings-name-help" className={`settings-field-help ${invalidName ? 'is-invalid' : ''}`}>
                  <span>{invalidName ? 'Use a single-line name of up to 255 characters.' : 'Use the name you would like to see in your account.'}</span><span>{nameLength}/255</span>
                </div>
              </div>
              <div className="settings-field"><label htmlFor="settings-email">Email address</label>
                <div className="settings-email-input"><Mail size={17} aria-hidden="true" /><input id="settings-email" type="email" value={user?.email ?? ''} readOnly aria-describedby="settings-email-help" /></div>
                <p id="settings-email-help" className="settings-field-help">Your sign-in email. Email address changes are not available here yet.</p>
              </div>
            </div>
            {error && <p role="alert" className="settings-feedback is-error">{error}</p>}
            {message && <p role="status" className="settings-feedback is-success"><Check size={16} aria-hidden="true" />{message}</p>}
            <div className="settings-form-footer"><p>{busy ? 'Saving your name…' : dirty ? 'Your changes are ready to save.' : 'Your saved details are up to date.'}</p>
              <div><button type="button" className="settings-secondary" disabled={!dirty || busy} onClick={() => { setProfile({ name: storedName ?? '', originalName: storedName }); setError(''); setMessage(''); }}>Discard changes</button>
                <button type="submit" className="primary-action" disabled={!dirty || busy || invalidName}>{busy ? <LoaderCircle className="settings-spinner" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{busy ? 'Saving…' : 'Save changes'}</button></div>
            </div>
          </form>
        </>}
        {activeTab === 'appearance' && <>
          <div className="settings-section-heading"><h2>Find your comfort zone</h2><p>A familiar workspace, in the light that suits you.</p></div>
          <fieldset className="settings-appearance"><legend>Color theme</legend>
            <div className="settings-theme-grid">{appearances.map((option) => {
              const Icon = option.icon;
              return <label key={option.value} className={`settings-theme-card ${preference === option.value ? 'is-selected' : ''}`}>
                <input type="radio" name="settings-theme" value={option.value} checked={preference === option.value} onChange={() => setPreference(option.value)} />
                <span className={`settings-theme-preview preview-${option.value}`} aria-hidden="true"><span className="preview-sidebar"><i /><i /><i /></span><span className="preview-main"><i /><span><i /><i /></span><i /></span></span>
                <span className="settings-theme-label"><Icon size={16} aria-hidden="true" /><strong>{option.label}</strong><span className="settings-radio-mark" aria-hidden="true">{preference === option.value && <Check size={12} />}</span></span>
                <span className="settings-theme-description">{option.description}</span>
              </label>;
            })}</div>
          </fieldset>
          <div className="settings-theme-storage"><ThemeStorageControl /></div>
          <p className="settings-appearance-note">Applied immediately. The header appearance control uses the same preference.{preference === 'system' && ` Your device is currently using ${resolvedTheme} mode.`}</p>
        </>}
        <div hidden={activeTab !== 'security'}><AccountSecurity profileBlocked={dirty || busy || dataBusy} onBusyChange={setSecurityBusy} /></div>
        {activeTab === 'notifications' && <>
          <div className="settings-section-heading"><h2>Notifications</h2><p>Your optional updates and account messages.</p></div>
          <UnavailableCard title="Notification preferences" description="Optional notification and digest preferences are not available yet. Email verification messages are part of account security." />
        </>}
        <div hidden={activeTab !== 'data'}><AccountData profileBlocked={dirty || busy || securityBusy} onBusyChange={setDataBusy} /></div>
      </div>
    </section>
    <p className="settings-footnote"><Shield size={14} aria-hidden="true" />Your settings belong to your account. Your theme choice belongs to this browser.</p>
  </div>;
}
