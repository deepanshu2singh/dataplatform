import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
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

function LoginDestination() {
  const { securityNotice } = useAuth();
  return <><div>Login destination</div><p data-testid="completion-reason">{securityNotice}</p></>;
}
function renderSettings() {
  const router = createMemoryRouter([
    { element: <AuthProvider><ThemeProvider><UnsavedChangesProvider><Outlet /></UnsavedChangesProvider></ThemeProvider></AuthProvider>, children: [
      { element: <ProtectedRoute><Layout /></ProtectedRoute>, children: [
        { path: '/settings', element: <SettingsPage /> }, { path: '/', element: <div>Home destination</div> },
      ] },
      { path: '/login', element: <LoginDestination /> },
    ] },
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

describe('connected Security settings', () => {
  async function openSecurity() {
    const view = await openSettings();
    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));
    return view;
  }
  function fillChange(current = 'Current-Password-123!', next = 'New-Password-456!', confirm = next) {
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
  }
  it('requires matching, different, valid-length passwords and supports show/hide', async () => {
    const post = vi.spyOn(api, 'post'); await openSecurity();
    const button = screen.getByRole('button', { name: 'Change password and sign out' });
    expect(button).toBeDisabled();
    fillChange('old', 'short'); expect(button).toBeDisabled();
    fillChange('Current-Password-123!', 'New-Password-456!', 'Mismatch'); expect(button).toBeDisabled();
    fillChange('Same-Password-123!', 'Same-Password-123!'); expect(button).toBeDisabled();
    fillChange(); expect(button).toBeEnabled();
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show new password' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide new password' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    expect(post).not.toHaveBeenCalled();
  });
  it('posts the password change once and reaches login without an unsaved warning', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 204 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { router } = await openSecurity(); fillChange();
    await userEvent.click(screen.getByRole('button', { name: 'Change password and sign out' }));
    await screen.findByText('Login destination');
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByTestId('completion-reason')).toHaveTextContent('password');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/auth/password', { current_password: 'Current-Password-123!', new_password: 'New-Password-456!' }, expect.objectContaining({ signal: expect.any(Object) }));
    expect(confirm).not.toHaveBeenCalled();
  });
  it('signs out everywhere through the real AuthProvider using current password only', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 204 });
    const { router } = await openSecurity();
    fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'Existing-Password-123!' } });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await screen.findByText('Login destination');
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByTestId('completion-reason')).toHaveTextContent('revoke');
    expect(post).toHaveBeenCalledWith('/auth/sessions/revoke', { current_password: 'Existing-Password-123!' }, expect.objectContaining({ signal: expect.any(Object) }));
  });
  it('shows a wrong-password error, clears reauthentication secrets and keeps the session', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({ response: { status: 400, data: { detail: 'The current password is incorrect.' } } });
    const { router } = await openSecurity(); fillChange();
    await userEvent.click(screen.getByRole('button', { name: 'Change password and sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The current password is incorrect.');
    expect(router.state.location.pathname).toBe('/settings');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('New-Password-456!');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/Current-Password|New-Password/);
  });
  it('shows rate-limit errors without claiming a successful change', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({ response: { status: 429, data: { detail: 'Too many security attempts. Wait before trying again.' } } });
    const { router } = await openSecurity(); fillChange();
    await userEvent.click(screen.getByRole('button', { name: 'Change password and sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many security attempts');
    expect(router.state.location.pathname).toBe('/settings');
  });
  it('disables both security actions and Settings tabs while one request is pending', async () => {
    let resolve!: (value: object) => void;
    const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((done) => { resolve = done; }));
    await openSecurity(); fillChange();
    await userEvent.click(screen.getByRole('button', { name: 'Change password and sign out' }));
    expect(screen.getByRole('button', { name: 'Changing password…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Changing password…' }));
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ status: 204 })); await screen.findByText('Login destination');
  });
  it('protects security drafts across Settings tabs and before leaving', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { router } = await openSecurity(); fillChange();
    await userEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(screen.getByLabelText('New password')).toHaveValue('New-Password-456!');
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(confirm).toHaveBeenCalledWith('You have unsaved security changes. Leave without saving?');
    expect(router.state.location.pathname).toBe('/settings');
    await userEvent.click(screen.getByRole('button', { name: 'Clear password fields' }));
    expect(screen.getByLabelText('New password')).toHaveValue('');
    await userEvent.click(screen.getByRole('link', { name: 'Home' })); await screen.findByText('Home destination');
  });
  it('requires saving or discarding a profile draft before a security sign-out', async () => {
    await openSettings();
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: 'Unsaved Name' } });
    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(screen.getByRole('status')).toHaveTextContent('Save or discard your profile changes');
    expect(screen.getByLabelText('Current password')).toBeDisabled();
    await userEvent.click(screen.getByRole('tab', { name: 'Profile' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(screen.getByLabelText('Current password')).toBeEnabled();
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
    await user.click(screen.getByRole('checkbox', { name: 'Remember appearance in this browser' }));
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
    expect(screen.getByText('Retention and account deletion')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare workspace export' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /delete account/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Security' }));
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable two.factor/i })).not.toBeInTheDocument();
  });
  it('rejects overlong names before sending the request', async () => {
    await openSettings();
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: 'a'.repeat(256) } });
    expect(screen.getByRole('textbox', { name: /Full name/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });
});
