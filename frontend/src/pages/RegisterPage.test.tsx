import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './RegisterPage';

const { registerMock } = vi.hoisted(() => ({
  registerMock: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ register: registerMock }),
}));

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<div>Home destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RegisterPage', () => {
  beforeEach(() => {
    registerMock.mockReset();
  });

  it('rejects passwords shorter than eight characters before calling the API', async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText('Email address'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');

    const form = screen.getByRole('button', { name: 'Create account' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(await screen.findByText('Password must contain at least 8 characters.')).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('submits registration data and navigates home on success', async () => {
    registerMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText('Full name'), 'Test User');
    await user.type(screen.getByLabelText('Email address'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith(
        'user@example.com',
        'secret123',
        'Test User',
      );
    });
    expect(await screen.findByText('Home destination')).toBeInTheDocument();
  });

  it('turns a duplicate-email conflict into a clear user-facing message', async () => {
    registerMock.mockRejectedValue({
      response: { status: 409, data: { detail: 'Email already registered' } },
    });
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText('Email address'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('An account with this email already exists.');
  });

  it('shows the first FastAPI validation message returned in a 422 response', async () => {
    registerMock.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [
            { msg: 'Value error, password is not acceptable' },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText('Email address'), 'user@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Value error, password is not acceptable'),
    ).toBeInTheDocument();
  });
});
