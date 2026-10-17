import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { UnsavedChangesProvider } from '../components/UnsavedChangesProvider';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { post: vi.fn() } }));
const post = vi.mocked(api.post);
function renderRecovery() {
  const router = createMemoryRouter([
    { path: '/forgot-password', element: <UnsavedChangesProvider><ForgotPasswordPage /></UnsavedChangesProvider> },
    { path: '/login', element: <p>Login destination</p> },
  ], { initialEntries: ['/forgot-password'] });
  render(<RouterProvider router={router} />);
  return router;
}
async function requested() {
  renderRecovery();
  fireEvent.change(screen.getByLabelText('Account email address'), { target: { value: 'Owner@Example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
  await screen.findByLabelText('Eight-digit reset code');
}
function fillCodeAndPassword(password = ' New-Password-123! ') {
  fireEvent.change(screen.getByLabelText('Eight-digit reset code'), { target: { value: '00123456' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } });
}

describe('forgotten-password recovery', () => {
  beforeEach(() => { post.mockReset(); post.mockResolvedValue({ status: 202, data: {} }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('normalizes only email and displays generic delivery text without claiming account existence', async () => {
    await requested();
    expect(post).toHaveBeenCalledWith('/auth/password-recovery/request', { email: 'owner@example.com' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole('status')).toHaveTextContent('If an active account');
    expect(screen.getByRole('button', { name: /Request another code in/ })).toBeDisabled();
    expect(window.location.href).not.toContain('owner@example.com');
  });
  it('submits an allow-listed body with untrimmed password; clears secrets and returns to normal login', async () => {
    const user = userEvent.setup();
    await requested(); fillCodeAndPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Reset password and sign out' }));
    expect(await screen.findByRole('heading', { name: 'Password reset' })).toBeInTheDocument();
    expect(post).toHaveBeenLastCalledWith('/auth/password-recovery/confirm', { email: 'owner@example.com', code: '00123456', new_password: ' New-Password-123! ' }, expect.anything());
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('verification status is unchanged');
    await user.click(screen.getByRole('link', { name: 'Back to sign in' }));
    expect(await screen.findByText('Login destination')).toBeInTheDocument();
  });
  it('blocks short passwords, mismatched confirmation and incomplete codes', async () => {
    await requested(); fillCodeAndPassword('short');
    expect(screen.getByRole('button', { name: 'Reset password and sign out' })).toBeDisabled();
    fillCodeAndPassword(); fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-password' } });
    expect(screen.getByText('The new passwords do not match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset password and sign out' })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('keeps a rejected email editable without advancing to a code that was not requested', async () => {
    post.mockRejectedValueOnce({ response: { status: 422, data: { detail: 'Enter a valid account email address.' } } });
    renderRecovery();
    fireEvent.change(screen.getByLabelText('Account email address'), { target: { value: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid account email address.');
    expect(screen.getByLabelText('Account email address')).toBeEnabled();
    expect(screen.queryByLabelText('Eight-digit reset code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset code' })).toBeEnabled();
  });
  it('lets an arriving code be used after an uncertain request without sending twice', async () => {
    post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    await requested();
    expect(screen.getByRole('alert')).toHaveTextContent('if a code arrives');
    expect(screen.getByRole('button', { name: /Request another code in/ })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('rejects a bad code without losing the proposed password or claiming success', async () => {
    await requested(); fillCodeAndPassword();
    post.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Invalid or expired reset code.' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password and sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired reset code.');
    expect(screen.getByLabelText('New password')).toHaveValue(' New-Password-123! ');
    expect(screen.getByLabelText('Eight-digit reset code')).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Password reset' })).not.toBeInTheDocument();
  });
  it('warns that a timed-out reset may have completed instead of reporting a false failure', async () => {
    await requested(); fillCodeAndPassword(); post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password and sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('It may have completed');
  });
  it('uses explicit show/hide controls and clears drafts when changing address', async () => {
    await requested(); fillCodeAndPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Show passwords' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Use another email' }));
    expect(screen.getByLabelText('Account email address')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    await screen.findByLabelText('Eight-digit reset code');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(post).toHaveBeenCalledTimes(2);
  });
  it('protects unfinished secrets when navigating away and permits an explicit discard', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    await requested(); fillCodeAndPassword();
    await user.click(screen.getByRole('link', { name: 'Back to sign in' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(screen.getByLabelText('New password')).toHaveValue(' New-Password-123! ');
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('link', { name: 'Back to sign in' }));
    expect(await screen.findByText('Login destination')).toBeInTheDocument();
  });
  it('disables duplicate submissions and cancels the request when unmounted', async () => {
    let resolve: (value: unknown) => void = () => {};
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <UnsavedChangesProvider><ForgotPasswordPage /></UnsavedChangesProvider> }])} />);
    fireEvent.change(screen.getByLabelText('Account email address'), { target: { value: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(screen.getByRole('button', { name: 'Requesting code…' })).toBeDisabled();
    const signal = post.mock.calls[0][2]?.signal;
    unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => { resolve({ data: {} }); });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

