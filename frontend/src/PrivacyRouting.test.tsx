import { act, render, screen } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { createBrowserRouter } from 'react-router-dom';
const captured = vi.hoisted(() => ({ router: null as ReturnType<typeof createBrowserRouter> | null }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, createBrowserRouter: (...args: Parameters<typeof createBrowserRouter>) => {
    const router = actual.createBrowserRouter(...args); captured.router = router; return router;
  } };
});
import App from './App';
import { ThemeProvider } from './components/ThemeProvider';
import { api } from './lib/api';
const account = { id: 42, email: 'private@example.com', full_name: 'Private name', is_active: true, is_superuser: false, email_verified: true, email_verification_required: true };
const router = captured.router!;
afterAll(() => router.dispose());
describe('actual application privacy route', () => {
  it.each(['signed out','verified','unverified','auth failure'])('is public for %s', async (mode) => {
    vi.spyOn(api, 'get').mockImplementation(async () => {
      if (mode === 'signed out') throw { response: { status: 401 } };
      if (mode === 'auth failure') throw { response: { status: 503 } };
      return { data: { ...account, email_verified: mode === 'verified' } };
    });
    await act(async () => { await router.navigate('/privacy'); }); render(<ThemeProvider><App /></ThemeProvider>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy notice' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/privacy'); expect(screen.queryByText(account.email)).not.toBeInTheDocument();
    expect(screen.queryByText(account.full_name)).not.toBeInTheDocument();
  });
});
