import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { AuthProvider, useAuth } from './AuthContext';

const TEST_USER = {
  id: 42,
  email: 'user@example.com',
  full_name: 'Test User',
  is_active: true,
  is_superuser: false,
  email_verified: true,
  email_verification_required: true,
};

function AuthProbe() {
  const auth = useAuth();
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);

  return (
    <div>
      <div data-testid="loading">{String(auth.loading)}</div>
      <div data-testid="user-email">{auth.user?.email ?? 'none'}</div>
      <div data-testid="verified">{String(auth.user?.email_verified)}</div>
      <div data-testid="full-name">{auth.user?.full_name ?? 'none'}</div>
      <button onClick={() => void auth.updateProfile('Updated Name', 'Test User').catch((reason: unknown) => setError(String(reason)))}>Save profile probe</button>
      <button onClick={() => void auth.verifyEmail('00001234').catch((reason: unknown) => setError(String(reason)))}>Verify probe</button>
      <div data-testid="security-completed">{String(completed)}</div>
      <button onClick={() => void auth.secureAccount('password', 'Current-Password', 'New-Password', () => setCompleted(true)).catch((reason: unknown) => setError(String(reason)))}>Change password probe</button>
      <button onClick={() => void auth.secureAccount('revoke', 'Current-Password', undefined, () => setCompleted(true)).catch((reason: unknown) => setError(String(reason)))}>Revoke sessions probe</button>
      <div data-testid="error">{error}</div>
      <button
        type="button"
        onClick={() => {
          void auth
            .login('  USER@Example.COM ', 'secret123')
            .catch((reason: unknown) => setError(String(reason)));
        }}
      >
        Login probe
      </button>
      <button
        type="button"
        onClick={() => {
          void auth
            .register('  USER@Example.COM ', 'secret123', '  Test User  ')
            .catch((reason: unknown) => setError(String(reason)));
        }}
      >
        Register probe
      </button>
      <button
        type="button"
        onClick={() => {
          void auth.logout().catch((reason: unknown) => setError(String(reason)));
        }}
      >
        Logout probe
      </button>
    </div>
  );
}

function renderAuthProbe() {
  return render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    delete api.defaults.headers.common.Authorization;
    vi.restoreAllMocks();
  });

  it('checks the server session and starts unauthenticated when no valid cookie exists', async () => {
    const getSpy = vi
      .spyOn(api, 'get')
      .mockRejectedValue({ response: { status: 401 } });

    renderAuthProbe();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('user-email')).toHaveTextContent('none');
    expect(getSpy).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ signal: expect.any(Object) }));
    expect(api.defaults.withCredentials).toBe(true);
  });

  it('restores an existing HttpOnly-cookie session from /auth/me', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: TEST_USER });

    renderAuthProbe();

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('user@example.com');
    });

    expect(getSpy).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ signal: expect.any(Object) }));
    expect(localStorage.getItem('token')).toBeNull();
    expect(api.defaults.headers.common.Authorization).toBeUndefined();
  });

  it('normalizes email, relies on the HttpOnly cookie, and fetches the user on login', async () => {
    const postSpy = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { access_token: 'compatibility-token' } });
    const getSpy = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: TEST_USER });
    const user = userEvent.setup();

    renderAuthProbe();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByRole('button', { name: 'Login probe' }));

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('user@example.com');
    });

    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body, config] = postSpy.mock.calls[0];
    expect(url).toBe('/auth/login');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get('username')).toBe('user@example.com');
    expect((body as URLSearchParams).get('password')).toBe('secret123');
    expect(config).toMatchObject({
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(api.defaults.headers.common.Authorization).toBeUndefined();
  });

  it('normalizes registration data and automatically establishes a cookie session', async () => {
    const postSpy = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({ data: { id: 42 } })
      .mockResolvedValueOnce({ data: { access_token: 'compatibility-token' } });
    vi.spyOn(api, 'get')
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: TEST_USER });
    const user = userEvent.setup();

    renderAuthProbe();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByRole('button', { name: 'Register probe' }));

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('user@example.com');
    });

    expect(postSpy.mock.calls[0][0]).toBe('/auth/register');
    expect(postSpy.mock.calls[0][1]).toEqual({
      email: 'user@example.com',
      password: 'secret123',
      full_name: 'Test User',
    });
    expect(postSpy.mock.calls[1][0]).toBe('/auth/login');
    expect(localStorage.getItem('token')).toBeNull();
    expect(api.defaults.headers.common.Authorization).toBeUndefined();
  });

  it('ignores a stale initial session response after a newer login session check wins', async () => {
    let resolveInitial!: (value: { data: typeof TEST_USER }) => void;
    const initialSession = new Promise<{ data: typeof TEST_USER }>((resolve) => {
      resolveInitial = resolve;
    });

    vi.spyOn(api, 'post').mockResolvedValue({ data: undefined });
    const getSpy = vi
      .spyOn(api, 'get')
      .mockImplementationOnce(() => initialSession as any)
      .mockResolvedValueOnce({ data: TEST_USER });
    const user = userEvent.setup();

    renderAuthProbe();
    await user.click(screen.getByRole('button', { name: 'Login probe' }));

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('user-email')).toHaveTextContent('user@example.com');
    });

    resolveInitial({
      data: { ...TEST_USER, email: 'stale@example.com' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('user@example.com');
    });
  });

  it('calls the server logout endpoint before clearing local authentication state', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: TEST_USER });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: undefined });
    const user = userEvent.setup();

    renderAuthProbe();

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('user@example.com');
    });

    await user.click(screen.getByRole('button', { name: 'Logout probe' }));

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('none');
    });

    expect(postSpy).toHaveBeenCalledWith('/auth/logout');
  });
  it('retains a restricted session and refreshes verification identity from the confirm response', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { ...TEST_USER, email_verified: false } });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: TEST_USER });
    const user = userEvent.setup(); renderAuthProbe();
    await waitFor(() => expect(screen.getByTestId('verified')).toHaveTextContent('false'));
    await user.click(screen.getByRole('button', { name: 'Verify probe' }));
    await waitFor(() => expect(screen.getByTestId('verified')).toHaveTextContent('true'));
    expect(post).toHaveBeenCalledWith('/auth/email-verification/confirm', { code: '00001234' }, expect.objectContaining({ signal: expect.any(Object) }));
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('ignores a late verification response after logout', async () => {
    let resolveVerification!: (value: { data: typeof TEST_USER }) => void;
    const pending = new Promise<{ data: typeof TEST_USER }>((resolve) => { resolveVerification = resolve; });
    vi.spyOn(api, 'get').mockResolvedValue({ data: { ...TEST_USER, email_verified: false } });
    vi.spyOn(api, 'post').mockImplementation((url) => url === '/auth/email-verification/confirm' ? pending as any : Promise.resolve({ data: undefined }) as any);
    const user = userEvent.setup(); renderAuthProbe();
    await waitFor(() => expect(screen.getByTestId('user-email')).toHaveTextContent('user@example.com'));
    await user.click(screen.getByRole('button', { name: 'Verify probe' }));
    await user.click(screen.getByRole('button', { name: 'Logout probe' }));
    await waitFor(() => expect(screen.getByTestId('user-email')).toHaveTextContent('none'));
    resolveVerification({ data: TEST_USER });
    await waitFor(() => expect(screen.getByTestId('user-email')).toHaveTextContent('none'));
  });

  it('updates shared identity from the saved profile without storing credentials', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: TEST_USER });
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: { ...TEST_USER, full_name: 'Updated Name' } });
    const user = userEvent.setup(); renderAuthProbe();
    await screen.findByText('Test User');
    await user.click(screen.getByRole('button', { name: 'Save profile probe' }));
    await waitFor(() => expect(screen.getByTestId('full-name')).toHaveTextContent('Updated Name'));
    expect(patch).toHaveBeenCalledWith('/auth/me', { full_name: 'Updated Name', expected_full_name: 'Test User' }, expect.objectContaining({ signal: expect.any(Object) }));
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('does not resurrect an account when a profile save arrives after logout', async () => {
    let resolveSave!: (value: { data: typeof TEST_USER }) => void;
    const pending = new Promise<{ data: typeof TEST_USER }>((resolve) => { resolveSave = resolve; });
    vi.spyOn(api, 'get').mockResolvedValue({ data: TEST_USER });
    vi.spyOn(api, 'patch').mockImplementation(() => pending as any);
    vi.spyOn(api, 'post').mockResolvedValue({ data: undefined });
    const user = userEvent.setup(); renderAuthProbe();
    await screen.findByText('Test User');
    await user.click(screen.getByRole('button', { name: 'Save profile probe' }));
    await user.click(screen.getByRole('button', { name: 'Logout probe' }));
    await waitFor(() => expect(screen.getByTestId('user-email')).toHaveTextContent('none'));
    resolveSave({ data: { ...TEST_USER, full_name: 'Late Name' } });
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('CanceledError'));
    expect(screen.getByTestId('user-email')).toHaveTextContent('none');
  });

});


describe('security session changes', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  it('posts allow-listed password fields and ends the local session only after success', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: TEST_USER });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 204 });
    renderAuthProbe(); await screen.findByText(TEST_USER.email);
    await userEvent.click(screen.getByRole('button', { name: 'Change password probe' }));
    await waitFor(() => expect(screen.getByTestId('user-email')).toHaveTextContent('none'));
    expect(post).toHaveBeenCalledWith('/auth/password', { current_password: 'Current-Password', new_password: 'New-Password' }, expect.objectContaining({ signal: expect.any(Object) }));
    expect(screen.getByTestId('security-completed')).toHaveTextContent('true');
    expect(localStorage.length).toBe(0);
  });
  it('keeps the authenticated session after an incorrect current password', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: TEST_USER });
    vi.spyOn(api, 'post').mockRejectedValue({ response: { status: 400 } });
    renderAuthProbe(); await screen.findByText(TEST_USER.email);
    await userEvent.click(screen.getByRole('button', { name: 'Change password probe' }));
    await waitFor(() => expect(screen.getByTestId('error')).not.toBeEmptyDOMElement());
    expect(screen.getByTestId('user-email')).toHaveTextContent(TEST_USER.email);
    expect(screen.getByTestId('security-completed')).toHaveTextContent('false');
  });
  it('posts only current password for sign-out-everywhere', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: TEST_USER });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 204 });
    renderAuthProbe(); await screen.findByText(TEST_USER.email);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke sessions probe' }));
    await waitFor(() => expect(screen.getByTestId('user-email')).toHaveTextContent('none'));
    expect(post).toHaveBeenCalledWith('/auth/sessions/revoke', { current_password: 'Current-Password' }, expect.objectContaining({ signal: expect.any(Object) }));
  });
  it('ignores a late security response after a newer login session wins', async () => {
    let resolve!: (value: object) => void;
    const pending = new Promise<object>((done) => { resolve = done; });
    vi.spyOn(api, 'get').mockResolvedValue({ data: TEST_USER });
    vi.spyOn(api, 'post').mockImplementation(async (url) => url === '/auth/password' ? pending : { status: 204 });
    renderAuthProbe(); await screen.findByText(TEST_USER.email);
    await userEvent.click(screen.getByRole('button', { name: 'Change password probe' }));
    await userEvent.click(screen.getByRole('button', { name: 'Login probe' }));
    resolve({ status: 204 });
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('CanceledError'));
    expect(screen.getByTestId('user-email')).toHaveTextContent(TEST_USER.email);
    expect(screen.getByTestId('security-completed')).toHaveTextContent('false');
  });
});
