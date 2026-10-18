import { createContext, useContext } from 'react';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeStorageError = 'save' | 'remove' | null;
export const THEME_STORAGE_KEY = 'dataplatform-theme';
export const isThemePreference = (value: unknown): value is ThemePreference => value === 'light' || value === 'dark' || value === 'system';
export const ThemeContext = createContext<{
  preference: ThemePreference; resolvedTheme: ResolvedTheme;
  setPreference: (value: ThemePreference) => void;
  rememberPreference: boolean; setRememberPreference: (remember: boolean) => void;
  storageError: ThemeStorageError;
}>({ preference: 'system', resolvedTheme: 'light', setPreference: () => {}, rememberPreference: false, setRememberPreference: () => {}, storageError: null });
export const useTheme = () => useContext(ThemeContext);
