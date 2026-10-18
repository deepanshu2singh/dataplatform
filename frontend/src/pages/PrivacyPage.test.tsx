import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../components/ThemeProvider';
import { PrivacyPage } from './PrivacyPage';
import { PRIVACY_EMAIL, PRIVACY_VERSION } from '../lib/privacy';
function notice() { render(<MemoryRouter><ThemeProvider><PrivacyPage /></ThemeProvider></MemoryRouter>); }
describe('public privacy notice', () => {
  it('identifies the operator, rights and actual current controls', () => {
    notice(); expect(screen.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeInTheDocument();
    expect(screen.getByText(/operates Data Platform personally from the United Kingdom/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(PRIVACY_VERSION))).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your right to object' })).toBeInTheDocument();
    expect(screen.getByText(/Self-service account deletion and scheduled/)).toHaveTextContent('not yet running');
    expect(document.title).toBe('Privacy notice | Data Platform');
    expect(screen.getAllByRole('link', { name: PRIVACY_EMAIL }).every(x => x.getAttribute('href')?.startsWith('mailto:'))).toBe(true);
  });
  it('connects contents to labelled sections without future cleanup guarantees', () => {
    notice(); for (const link of within(screen.getByRole('navigation', { name: 'Privacy notice contents' })).getAllByRole('link')) {
      const section = document.getElementById(link.getAttribute('href')!.slice(1)); expect(section).not.toBeNull();
      expect(document.getElementById(section!.getAttribute('aria-labelledby')!)).not.toBeNull();
    }
    expect(screen.getByRole('main').textContent).not.toMatch(/delete.{0,40}within 7 days|GDPR certified/);
  });
  it('offers the real remember control on the public page', async () => {
    const user = userEvent.setup(); notice(); const checkbox = screen.getByRole('checkbox', { name: 'Remember appearance in this browser' });
    expect(checkbox).not.toBeChecked();
    await user.selectOptions(within(screen.getByRole('region', { name: 'Browser storage and your choices' })).getByLabelText('Appearance'), 'dark');
    expect(localStorage.getItem('dataplatform-theme')).toBeNull(); await user.click(checkbox);
    expect(localStorage.getItem('dataplatform-theme')).toBe('dark'); await user.click(checkbox);
    expect(localStorage.getItem('dataplatform-theme')).toBeNull(); expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
