import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../contexts/AuthContext';
import { ThemeProvider } from '../components/ThemeProvider';
import { THEME_STORAGE_KEY } from '../contexts/theme';
import { UnsavedChangesProvider } from '../components/UnsavedChangesProvider';
import { ProtectedRoute } from '../components/AccountAccess';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { SettingsPage } from './SettingsPage';

const original = { id: 42, email: 'user@example.com', full_name: 'Test User' as string | null, is_active: true, is_superuser: false, email_verified: true, email_verification_required: true };
let serverUser = { ...original };
let patch: ReturnType<typeof vi.spyOn>;
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

function renderSettings() {
  const router = createMemoryRouter([
    { element: <AuthProvider><ThemeProvider><UnsavedChangesProvider><ProtectedRoute><Layout /></ProtectedRoute></UnsavedChangesProvider></ThemeProvider></AuthProvider>, children: [
      { path: '/settings', element: <SettingsPage /> }, { path: '/', element: <div>Home destination</div> },
    ] },
    { path: '/login', element: <div>Login destination</div> },
  ], { initialEntries: ['/settings'] });
  return { router, ...render(<RouterProvider router={router} />) };
}
async function openSettings() {
  const view = renderSettings();
  await screen.findByRole('textbox', { name: /Full name/ });
  return view;
}
beforeEach(() => {
  serverUser = { ...original };
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  vi.spyOn(api, 'get').mockImplementation(async () => ({ data: { ...serverUser } }));
  patch = vi.spyOn(api, 'patch').mockImplementation(async (_url, data: unknown) => {
    serverUser = { ...serverUser, full_name: (data as { full_name: string | null }).full_name };
    return { data: { ...serverUser } };
  });
});
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme'); });

describe('connected account settings', () => {
  it('saves a normalized name, updates the real sidebar and restores it from the next session read', async () => {
    const user = userEvent.setup(); const view = await openSettings();
    const name = screen.getByRole('textbox', { name: /Full name/ });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(name); await user.type(name, '  Updated Name  ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your profile has been saved.');
    expect(patch).toHaveBeenCalledWith('/auth/me', { full_name: 'Updated Name', expected_full_name: 'Test User' }, expect.objectContaining({ signal: expect.any(Object) }));
    expect(screen.getAllByText('Updated Name')).toHaveLength(2);
    expect(name).toHaveValue('Updated Name');
    view.unmount(); await openSettings();
    expect(screen.getByRole('textbox', { name: /Full name/ })).toHaveValue('Updated Name');
  });
  it('shows backend verification status and keeps the sign-in email read-only', async () => {
    await openSettings();
    expect(screen.getByText('Email verified')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveValue(original.email);
  });
  it('does not label an unverified account as verified when optional mode allows access', async () => {
    serverUser.email_verified = false; serverUser.email_verification_required = false;
    await openSettings();
    expect(screen.getByText('Email not verified')).toBeInTheDocument();
  });
  it('allows clearing an optional name and saves null', async () => {
    const user = userEvent.setup(); await openSettings();
    await user.clear(screen.getByRole('textbox', { name: /Full name/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Your profile has been saved.');
    expect(patch.mock.calls[0][1]).toEqual({ full_name: null, expected_full_name: 'Test User' });
    expect(screen.getByRole('textbox', { name: /Full name/ })).toHaveValue('');
  });
  it('retains a failed save draft and allows a retry', async () => {
    patch.mockRejectedValueOnce({ code: 'ERR_NETWORK' });
    const user = userEvent.setup(); await openSettings();
    const name = screen.getByRole('textbox', { name: /Full name/ });
    await user.clear(name); await user.type(name, 'Retry Name');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the server');
    expect(name).toHaveValue('Retry Name');
    expect(screen.queryByText('Your profile has been saved.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Your profile has been saved.');
  });
  it('preserves a conflicting draft and retains it across Settings tabs', async () => {
    patch.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Your profile changed in another tab. Your edits are kept. Refresh to review the saved profile before trying again.' } } });
    const user = userEvent.setup(); await openSettings();
    await user.clear(screen.getByRole('textbox', { name: /Full name/ }));
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'My draft');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('another tab');
    await user.click(screen.getByRole('tab', { name: 'Appearance' }));
    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    expect(screen.getByRole('textbox', { name: /Full name/ })).toHaveValue('My draft');
  });
  it('prevents repeated submissions while a save is in flight', async () => {
    let resolve!: (value: { data: typeof original }) => void;
    patch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const user = userEvent.setup(); await openSettings();
    await user.clear(screen.getByRole('textbox', { name: /Full name/ }));
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Saved once');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /Full name/ })).toBeDisabled();
    expect(patch).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ data: { ...original, full_name: 'Saved once' } }); });
    await screen.findByText('Your profile has been saved.');
  });
  it('warns before leaving an unsaved profile and supports discarding the draft', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup(); await openSettings();
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), ' edited');
    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(confirm).toHaveBeenCalledWith('You have unsaved profile changes. Leave without saving?');
    expect(screen.getByRole('textbox', { name: /Full name/ })).toHaveValue('Test User edited');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('textbox', { name: /Full name/ })).toHaveValue('Test User');
    await user.click(screen.getByRole('link', { name: 'Home' }));
    await screen.findByText('Home destination');
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('connects theme cards to the header control, persists the preference and follows System', async () => {
    const user = userEvent.setup(); const view = await openSettings();
    await user.click(screen.getByRole('tab', { name: 'Appearance' }));
    await user.click(screen.getByRole('radio', { name: /^Dark/ }));
    expect(screen.getByRole('combobox', { name: 'Appearance' })).toHaveValue('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    view.unmount(); await openSettings();
    expect(screen.getByRole('combobox', { name: 'Appearance' })).toHaveValue('dark');
    await user.click(screen.getByRole('tab', { name: 'Appearance' }));
    await user.click(screen.getByRole('radio', { name: /^System/ }));
    media.matches = true;
    act(() => { for (const call of media.addEventListener.mock.calls) call[1](); });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(screen.getByText(/device is currently using dark mode/)).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
  it('supports keyboard navigation and does not present unsupported features as working controls', async () => {
    const user = userEvent.setup(); await openSettings();
    screen.getByRole('tab', { name: 'Profile' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Data' })).toHaveFocus();
    expect(screen.getByText('Account deletion')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete account/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Security' }));
    expect(screen.queryByLabelText('Current Password')).not.toBeInTheDocument();
  });
  it('rejects overlong names before sending the request', async () => {
    await openSettings();
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: 'a'.repeat(256) } });
    expect(screen.getByRole('textbox', { name: /Full name/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });
});
