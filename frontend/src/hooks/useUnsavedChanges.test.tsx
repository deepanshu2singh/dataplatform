import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useNavigate,
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnsavedChangesProvider } from '../components/UnsavedChangesProvider';
import {
  useUnsavedChangesController,
  useUnsavedChangesGuard,
} from './useUnsavedChanges';

const MESSAGE = 'You have unsaved work. Leave without saving?';

function GuardedRoot() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function Editor({ dirty = true }: { dirty?: boolean }) {
  const navigate = useNavigate();
  const { allowNextNavigation } = useUnsavedChangesGuard(dirty, MESSAGE);
  const { confirmDiscardChanges } = useUnsavedChangesController();

  return (
    <div>
      <div>Editor</div>
      <button type="button" onClick={() => navigate('/other')}>
        Go elsewhere
      </button>
      <button
        type="button"
        onClick={() => {
          allowNextNavigation();
          navigate('/other');
        }}
      >
        Save and leave
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirmDiscardChanges()) {
            document.body.dataset.confirmedDiscard = 'yes';
          }
        }}
      >
        Confirm external action
      </button>
    </div>
  );
}

function renderEditor({
  dirty = true,
  entries = ['/editor'],
  initialIndex,
}: {
  dirty?: boolean;
  entries?: string[];
  initialIndex?: number;
} = {}) {
  const router = createMemoryRouter(
    [
      {
        element: <GuardedRoot />,
        children: [
          { path: '/editor', element: <Editor dirty={dirty} /> },
          { path: '/other', element: <div>Other destination</div> },
          { path: '/previous', element: <div>Previous destination</div> },
        ],
      },
    ],
    {
      initialEntries: entries,
      initialIndex,
    },
  );

  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}

describe('unsaved changes navigation guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete document.body.dataset.confirmedDiscard;
  });

  it('allows navigation without prompting when the editor is clean', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();

    renderEditor({ dirty: false });
    await user.click(screen.getByRole('button', { name: 'Go elsewhere' }));

    expect(await screen.findByText('Other destination')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('keeps the user on the editor when an in-app navigation is rejected', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Go elsewhere' }));

    expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(screen.queryByText('Other destination')).not.toBeInTheDocument();
  });

  it('continues the blocked navigation after the user confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Go elsewhere' }));

    expect(await screen.findByText('Other destination')).toBeInTheDocument();
  });

  it('also protects browser-history back navigation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderEditor({
      entries: ['/previous', '/editor'],
      initialIndex: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
    expect(screen.getByText('Editor')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(await screen.findByText('Previous destination')).toBeInTheDocument();
  });

  it('protects refresh or tab close through beforeunload while dirty', async () => {
    renderEditor();

    await waitFor(() => {
      const event = new Event('beforeunload', { cancelable: true });
      expect(window.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  it('can explicitly bypass the prompt after a successful save', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();

    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Save and leave' }));

    expect(await screen.findByText('Other destination')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('exposes one shared confirmation gate for non-navigation actions such as logout', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderEditor();
    await user.click(
      screen.getByRole('button', { name: 'Confirm external action' }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
    expect(document.body.dataset.confirmedDiscard).toBeUndefined();

    confirmSpy.mockReturnValue(true);
    await user.click(
      screen.getByRole('button', { name: 'Confirm external action' }),
    );
    expect(document.body.dataset.confirmedDiscard).toBe('yes');
  });
});
