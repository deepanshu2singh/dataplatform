import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyEmailPage } from './VerifyEmailPage';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../components/ThemeControl', () => ({ ThemeControl: () => <button>Theme</button> }));
const verifyEmail = vi.fn();
const logout = vi.fn();
const refreshUser = vi.fn();

describe('email verification screen', () => {
  beforeEach(() => {
    vi.restoreAllMocks(); verifyEmail.mockReset(); logout.mockReset(); refreshUser.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, email: 'user@example.com', full_name: null, is_active: true, is_superuser: false, email_verified: false, email_verification_required: true },
      loading: false, login: vi.fn(), register: vi.fn(), logout, verifyEmail, refreshUser, updateProfile: vi.fn(), secureAccount: vi.fn(), securityNotice: null,
    });
  });
  it('does not send emails automatically on mount or refresh', () => {
    const post = vi.spyOn(api, 'post');
    render(<VerifyEmailPage />);
    expect(screen.getByText('user@example.com')).toBeVisible();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeDisabled();
  });
  it('requests a code without accepting a browser-supplied recipient and starts a cooldown', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { status: 'sent', retry_after_seconds: 60 } });
    const user = userEvent.setup(); render(<VerifyEmailPage />);
    await user.click(screen.getByRole('button', { name: 'Send verification code' }));
    expect(post).toHaveBeenCalledWith('/auth/email-verification/send', {}, expect.objectContaining({ signal: expect.any(Object) }));
    expect(await screen.findByRole('status')).toHaveTextContent('Check your inbox');
    expect(screen.getByRole('button', { name: /Request another code/ })).toBeDisabled();
  });
  it('retains leading zeros and confirms through the authentication context', async () => {
    verifyEmail.mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<VerifyEmailPage />);
    const input = screen.getByLabelText('Eight-digit code');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    await user.type(input, '00001234');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(verifyEmail).toHaveBeenCalledWith('00001234');
  });
  it('shows an expired-code error and keeps the entered value editable', async () => {
    verifyEmail.mockRejectedValue({ response: { status: 400, data: { detail: 'Invalid or expired verification code. Request a new code.' } } });
    const user = userEvent.setup(); render(<VerifyEmailPage />);
    await user.type(screen.getByLabelText('Eight-digit code'), '12345678');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired');
    expect(screen.getByLabelText('Eight-digit code')).toBeEnabled();
  });
  it('handles delivery failure without pretending a code was sent', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({ response: { status: 503, data: { detail: 'PRIVATE_PROVIDER_ERROR' } } });
    const user = userEvent.setup(); render(<VerifyEmailPage />);
    await user.click(screen.getByRole('button', { name: 'Send verification code' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not confirm email delivery');
    expect(alert).not.toHaveTextContent('PRIVATE_PROVIDER_ERROR');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('allows the pending account to sign out and use another account', async () => {
    logout.mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<VerifyEmailPage />);
    await user.click(screen.getByRole('button', { name: 'Sign out / use another account' }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  });
  it('refreshes identity when another tab has already verified the account', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { status: 'already_verified' } });
    refreshUser.mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<VerifyEmailPage />);
    await user.click(screen.getByRole('button', { name: 'Send verification code' }));
    await waitFor(() => expect(refreshUser).toHaveBeenCalledOnce());
    expect(screen.queryByRole('status')).toBeNull();
  });

});
