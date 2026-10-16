import bootstrap from '../../public/theme-init.js?raw';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { ThemeControl } from './ThemeControl';
import { THEME_STORAGE_KEY } from '../contexts/theme';
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme'); });
describe('application appearance', () => {
  it('switches both ways, persists the choice and restores it after remount', async () => {
    const user = userEvent.setup();
    const first = render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    await user.selectOptions(screen.getByLabelText('Appearance'), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    first.unmount();
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    expect(screen.getByLabelText('Appearance')).toHaveValue('dark');
    await user.selectOptions(screen.getByLabelText('Appearance'), 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('follows system changes only while System is selected and removes its listener', async () => {
    const user = userEvent.setup();
    const view = render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    const listener = media.addEventListener.mock.calls[0][1];
    media.matches = true; act(() => listener());
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.selectOptions(screen.getByLabelText('Appearance'), 'light');
    media.matches = true; act(() => listener());
    expect(document.documentElement.dataset.theme).toBe('light');
    view.unmount(); expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  });
  it('synchronizes appearance across tabs without touching other storage keys', () => {
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'dark' })));
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' })));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('keeps switching usable when browser storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('unavailable'); });
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    await userEvent.setup().selectOptions(screen.getByLabelText('Appearance'), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('sets the same theme before React starts, including invalid or unavailable storage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark'); window.eval(bootstrap);
    expect(document.documentElement.dataset.theme).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'invalid'); window.eval(bootstrap);
    expect(document.documentElement.dataset.theme).toBe('light');
    media.matches = true; window.eval(bootstrap);
    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('unavailable'); });
    window.eval(bootstrap); expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
