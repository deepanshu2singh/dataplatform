import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useNavigate,
} from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { UnsavedChangesProvider } from '../components/UnsavedChangesProvider';
import { DashboardsPage } from './DashboardsPage';

const DATASETS = [
  {
    id: 7,
    name: 'Sales Data',
    description: 'Sales rows',
    type: 'file',
  },
  {
    id: 99,
    name: 'Non-file source',
    description: null,
    type: 'database',
  },
];

const TABLE_WIDGET = {
  id: 'sales-table',
  type: 'table' as const,
  title: 'Sales Table',
  config: {},
  position: { x: 0, y: 0, w: 600, h: 360 },
  source: {
    dataset_id: 7,
    notebook_id: null,
    query: 'SELECT product, revenue FROM dataset',
    limit: 100,
  },
};

const DASHBOARD = {
  id: 2,
  name: 'Sales Dashboard',
  description: 'Revenue reporting',
  layout: {
    version: 1 as const,
    widgets: [TABLE_WIDGET],
  },
  owner_id: 1,
  is_public: false,
  created_at: '2026-10-05T12:00:00Z',
  updated_at: null,
  reference_issues: [] as Array<{
    widget_id: string;
    reference_type: 'widget' | 'dataset' | 'notebook';
    reference_id: number | null;
    message: string;
  }>,
};

const TABLE_RESULT = {
  dashboard_id: 2,
  widget_id: 'sales-table',
  widget_type: 'table' as const,
  dataset_id: 7,
  dataset_name: 'Sales Data',
  columns: ['product', 'revenue'],
  data: [
    { product: 'Laptop', revenue: 3600.49 },
    { product: 'Monitor', revenue: 899.97 },
  ],
  row_count: 2,
  dtypes: { product: 'VARCHAR', revenue: 'DOUBLE' },
  truncated: false,
  limit: 100,
  execution_ms: 3.4,
  visualization: {
    kind: 'table' as const,
    display_columns: ['product', 'revenue'],
  },
};

function GuardedOutlet({ controls = false }: { controls?: boolean }) {
  return (
    <UnsavedChangesProvider>
      {controls && <BuilderRouteControls />}
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function renderManager() {
  const router = createMemoryRouter(
    [
      {
        element: <GuardedOutlet />,
        children: [
          { path: '/dashboards', element: <DashboardsPage /> },
          { path: '/dashboards/new', element: <div>New dashboard destination</div> },
          {
            path: '/dashboards/:id/view',
            element: <div>Viewer destination</div>,
          },
        ],
      },
    ],
    { initialEntries: ['/dashboards'] },
  );

  return render(<RouterProvider router={router} />);
}

function renderBuilder(path = '/dashboards/2') {
  const router = createMemoryRouter(
    [
      {
        element: <GuardedOutlet />,
        children: [
          { path: '/dashboards', element: <div>Dashboard list destination</div> },
          { path: '/dashboards/:id', element: <DashboardsPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );

  return render(<RouterProvider router={router} />);
}

function BuilderRouteControls() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/dashboards/new')}>
      Go to new dashboard
    </button>
  );
}

function renderBuilderWithRouteControls() {
  const router = createMemoryRouter(
    [
      {
        element: <GuardedOutlet controls />,
        children: [
          { path: '/dashboards/:id', element: <DashboardsPage /> },
        ],
      },
    ],
    { initialEntries: ['/dashboards/2'] },
  );

  return render(<RouterProvider router={router} />);
}

function mockBuilderGets(dashboard = DASHBOARD) {
  return vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/datasets') {
      return { data: DATASETS } as never;
    }

    if (url === '/dashboards/2') {
      return { data: dashboard } as never;
    }

    throw new Error(`Unexpected GET ${url}`);
  });
}

describe('DashboardsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads dashboard cards and deletes only after confirmation', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [DASHBOARD] });
    const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ data: null });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderManager();

    expect(await screen.findByText('Sales Dashboard')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Sales Dashboard' }));
    expect(deleteSpy).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete Sales Dashboard' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('/dashboards/2'));
    expect(await screen.findByText('No dashboards yet')).toBeInTheDocument();
  });

  it('loads an existing dashboard and executes its saved data widget', async () => {
    mockBuilderGets();
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: TABLE_RESULT });

    renderBuilder();

    expect(await screen.findByDisplayValue('Sales Dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('Monitor')).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledWith(
      '/dashboards/2/widgets/sales-table/execute',
      undefined,
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  it('adds and edits a table widget in a new dashboard, then previews it through the unsaved preview endpoint', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: DATASETS });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        ...TABLE_RESULT,
        dashboard_id: null,
        widget_id: 'new-widget',
      },
    });
    const user = userEvent.setup();

    renderBuilder('/dashboards/new');

    expect(await screen.findByDisplayValue('Untitled Dashboard')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Widget' }));
    expect(
      screen.getByRole('dialog', { name: 'Add Widget' }),
    ).toBeInTheDocument();

    const tableOption = screen.getByRole('button', {
      name: /Show bounded SQL rows and columns/i,
    });
    expect(tableOption).toHaveFocus();
    await user.click(tableOption);

    expect(
      await screen.findByRole('dialog', { name: 'Edit Table Widget' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Dataset')).toHaveValue('7');

    const title = screen.getByLabelText('Widget title');
    await user.clear(title);
    await user.type(title, 'Revenue Table');

    const query = screen.getByLabelText('SQL query');
    await user.clear(query);
    await user.type(query, 'SELECT product, revenue FROM dataset');

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const previewLaptopCells = await screen.findAllByText('Laptop');
    expect(previewLaptopCells.length).toBeGreaterThan(0);
    expect(postSpy).toHaveBeenCalledWith(
      '/dashboards/widgets/preview',
      expect.objectContaining({
        widget: expect.objectContaining({
          type: 'table',
          title: 'Revenue Table',
          source: expect.objectContaining({
            dataset_id: 7,
            query: 'SELECT product, revenue FROM dataset',
          }),
        }),
      }),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  it('saves an existing dashboard as private with normalized layout positions', async () => {
    mockBuilderGets();
    vi.spyOn(api, 'post').mockResolvedValue({ data: TABLE_RESULT });
    const putSpy = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        ...DASHBOARD,
        name: 'Renamed Dashboard',
        description: 'Updated description',
      },
    });
    const user = userEvent.setup();

    renderBuilder();

    const name = await screen.findByDisplayValue('Sales Dashboard');
    await user.clear(name);
    await user.type(name, '  Renamed Dashboard  ');

    const description = screen.getByPlaceholderText('Add a dashboard description (optional)');
    await user.clear(description);
    await user.type(description, '  Updated description  ');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const [url, payload] = putSpy.mock.calls[0] as [string, any];

    expect(url).toBe('/dashboards/2');
    expect(payload.name).toBe('Renamed Dashboard');
    expect(payload.description).toBe('Updated description');
    expect(payload.is_public).toBe(false);
    expect(payload.layout.version).toBe(1);
    expect(payload.layout.widgets[0].position).toMatchObject({ x: 0, y: 0 });
    expect(await screen.findByText('Dashboard saved.')).toBeInTheDocument();
  });

  it('shows stale reference information while isolating a failed saved-widget execution', async () => {
    mockBuilderGets({
      ...DASHBOARD,
      reference_issues: [
        {
          widget_id: 'sales-table',
          reference_type: 'dataset' as const,
          reference_id: 7,
          message: 'Dataset 7 is no longer available.',
        },
      ],
    });
    vi.spyOn(api, 'post').mockRejectedValue({
      response: { data: { detail: 'Dataset reference is stale' } },
    });

    renderBuilder();

    expect(
      await screen.findByText('This dashboard has 1 stale reference.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Dataset 7 is no longer available.').length).toBeGreaterThan(0);
    expect(await screen.findByText('Dataset reference is stale')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sales Dashboard')).toBeInTheDocument();
  });


  it('resets builder state when navigating from an existing dashboard to a new dashboard', async () => {
    mockBuilderGets();
    vi.spyOn(api, 'post').mockResolvedValue({ data: TABLE_RESULT });
    const user = userEvent.setup();

    renderBuilderWithRouteControls();

    expect(await screen.findByDisplayValue('Sales Dashboard')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to new dashboard' }));

    expect(await screen.findByDisplayValue('Untitled Dashboard')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Sales Dashboard')).not.toBeInTheDocument();
  });

  it('protects unsaved dashboard changes when leaving the builder', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: DATASETS });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderBuilder('/dashboards/new');

    const name = await screen.findByDisplayValue('Untitled Dashboard');
    await user.type(name, ' changed');
    await user.click(screen.getByRole('button', { name: 'Back to dashboards' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unsaved dashboard changes. Leave without saving?',
    );
    expect(screen.queryByText('Dashboard list destination')).not.toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Back to dashboards' }));
    expect(await screen.findByText('Dashboard list destination')).toBeInTheDocument();
  });
});
