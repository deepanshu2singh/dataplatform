import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { HomePage } from './HomePage';

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
  it('links each quick action to a real application route', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

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

  it('describes Python as browser-side without claiming security isolation', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getAllByText(/browser-side Python/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/browser-isolated Python/i)).not.toBeInTheDocument();
  });
});
