import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrivacyLink } from './PrivacyLink';
describe('privacy link', () => {
  it('opens a public new tab without routing context, private query data or draft loss', () => {
    render(<form><label>Draft name<input defaultValue="Unsaved name" /></label><PrivacyLink /></form>);
    const link = screen.getByRole('link', { name: 'Privacy notice (opens in a new tab)' });
    expect(link).toHaveAttribute('href', '/privacy'); expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer'); fireEvent.click(link);
    expect(screen.getByLabelText('Draft name')).toHaveValue('Unsaved name');
  });
});
