import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../contexts/AuthContext';
import { ProtectedRoute, PublicRoute, VerificationRoute } from './AccountAccess';

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
const verified = { id: 1, email: 'user@example.com', full_name: null, is_active: true, is_superuser: false, email_verified: true, email_verification_required: true };

function show(path: string, user: typeof verified | null, loading = false) {
  vi.mocked(useAuth).mockReturnValue({ user, loading, login: vi.fn(), register: vi.fn(), logout: vi.fn(), verifyEmail: vi.fn(), refreshUser: vi.fn(), updateProfile: vi.fn(), secureAccount: vi.fn(), securityNotice: null });
  const router = createMemoryRouter([
    { path: '/', element: <ProtectedRoute><p>Workspace content</p></ProtectedRoute> },
    { path: '/login', element: <PublicRoute><p>Login form</p></PublicRoute> },
    { path: '/verify-email', element: <VerificationRoute><p>Verification screen</p></VerificationRoute> },
  ], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe('account verification access', () => {
  beforeEach(() => vi.clearAllMocks());
  it('redirects a restored pending account before workspace content renders', async () => {
    show('/', { ...verified, email_verified: false });
    expect(await screen.findByText('Verification screen')).toBeVisible();
    expect(screen.queryByText('Workspace content')).toBeNull();
  });
  it('routes a signed-in pending user from login to verification', async () => {
    show('/login', { ...verified, email_verified: false });
    expect(await screen.findByText('Verification screen')).toBeVisible();
  });
  it('admits a verified account', async () => {
    show('/', verified);
    expect(await screen.findByText('Workspace content')).toBeVisible();
  });
  it('requires login to use the verification page', async () => {
    show('/verify-email', null);
    expect(await screen.findByText('Login form')).toBeVisible();
  });
  it('retains access during the explicit delivery-preflight rollout mode', async () => {
    show('/', { ...verified, email_verified: false, email_verification_required: false });
    expect(await screen.findByText('Workspace content')).toBeVisible();
  });
  it('keeps the branded loading state while session identity is unknown', () => {
    show('/', null, true);
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeVisible();
    expect(screen.queryByText('Workspace content')).toBeNull();
  });
});
