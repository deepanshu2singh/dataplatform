import { StrictMode } from 'react';
import { ThemeStorageControl } from './ThemeStorageControl';
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
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme'); document.querySelector('meta[name="theme-color"]')?.remove(); });
describe('application appearance', () => {
  it('keeps browser theme colour aligned before startup and after a manual theme change', async () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.eval(bootstrap);
    expect(meta.content).toBe('#11120d');
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    await userEvent.setup().selectOptions(screen.getByLabelText('Appearance'), 'light');
    expect(meta.content).toBe('#f8f5f2');
  });
  it('switches both ways, persists the choice and restores it after remount', async () => {
    const user = userEvent.setup();
    const first = render(<ThemeProvider><ThemeControl /><ThemeStorageControl /></ThemeProvider>);
    await user.click(screen.getByRole('checkbox', { name: 'Remember appearance in this browser' }));
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

describe('appearance storage choices', () => {
  const checkbox = () => screen.getByRole('checkbox', { name: 'Remember appearance in this browser' });
  const controls = () => render(<ThemeProvider><ThemeControl /><ThemeStorageControl /></ThemeProvider>);
  it('keeps a new preference in memory even during StrictMode startup', async () => {
    const save = vi.spyOn(Storage.prototype, 'setItem');
    const view = render(<StrictMode><ThemeProvider><ThemeControl /><ThemeStorageControl /></ThemeProvider></StrictMode>);
    expect(checkbox()).not.toBeChecked();
    await userEvent.selectOptions(screen.getByLabelText('Appearance'), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark'); expect(save).not.toHaveBeenCalled();
    view.unmount(); controls(); expect(screen.getByLabelText('Appearance')).toHaveValue('system');
  });
  it('forgets only the theme and does not recreate it after a reload', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark'); localStorage.setItem('other', 'keep');
    const user = userEvent.setup(); const view = controls(); expect(checkbox()).toBeChecked();
    await user.click(checkbox()); expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.selectOptions(screen.getByLabelText('Appearance'), 'light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull(); expect(localStorage.getItem('other')).toBe('keep');
    view.unmount(); window.eval(bootstrap); controls(); expect(checkbox()).not.toBeChecked();
    expect(screen.getByLabelText('Appearance')).toHaveValue('system'); expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
  it('keeps remembering System distinct from forgetting', async () => {
    const user = userEvent.setup(); controls(); await user.click(checkbox());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    await user.selectOptions(screen.getByLabelText('Appearance'), 'dark');
    await user.selectOptions(screen.getByLabelText('Appearance'), 'system');
    expect(checkbox()).toBeChecked(); expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
  it('honours cross-tab removal without rewriting or changing the current view', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark'); const user = userEvent.setup(); controls();
    localStorage.removeItem(THEME_STORAGE_KEY);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, oldValue: 'dark', newValue: null, storageArea: localStorage })));
    expect(checkbox()).not.toBeChecked(); expect(document.documentElement.dataset.theme).toBe('dark');
    await user.selectOptions(screen.getByLabelText('Appearance'), 'light'); expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark', storageArea: sessionStorage })));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('stops writes after failed removal, reports it and offers a working retry', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark'); const user = userEvent.setup(); controls();
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw Error('denied'); });
    const save = vi.spyOn(Storage.prototype, 'setItem'); await user.click(checkbox());
    expect(checkbox()).not.toBeChecked(); expect(screen.getByRole('alert')).toHaveTextContent('could not confirm removal');
    await user.selectOptions(screen.getByLabelText('Appearance'), 'light'); expect(save).not.toHaveBeenCalled();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark'); remove.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Retry removing saved appearance' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('detects silent removal failure', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark'); controls(); vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    await userEvent.click(checkbox()); expect(screen.getByRole('alert')).toHaveTextContent('may return after a reload');
  });
  it('keeps appearance usable after a denied save and supports retry', async () => {
    const user = userEvent.setup(); controls(); await user.selectOptions(screen.getByLabelText('Appearance'), 'dark');
    const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('denied'); });
    await user.click(checkbox()); expect(checkbox()).not.toBeChecked(); expect(screen.getByRole('alert')).toHaveTextContent('could not save');
    expect(document.documentElement.dataset.theme).toBe('dark'); save.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Retry saving appearance' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark'); expect(checkbox()).toBeChecked(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
