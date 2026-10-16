import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createMemoryRouter,
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUnsavedChangesGuard } from '../hooks/useUnsavedChanges';
import { Layout } from './Layout';
import { UnsavedChangesProvider } from './UnsavedChangesProvider';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      email: 'user@example.com',
      full_name: 'Test User',
      is_active: true,
      is_superuser: false,
    },
    logout: authMocks.logout,
  }),
}));

const MESSAGE = 'You have unsaved notebook changes. Leave without saving?';

function DirtyEditor() {
  useUnsavedChangesGuard(true, MESSAGE);
  return <div>Dirty editor</div>;
}

function renderDirtyLayout() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <div>Login destination</div> },
      {
        element: (
          <UnsavedChangesProvider>
            <Layout />
          </UnsavedChangesProvider>
        ),
        children: [
          { path: '/', element: <div>Home destination</div> },
          { path: '/notebooks/12', element: <DirtyEditor /> },
        ],
      },
    ],
    { initialEntries: ['/notebooks/12'] },
  );

  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}

describe('Layout unsaved-work integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authMocks.logout.mockReset();
    authMocks.logout.mockResolvedValue(undefined);
  });


  it('exposes named navigation controls and a skip link', () => {
    renderDirtyLayout();

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main-content');
    expect(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open navigation menu' }),
    ).toHaveAttribute('aria-controls', 'primary-navigation');
    expect(
      screen.getByRole('button', { name: 'Close navigation menu' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('lets the shared route blocker protect sidebar navigation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderDirtyLayout();
    await user.click(screen.getByRole('link', { name: 'Home' }));

    expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
    expect(screen.getByText('Dirty editor')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByText('Home destination')).toBeInTheDocument();
  });

  it('keeps unsaved-work protection when the new brand link is used', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderDirtyLayout();
    await user.click(screen.getByRole('link', { name: 'Data Platform home' }));
    expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
    expect(screen.getByText('Dirty editor')).toBeInTheDocument();
    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('link', { name: 'Data Platform home' }));
    expect(await screen.findByText('Home destination')).toBeInTheDocument();
  });

  it('does not destroy the session when logout is rejected because work is unsaved', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderDirtyLayout();
    await user.click(screen.getByRole('button', { name: 'Logout' }));

    expect(authMocks.logout).not.toHaveBeenCalled();
    expect(screen.getByText('Dirty editor')).toBeInTheDocument();
  });

  it('restores navigation protection when a confirmed logout request fails', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    authMocks.logout.mockRejectedValueOnce(new Error('network failure'));
    const user = userEvent.setup();

    renderDirtyLayout();
    await user.click(screen.getByRole('button', { name: 'Logout' }));

    expect(authMocks.logout).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText('Logout failed. Please try again.'),
    ).toBeInTheDocument();

    confirmSpy.mockClear();
    confirmSpy.mockReturnValue(false);

    await user.click(screen.getByRole('link', { name: 'Home' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(MESSAGE));
    expect(screen.getByText('Dirty editor')).toBeInTheDocument();
  });
});
