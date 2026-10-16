import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomePage } from './HomePage';
import { api } from '../lib/api';
import userEvent from '@testing-library/user-event';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      email: 'user@example.com',
      full_name: 'Test User',
      is_active: true,
      is_superuser: false,
    },
  }),
}));

describe('HomePage', () => {
  it('shows actual recent notebook links in newest-first order', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: [
      { id: 4, name: 'Older', description: null, created_at: '2026-10-01T12:00:00Z', updated_at: null },
      { id: 8, name: 'Newer', description: 'Latest work', created_at: '2026-10-02T12:00:00Z', updated_at: null },
    ] });
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const newer = await screen.findByRole('link', { name: /Newer/ });
    expect(newer).toHaveAttribute('href', '/notebooks/8');
    const older = screen.getByRole('link', { name: /Older/ });
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/notebooks', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('keeps actions available after a load failure and retries the read', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(Error('offline'));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: /New Notebook/ })).toHaveAttribute('href', '/notebooks/new');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry recent notebooks' }));
    await screen.findByText('Your next analysis starts here');
  });

  beforeEach(() => { vi.spyOn(api, 'get').mockResolvedValue({ data: [] }); });
  it('links each quick action to a real application route', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await screen.findByText('Your next analysis starts here');
    expect(screen.getByRole('link', { name: /New Notebook/i })).toHaveAttribute(
      'href',
      '/notebooks/new',
    );
    expect(screen.getByRole('link', { name: /Upload Dataset/i })).toHaveAttribute(
      'href',
      '/datasets',
    );
    expect(screen.getByRole('link', { name: /New Dashboard/i })).toHaveAttribute(
      'href',
      '/dashboards/new',
    );
  });

  it('describes Python as browser-side without claiming security isolation', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await screen.findByText('Your next analysis starts here');
    expect(screen.getAllByText(/browser-side Python/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/browser-isolated Python/i)).not.toBeInTheDocument();
  });
});
