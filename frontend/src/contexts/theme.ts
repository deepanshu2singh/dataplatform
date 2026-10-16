import { createContext, useContext } from 'react';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'dataplatform-theme';
export const isThemePreference = (value: unknown): value is ThemePreference => value === 'light' || value === 'dark' || value === 'system';
export const ThemeContext = createContext<{ preference: ThemePreference; resolvedTheme: ResolvedTheme; setPreference: (value: ThemePreference) => void; }>({ preference: 'system', resolvedTheme: 'light', setPreference: () => {} });
export const useTheme = () => useContext(ThemeContext);
