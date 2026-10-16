import { SunMoon } from 'lucide-react';
import { isThemePreference, useTheme } from '../contexts/theme';
export function ThemeControl() {
  const { preference, setPreference } = useTheme();
  return <label className="theme-control">
    <SunMoon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="sr-only">Appearance</span>
    <select aria-label="Appearance" value={preference} onChange={(event) => { if (isThemePreference(event.target.value)) setPreference(event.target.value); }}>
      <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
    </select>
  </label>;
}
