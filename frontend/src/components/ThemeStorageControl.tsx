import { useId } from 'react';
import { useTheme } from '../contexts/theme';
export function ThemeStorageControl() {
  const id = useId();
  const { rememberPreference, setRememberPreference, storageError } = useTheme();
  return <div className="theme-storage-control">
    <label htmlFor={id} className="flex items-start gap-3 text-sm font-medium">
      <input id={id} type="checkbox" checked={rememberPreference} onChange={(event) => setRememberPreference(event.target.checked)}
        aria-describedby={`${id}-help`} className="mt-1 h-4 w-4 shrink-0" /><span>Remember appearance in this browser</span>
    </label>
    <p id={`${id}-help`} className="mt-2 text-sm">{rememberPreference
      ? 'Your Light, Dark or System choice is saved in this browser until you forget it or clear browser storage.'
      : 'Your choice applies to this open page. After a reload, appearance follows your device unless a saved choice remains.'}
      {' '}This does not change your account profile.</p>
    {storageError && <div className="mt-3 text-sm" role="alert"><p>{storageError === 'remove'
      ? 'This browser could not confirm removal of the old saved appearance. It may return after a reload. No new appearance choices will be saved while remembering is off.'
      : 'This browser could not save your appearance. Your current page still uses your choice; the previously saved choice may return after a reload.'}</p>
      <button type="button" className="mt-2 underline underline-offset-4" onClick={() => setRememberPreference(storageError !== 'remove')}>
        {storageError === 'remove' ? 'Retry removing saved appearance' : 'Retry saving appearance'}</button></div>}
  </div>;
}
