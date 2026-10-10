import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
} from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { UnsavedChangesProvider } from '../components/UnsavedChangesProvider';
import { NotebookPage } from './NotebookPage';

const pythonMocks = vi.hoisted(() => ({
  loadDataset: vi.fn(),
  run: vi.fn(),
  reset: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({
    language,
    value,
    onChange,
  }: {
    language: string;
    value: string;
    onChange?: (value: string) => void;
  }) => (
    <textarea
      aria-label={`${language} editor`}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock('../lib/pythonDatasetBridge', () => ({
  loadPythonDataset: pythonMocks.loadDataset,
}));

vi.mock('../lib/pythonRuntime', () => ({
  PythonRuntime: class MockPythonRuntime {
    run(code: string, dataset: unknown) {
      return pythonMocks.run(code, dataset);
    }

    reset(message?: string) {
      return pythonMocks.reset(message);
    }

    destroy() {
      return pythonMocks.destroy();
    }
  },
}));

const DATASETS = [
  { id: 7, name: 'Sales Data' },
  { id: 8, name: 'Operations Data' },
];

const SAVED_NOTEBOOK = {
  id: 12,
  name: 'Quarterly Analysis',
  description: 'Revenue review',
  content: {
    dataset_id: 7,
    cells: [
      { id: 'md-1', type: 'markdown', content: '# Saved analysis' },
      {
        id: 'sql-1',
        type: 'sql',
        content: 'SELECT product, revenue FROM dataset ORDER BY revenue DESC',
      },
    ],
  },
  owner_id: 1,
  created_at: '2026-10-05T12:00:00Z',
  updated_at: null,
};

const PYTHON_NOTEBOOK = {
  ...SAVED_NOTEBOOK,
  name: 'Python Analysis',
  content: {
    dataset_id: 7,
    cells: [
      {
        id: 'py-1',
        type: 'python',
        content: 'print(df["revenue"].sum())',
      },
    ],
  },
};

const SQL_RESULT = {
  success: true as const,
  columns: ['product', 'revenue'],
  data: [
    { product: 'Laptop', revenue: 3600.49 },
    { product: 'Monitor', revenue: 899.97 },
  ],
  row_count: 2,
  dtypes: { product: 'VARCHAR', revenue: 'DOUBLE' },
  truncated: false,
  limit: 100,
  execution_ms: 4.25,
  error: null,
};

function mockNotebookLoad(
  notebook = SAVED_NOTEBOOK,
  datasets = DATASETS,
) {
  return vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/datasets') {
      return { data: datasets } as never;
    }

    if (url === '/notebooks/12') {
      return { data: notebook } as never;
    }

    throw new Error(`Unexpected GET ${url}`);
  });
}

function GuardedOutlet() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function renderNotebook(path = '/notebooks/12') {
  const router = createMemoryRouter(
    [
      {
        element: <GuardedOutlet />,
        children: [
          { path: '/notebooks/new', element: <NotebookPage /> },
          { path: '/notebooks/:id', element: <NotebookPage /> },
          { path: '/notebooks', element: <div>Notebook list destination</div> },
        ],
      },
    ],
    { initialEntries: [path] },
  );

  return render(<RouterProvider router={router} />);
}

function renderNewNotebook() {
  const router = createMemoryRouter(
    [
      {
        element: <GuardedOutlet />,
        children: [
          { path: '/notebooks/new', element: <NotebookPage /> },
          {
            path: '/notebooks/:id',
            element: <div>Saved notebook destination</div>,
          },
        ],
      },
    ],
    { initialEntries: ['/notebooks/new'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('NotebookPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pythonMocks.loadDataset.mockReset();
    pythonMocks.run.mockReset();
    pythonMocks.reset.mockReset();
    pythonMocks.destroy.mockReset();
  });

  it('loads a saved notebook with its selected dataset and cells', async () => {
    const getSpy = mockNotebookLoad();

    renderNotebook();

    expect(await screen.findByDisplayValue('Quarterly Analysis')).toBeInTheDocument();
    expect(screen.getByLabelText('Notebook description')).toHaveValue('Revenue review');
    expect(screen.getByLabelText('Selected dataset')).toHaveValue('7');
    expect(screen.getByLabelText('markdown editor')).toHaveValue('# Saved analysis');
    expect(screen.getByLabelText('sql editor')).toHaveValue(
      'SELECT product, revenue FROM dataset ORDER BY revenue DESC',
    );

    expect(screen.getAllByRole('button', { name: 'Add cell above' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Add cell below' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete cell' }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Cell 1 type')).toBeInTheDocument();

    expect(getSpy).toHaveBeenCalledWith('/datasets', expect.objectContaining({ signal: expect.any(Object) }));
    expect(getSpy).toHaveBeenCalledWith('/notebooks/12', expect.objectContaining({ signal: expect.any(Object) }));
  });

  it('surfaces a stale saved dataset and prevents SQL execution until a replacement is selected', async () => {
    mockNotebookLoad({
      ...SAVED_NOTEBOOK,
      content: {
        ...SAVED_NOTEBOOK.content,
        dataset_id: 999,
      },
    });

    renderNotebook();

    expect(
      await screen.findByText(/dataset previously selected for this notebook is no longer available/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Selected dataset')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Run SQL' })).toBeDisabled();
    expect(
      screen.getByText('Select a dataset before running this cell.'),
    ).toBeInTheDocument();
  });

  it('executes SQL through the bounded SQL endpoint and renders the result', async () => {
    mockNotebookLoad();
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: SQL_RESULT });
    const user = userEvent.setup();

    renderNotebook();

    await screen.findByDisplayValue('Quarterly Analysis');
    await user.click(screen.getByRole('button', { name: 'Run SQL' }));

    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('Monitor')).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledWith('/sql/query', {
      query: 'SELECT product, revenue FROM dataset ORDER BY revenue DESC',
      dataset_id: 7,
      limit: 100,
    });
  });

  it('saves an existing notebook with trimmed metadata and persisted cell definitions only', async () => {
    mockNotebookLoad();
    const putSpy = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        ...SAVED_NOTEBOOK,
        name: 'Renamed Notebook',
        description: 'Updated description',
      },
    });
    const user = userEvent.setup();

    renderNotebook();

    const name = await screen.findByLabelText('Notebook name');
    await user.clear(name);
    await user.type(name, '  Renamed Notebook  ');

    const description = screen.getByLabelText('Notebook description');
    await user.clear(description);
    await user.type(description, '  Updated description  ');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));

    const [url, payload] = putSpy.mock.calls[0] as [string, any];
    expect(url).toBe('/notebooks/12');
    expect(payload.name).toBe('Renamed Notebook');
    expect(payload.description).toBe('Updated description');
    expect(payload.content.dataset_id).toBe(7);
    expect(payload.content.cells).toEqual([
      { id: 'md-1', type: 'markdown', content: '# Saved analysis' },
      {
        id: 'sql-1',
        type: 'sql',
        content: 'SELECT product, revenue FROM dataset ORDER BY revenue DESC',
      },
    ]);
    expect(screen.getByDisplayValue('Renamed Notebook')).toBeInTheDocument();
  });

  it('creates a new notebook with the first available dataset and navigates to the saved notebook', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: DATASETS });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        ...SAVED_NOTEBOOK,
        id: 44,
        name: 'Fresh Notebook',
      },
    });
    const user = userEvent.setup();

    renderNewNotebook();

    const name = await screen.findByLabelText('Notebook name');
    expect(screen.getByLabelText('Selected dataset')).toHaveValue('7');

    await user.clear(name);
    await user.type(name, 'Fresh Notebook');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0][0]).toBe('/notebooks');
    expect((postSpy.mock.calls[0][1] as any).content.dataset_id).toBe(7);
    expect(await screen.findByText('Saved notebook destination')).toBeInTheDocument();
  });

  it('protects unsaved changes when leaving the notebook', async () => {
    mockNotebookLoad();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderNotebook();

    const name = await screen.findByLabelText('Notebook name');
    await user.type(name, ' changed');
    await user.click(screen.getByRole('button', { name: 'All Notebooks' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unsaved notebook changes. Leave without saving?',
    );
    expect(screen.queryByText('Notebook list destination')).not.toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'All Notebooks' }));
    expect(await screen.findByText('Notebook list destination')).toBeInTheDocument();
  });

  it('runs Python with the selected dataset and resets Python state when the dataset changes', async () => {
    mockNotebookLoad(PYTHON_NOTEBOOK);
    pythonMocks.loadDataset.mockResolvedValue({
      id: 7,
      name: 'Sales Data',
      csvText: 'revenue\n100\n200\n',
      sourceRowCount: 2,
      loadedRowCount: 2,
      truncated: false,
      rowLimit: 10_000,
    });
    pythonMocks.run.mockResolvedValue({
      success: true,
      stdout: '300\n',
      stderr: '',
      result: '',
      error: null,
      executionMs: 12.5,
      outputTruncated: false,
    });
    const user = userEvent.setup();

    renderNotebook();

    await screen.findByDisplayValue('Python Analysis');
    expect(
      screen.getByText(/not a security sandbox for untrusted code/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run Python' }));

    expect(await screen.findByText('300')).toBeInTheDocument();
    expect(pythonMocks.loadDataset).toHaveBeenCalledWith(7);
    expect(pythonMocks.run).toHaveBeenCalledWith(
      'print(df["revenue"].sum())',
      expect.objectContaining({ id: 7, name: 'Sales Data' }),
    );

    await user.selectOptions(screen.getByLabelText('Selected dataset'), '8');

    expect(pythonMocks.reset).toHaveBeenCalledWith(
      'Python runtime reset because the selected dataset changed.',
    );
    expect(
      await screen.findByText('Python runtime reset because the selected dataset changed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('300')).not.toBeInTheDocument();
  });
});
