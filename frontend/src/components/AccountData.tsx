import { PrivacyLink } from './PrivacyLink';
import { useTheme } from '../contexts/theme';
import { PRIVACY_EMAIL, PRIVACY_CONTACT_LINK as PRIVACY_LINK } from '../lib/privacy';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, FileText, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { useLatestRequest, isCanceledRequest } from '../hooks/useLatestRequest';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChanges';
import { emptyExportCursor, exportCatalog, originalCsv, prepareExportPart, startDownload,
  type ExportAuthorization, type ExportCatalog, type ExportCursor } from '../lib/workspaceExport';

interface Props { profileBlocked: boolean; onBusyChange: (busy: boolean) => void }

export function AccountData(props: Props) {
  const { user } = useAuth();
  return <AccountDataPanel key={user?.id ?? 'signed-out'} {...props} accountId={user?.id ?? null} />;
}

function AccountDataPanel({ profileBlocked, onBusyChange, accountId }: Props & { accountId: number | null }) {
  const { rememberPreference } = useTheme();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authorization, setAuthorization] = useState<(ExportAuthorization & { expiresAt: number }) | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<ExportCursor>(emptyExportCursor);
  const [startedAt, setStartedAt] = useState('');
  const [part, setPart] = useState<Awaited<ReturnType<typeof prepareExportPart>> | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [files, setFiles] = useState<ExportCatalog | null>(null);
  const [datasetId, setDatasetId] = useState('');
  const requests = useLatestRequest();
  const downloadCleanup = useRef<(() => void)[]>([]);
  const usable = authorization && authorization.expiresAt > clock ? authorization : null;
  const disabled = Boolean(busy) || profileBlocked || accountId === null;
  useUnsavedChangesGuard(Boolean(password || busy || (part && !downloaded)), 'You have an unfinished data export. Leave this page?');
  useEffect(() => { onBusyChange(Boolean(busy)); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!authorization) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [authorization]);
  useEffect(() => () => { for (const cleanup of downloadCleanup.current) cleanup(); }, []);

  const failure = (reason: unknown) => {
    if (isCanceledRequest(reason) || (reason instanceof DOMException && reason.name === 'AbortError')) return;
    const status = (reason as { response?: { status?: number } })?.response?.status;
    if (status === 403) setAuthorization(null);
    setError(getApiErrorMessage(reason, reason instanceof Error ? reason.message : 'The export could not be prepared. Please try again.'));
  };
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !password || Array.from(password).length > 128) return;
    const request = requests.begin();
    setBusy('Confirming your password…'); setError(''); setMessage('');
    try {
      const { data } = await api.post<ExportAuthorization>('/account-data/authorize', { current_password: password }, { signal: request.signal });
      if (request.isCurrent()) {
        if (!data.proof || data.account.id !== accountId || data.expires_in_seconds !== 900) throw new Error('Invalid export confirmation. Please try again.');
        const now = Date.now(); setClock(now);
        setAuthorization({ ...data, expiresAt: now + data.expires_in_seconds * 1000 });
        setMessage('Password confirmed. Your sign-in sessions are unchanged.');
      }
    } catch (reason) { if (request.isCurrent()) failure(reason); }
    finally { if (request.isCurrent()) { setPassword(''); setShowPassword(false); setBusy(''); } request.finish(); }
  };
  const prepare = async () => {
    if (disabled || !usable || (part && !downloaded) || part?.complete) return;
    const request = requests.begin();
    setBusy('Preparing workspace records…'); setError(''); setMessage('');
    try {
      const start = startedAt || new Date().toISOString();
      const result = await prepareExportPart({ proof: usable.proof, account: usable.account, cursor, startedAt: start, signal: request.signal,
        onProgress: (records) => { if (request.isCurrent()) setBusy(`Preparing workspace records… ${records} copied`); } });
      if (request.isCurrent()) { setPart(result); setCursor(result.cursor); setStartedAt(start); setDownloaded(false); setMessage(`Part ${result.cursor.part} is ready. Download it before continuing.`); }
    } catch (reason) { if (request.isCurrent()) failure(reason); }
    finally { if (request.isCurrent()) setBusy(''); request.finish(); }
  };
  const downloadPart = () => {
    if (!part || disabled) return;
    const stamp = startedAt.replace(/[^0-9TZ]/g, '');
    downloadCleanup.current.push(startDownload(part.blob, `dataplatform-workspace-${stamp}-part-${String(part.cursor.part).padStart(3, '0')}.json`));
    setDownloaded(true);
    setMessage(part.complete ? 'Final-part download started. Keep all numbered parts and check your browser downloads.' : 'Download started. Keep this part, then prepare the next one.');
  };
  const loadFiles = async (after: string | null = null) => {
    if (disabled || !usable) return;
    const request = requests.begin(); setBusy('Loading your dataset list…'); setError('');
    try {
      const result = await exportCatalog(usable.proof, 'datasets', after, request.signal);
      if (request.isCurrent()) { setFiles(result); setDatasetId(result.items.find((item) => item.source_file)?.id ?? ''); }
    } catch (reason) { if (request.isCurrent()) failure(reason); }
    finally { if (request.isCurrent()) setBusy(''); request.finish(); }
  };
  const downloadCsv = async () => {
    if (disabled || !usable || !datasetId) return;
    const request = requests.begin(); setBusy('Preparing the original CSV…'); setError(''); setMessage('');
    try {
      const result = await originalCsv(usable.proof, Number(datasetId), request.signal, (bytes) => {
        if (request.isCurrent()) setBusy(`Reading the original CSV… ${(bytes / 1024 / 1024).toFixed(1)} MB`);
      });
      if (request.isCurrent()) { downloadCleanup.current.push(startDownload(result.blob, result.filename)); setMessage('Original CSV download started. Check your browser downloads.'); }
    } catch (reason) { if (request.isCurrent()) failure(reason); }
    finally { if (request.isCurrent()) setBusy(''); request.finish(); }
  };

  return <div className="settings-data">
    <div className="settings-section-heading"><h2>Your data, in your hands</h2><p>Download your saved work and understand the controls available to you.</p></div>
    <section className="settings-data-card" aria-labelledby="data-confirm-title">
      <h3 id="data-confirm-title"><ShieldCheck size={19} aria-hidden="true" />Confirm it is you</h3>
      <p>Confirm your current password before exporting. This does not change your password or sign you out.</p>
      {profileBlocked && <p className="settings-feedback">Finish the current Settings action or save/discard your profile edits first.</p>}
      {!usable ? <form onSubmit={(event) => void confirm(event)}>
        <div className="settings-field"><label htmlFor="data-current-password">Password for export</label>
          <div className="settings-data-password"><input id="data-current-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} maxLength={256} disabled={disabled}
            onChange={(event) => { setPassword(event.target.value); setError(''); }} /><button type="button" className="settings-secondary" disabled={disabled} aria-label={showPassword ? 'Hide export password' : 'Show export password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div>
        </div>
        <button type="submit" className="primary-action" disabled={disabled || !password || Array.from(password).length > 128}>Confirm password</button>
        {authorization && <p className="settings-field-help">Confirmation expired. Confirm again to continue with your next part.</p>}
      </form> : <p className="settings-feedback is-success"><ShieldCheck size={16} aria-hidden="true" />Confirmed for this account. This confirmation expires after 15 minutes.</p>}
      <p className="settings-data-note">Export confirmations, Change password and Sign out everywhere share a limit of five password attempts per 15 minutes.</p>
    </section>
    <section className="settings-data-card" aria-labelledby="data-export-title">
      <h3 id="data-export-title"><Download size={19} aria-hidden="true" />Workspace export</h3>
      <p>Numbered JSON files contain your account details, dataset descriptions and schemas, saved notebook content, dashboard definitions and upload records. Each part holds up to 25 saved items. Keep every part.</p>
      <p className="settings-data-note">Original CSVs are downloaded separately below. Saved code is copied without running it. Standard notebook saves omit transient results; older saved content may include outputs. Exported work may contain sensitive information; keep your downloads private.</p>
      <div className="settings-data-actions">
        <button type="button" className="primary-action" disabled={disabled || !usable || Boolean(part && (!downloaded || part.complete))} onClick={() => void prepare()}>{part?.complete ? 'All parts prepared' : cursor.part ? 'Prepare next part' : 'Prepare workspace export'}</button>
        {part && <button type="button" className="settings-secondary" disabled={disabled} onClick={downloadPart}><FileText size={16} aria-hidden="true" />Download part {part.cursor.part}{part.complete ? ' (final)' : ''}</button>}
        {cursor.part > 0 && <button type="button" className="settings-secondary" disabled={disabled} onClick={() => { setCursor(emptyExportCursor()); setPart(null); setDownloaded(false); setStartedAt(''); setMessage('A new export is ready to start. Keep or remove earlier downloads yourself.'); }}>Start a new export</button>}
      </div>
      {part && <p className="settings-field-help">Part {part.cursor.part}: {part.records} saved items; {(part.blob.size / 1024 / 1024).toFixed(2)} MB. {part.complete ? 'No more parts remain.' : 'More parts remain.'}</p>}
      <p className="settings-data-note">Save your work before exporting and avoid editing it until the export finishes. Items are copied as they are read. If an item changes or becomes unavailable, restart the export.</p>
    </section>
    <section className="settings-data-card" aria-labelledby="data-files-title">
      <h3 id="data-files-title"><FileText size={19} aria-hidden="true" />Original dataset files</h3>
      <p>Download original private cloud CSVs, including rows beyond the browser Python preview. External database contents are not copied.</p>
      <button type="button" className="settings-secondary" disabled={disabled || !usable} onClick={() => void loadFiles()}>Load datasets</button>
      {files && <div className="settings-data-file-controls">
        <div className="settings-field"><label htmlFor="data-source-dataset">Dataset</label><select id="data-source-dataset" value={datasetId} disabled={disabled} onChange={(event) => setDatasetId(event.target.value)}>
          <option value="">Choose an uploaded CSV</option>{files.items.filter((item) => item.source_file).map((item) => <option key={item.id} value={item.id}>{item.name} (#{item.id})</option>)}
        </select></div>
        {!files.items.some((item) => item.source_file) && <p className="settings-field-help">No file datasets on this page.</p>}
        <div className="settings-data-actions"><button type="button" className="primary-action" disabled={disabled || !usable || !datasetId} onClick={() => void downloadCsv()}>Download original CSV</button>
          <button type="button" className="settings-secondary" disabled={disabled || !usable || !files.next_cursor} onClick={() => void loadFiles(files.next_cursor)}>Next datasets</button></div>
      </div>}
      <p className="settings-data-note">Download access is temporary. A download already authorized may finish before its link expires. Missing or older local-only files will show an explicit error.</p>
    </section>
    {busy && <div className="settings-data-progress" role="status"><LoaderCircle className="settings-spinner" size={16} aria-hidden="true" /><span>{busy}</span><button type="button" className="settings-secondary" onClick={() => { requests.cancel(); setPassword(''); setBusy(''); setMessage('Preparation cancelled. No new download was started; you can retry.'); }}>Cancel preparation</button></div>}
    {error && <p role="alert" className="settings-feedback is-error">{error}</p>}
    {message && <p role="status" className="settings-feedback is-success">{message}</p>}
    <section className="settings-data-card settings-data-privacy" aria-labelledby="data-privacy-title">
      <h3 id="data-privacy-title"><ShieldCheck size={19} aria-hidden="true" />Privacy and available controls</h3>
      <dl><div><dt>App operator</dt><dd>Deepanshu Singh, operating Data Platform personally from the United Kingdom.</dd></div>
        <div><dt>Privacy requests</dt><dd><a href={PRIVACY_LINK}><Mail size={15} aria-hidden="true" />{PRIVACY_EMAIL}</a></dd></div>
        <div><dt>Cloud services</dt><dd>This cloud app uses Vercel for hosting/API requests, Supabase for account/workspace records and private dataset storage, and Resend for security emails.</dd></div>
        <div><dt>Available today</dt><dd>Update your name, change your password, sign out everywhere, export saved work, and manage individual items from their workspace pages.</dd></div>
        <div><dt>Browser preference</dt><dd>{rememberPreference ? 'Your appearance choice is remembered in this browser.' : 'New appearance choices are not being saved by this page.'} Manage remembering in Appearance or the privacy notice. Browser preferences are separate from your saved account profile.</dd></div>
        <div><dt>Retention and account deletion</dt><dd>Automatic retention settings and account deletion are not available in Settings yet. Contact the operator about access, correction, deletion or other privacy requests. Sending a request does not itself delete your account.</dd></div></dl>
      <p className="settings-data-note">The workspace export does not include provider logs or backups. This panel describes current controls. <PrivacyLink /></p>
    </section>
  </div>;
}
