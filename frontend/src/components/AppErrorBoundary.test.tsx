import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenChild(): never {
  throw new Error('render-secret-that-must-not-be-shown');
}

describe('AppErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally when there is no rendering failure', () => {
    render(
      <AppErrorBoundary>
        <div>Healthy page</div>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('Healthy page')).toBeInTheDocument();
  });

  it('shows a safe recovery screen without exposing the thrown error value', () => {
    render(
      <AppErrorBoundary>
        <BrokenChild />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByRole('alert'),
    ).toHaveTextContent('This page ran into an unexpected problem');
    expect(screen.getByRole('button', { name: 'Reload application' })).toBeInTheDocument();
    expect(
      screen.getByText(/Reload the application and try again/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/server data has not been changed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/render-secret-that-must-not-be-shown/i)).not.toBeInTheDocument();
  });
});
