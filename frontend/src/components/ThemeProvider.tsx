import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isThemePreference, ThemeContext, THEME_STORAGE_KEY, type ThemePreference, type ThemeStorageError } from '../contexts/theme';
type Appearance = { preference: ThemePreference; remember: boolean; error: ThemeStorageError };
function readAppearance(): Appearance {
  try { const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return { preference: stored, remember: true, error: null };
  } catch { /* Keep appearance usable without storage. */ }
  return { preference: 'system', remember: false, error: null };
}
function saveAppearance(value: ThemePreference): ThemeStorageError {
  try { localStorage.setItem(THEME_STORAGE_KEY, value); return localStorage.getItem(THEME_STORAGE_KEY) === value ? null : 'save'; }
  catch { return 'save'; }
}
function forgetAppearance(): ThemeStorageError {
  try { localStorage.removeItem(THEME_STORAGE_KEY); return localStorage.getItem(THEME_STORAGE_KEY) === null ? null : 'remove'; }
  catch { return 'remove'; }
}
function subscribeToSystemTheme(notify: () => void) {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
}
function readSystemDark() { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false; }
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, updateAppearance] = useState(readAppearance);
  const current = useRef(appearance);
  const commit = useCallback((value: Appearance) => { current.current = value; updateAppearance(value); }, []);
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, readSystemDark, () => false);
  const preference = appearance.preference;
  const resolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#11120d' : '#f8f5f2');
  }, [resolvedTheme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea) { try { if (event.storageArea !== window.localStorage) return; } catch { return; } }
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      if (isThemePreference(event.newValue) && event.key === THEME_STORAGE_KEY) {
        commit({ preference: event.newValue, remember: true, error: null });
      } else { commit({ ...current.current, remember: false, error: null }); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [commit]);
  const setPreference = (value: ThemePreference) => {
    const state = current.current;
    commit({ ...state, preference: value, error: state.remember ? saveAppearance(value) : state.error });
  };
  const setRememberPreference = (remember: boolean) => {
    const state = current.current;
    if (!remember) { commit({ ...state, remember: false, error: forgetAppearance() }); }
    else { const error = saveAppearance(state.preference); commit({ ...state, remember: error === null, error }); }
  };
  return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference, rememberPreference: appearance.remember,
    setRememberPreference, storageError: appearance.error }}>{children}</ThemeContext.Provider>;
}
