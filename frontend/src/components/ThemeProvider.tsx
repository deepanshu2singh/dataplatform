import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isThemePreference, ThemeContext, THEME_STORAGE_KEY, type ThemePreference } from '../contexts/theme';
function readPreference(): ThemePreference {
  try { const stored = localStorage.getItem(THEME_STORAGE_KEY); return isThemePreference(stored) ? stored : 'system'; }
  catch { return 'system'; }
}
function subscribeToSystemTheme(notify: () => void) {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
}
function readSystemDark() { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false; }
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, updatePreference] = useState(readPreference);
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, readSystemDark, () => false);
  const resolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useLayoutEffect(() => { document.documentElement.dataset.theme = resolvedTheme; }, [resolvedTheme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      updatePreference(isThemePreference(event.newValue) ? event.newValue : 'system');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const setPreference = (value: ThemePreference) => {
    updatePreference(value);
    try { localStorage.setItem(THEME_STORAGE_KEY, value); } catch { /* Keep session choice if storage is unavailable. */ }
  };
  return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>{children}</ThemeContext.Provider>;
}
