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
};

function AuthProbe() {
  const auth = useAuth();
  const [error, setError] = useState('');

  return (
    <div>
      <div data-testid="loading">{String(auth.loading)}</div>
      <div data-testid="user-email">{auth.user?.email ?? 'none'}</div>
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
});
