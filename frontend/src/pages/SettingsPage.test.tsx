import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingsPage } from './SettingsPage';

const authMocks = vi.hoisted(() => ({
  user: {
    id: 1,
    email: 'user@example.com',
    full_name: 'Test User',
    is_active: true,
    is_superuser: false,
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: authMocks.user }),
}));

describe('SettingsPage', () => {
  it('shows account data as read-only instead of simulating profile saves', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('textbox', { name: 'Full Name' })).toHaveValue(
      'Test User',
    );
    expect(screen.getByRole('textbox', { name: 'Full Name' })).toHaveAttribute(
      'readonly',
    );
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue(
      'user@example.com',
    );
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute(
      'readonly',
    );
    expect(
      screen.getByText(/Profile editing is not available in this V1 interface/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });

  it('supports keyboard navigation across settings tabs', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    const profileTab = screen.getByRole('tab', { name: 'Profile' });
    profileTab.focus();

    await user.keyboard('{ArrowRight}');

    const securityTab = screen.getByRole('tab', { name: 'Security' });
    expect(securityTab).toHaveFocus();
    expect(securityTab).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('tabpanel', { name: 'Security' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Password management')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Current Password'),
    ).not.toBeInTheDocument();
  });

  it('does not present notification preferences as working controls', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole('tab', { name: 'Notifications' }));

    expect(screen.getByText('Notification preferences')).toBeInTheDocument();
    expect(
      screen.getByText(/No notification preference shown here is persisted or applied/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('states that destructive and retention controls are unavailable', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole('tab', { name: 'Data' }));

    expect(screen.getByText('Retention controls')).toBeInTheDocument();
    expect(screen.getByText('Data export')).toBeInTheDocument();
    expect(screen.getByText('Account deletion')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete account/i }),
    ).not.toBeInTheDocument();
  });
});
