import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { NotebooksPage } from './NotebooksPage';

const NOTEBOOK = {
  id: 11,
  name: 'Revenue Analysis',
  description: 'Monthly revenue notebook',
  content: {
    dataset_id: 7,
    cells: [
      { id: 'sql-1', type: 'sql', content: 'SELECT * FROM dataset' },
      { id: 'py-1', type: 'python', content: 'df.head()' },
    ],
  },
  owner_id: 1,
  created_at: '2026-10-05T12:00:00Z',
  updated_at: null,
};

const DATASETS = [{ id: 7, name: 'Sales Data' }];

function renderPage() {
  return render(
    <MemoryRouter>
      <NotebooksPage />
    </MemoryRouter>,
  );
}

function mockInitialLoad(notebooks = [NOTEBOOK], datasets = DATASETS) {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/notebooks') {
      return { data: notebooks };
    }
    if (url === '/datasets') {
      return { data: datasets };
    }
    throw new Error(`Unexpected GET ${String(url)}`);
  });
}

describe('NotebooksPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads saved notebooks and resolves their dataset labels', async () => {
    mockInitialLoad([
      NOTEBOOK,
      {
        ...NOTEBOOK,
        id: 12,
        name: 'Stale Notebook',
        content: { dataset_id: 999, cells: [] },
      },
    ]);

    renderPage();

    expect(await screen.findByText('Revenue Analysis')).toBeInTheDocument();
    expect(screen.getByText('Sales Data')).toBeInTheDocument();
    expect(screen.getByText('Dataset unavailable')).toBeInTheDocument();
    expect(screen.getByText('Stale Notebook')).toBeInTheDocument();
  });

  it('renames a notebook with a trimmed name', async () => {
    mockInitialLoad();
    const putSpy = vi.spyOn(api, 'put').mockResolvedValue({
      data: { ...NOTEBOOK, name: 'Renamed Notebook' },
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Revenue Analysis');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(
      screen.getByRole('dialog', { name: 'Rename notebook' }),
    ).toBeInTheDocument();
    const input = screen.getByLabelText('Notebook name');
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, '  Renamed Notebook  ');
    await user.click(screen.getByRole('button', { name: 'Save Name' }));

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledWith('/notebooks/11', {
        name: 'Renamed Notebook',
      });
    });
    expect(await screen.findByText('Renamed Notebook')).toBeInTheDocument();
  });

  it('does not delete without confirmation and removes the notebook after confirmation', async () => {
    mockInitialLoad();
    const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ data: null });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Revenue Analysis');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteSpy).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('/notebooks/11');
    });
    expect(await screen.findByText('No saved notebooks yet')).toBeInTheDocument();
  });

  it('shows a server-provided loading error', async () => {
    vi.spyOn(api, 'get').mockRejectedValue({
      response: { data: { detail: 'Notebook service unavailable' } },
    });

    renderPage();

    expect(await screen.findByText('Notebook service unavailable')).toBeInTheDocument();
  });
});
