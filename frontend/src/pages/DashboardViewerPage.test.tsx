import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { DashboardViewerPage } from './DashboardViewerPage';

const TABLE_WIDGET = {
  id: 'sales-table',
  type: 'table' as const,
  title: 'Sales Table',
  config: {},
  position: { x: 0, y: 0, w: 600, h: 300 },
  source: {
    dataset_id: 7,
    notebook_id: null,
    query: 'SELECT product, revenue FROM dataset',
    limit: 100,
  },
};

const MARKDOWN_WIDGET = {
  id: 'notes',
  type: 'markdown' as const,
  title: 'Notes',
  config: {
    markdown: '# Revenue notes\n<img src=x onerror="alert(1)">',
  },
  position: { x: 0, y: 1, w: 600, h: 260 },
  source: null,
};

const DASHBOARD = {
  id: 2,
  name: 'Sales Dashboard',
  description: 'Read-only sales reporting',
  layout: {
    version: 1 as const,
    widgets: [TABLE_WIDGET, MARKDOWN_WIDGET],
  },
  owner_id: 1,
  is_public: false,
  created_at: '2026-10-05T12:00:00Z',
  updated_at: null,
  reference_issues: [],
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
  dtypes: { product: 'object', revenue: 'float64' },
  truncated: false,
  limit: 100,
  execution_ms: 4.2,
  visualization: {
    kind: 'table' as const,
    display_columns: ['product', 'revenue'],
  },
};

function renderViewer(path = '/dashboards/2/view') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboards/:id/view" element={<DashboardViewerPage />} />
        <Route path="/dashboards" element={<div>Dashboard list destination</div>} />
        <Route path="/dashboards/:id" element={<div>Dashboard editor destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DashboardViewerPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an invalid dashboard ID without calling the API', async () => {
    const getSpy = vi.spyOn(api, 'get');

    renderViewer('/dashboards/not-a-number/view');

    expect(await screen.findByText('Dashboard unavailable')).toBeInTheDocument();
    expect(screen.getByText('Invalid dashboard ID.')).toBeInTheDocument();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('loads the dashboard, executes data widgets, and renders markdown as text', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: DASHBOARD });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: TABLE_RESULT });

    renderViewer();

    expect(await screen.findByRole('heading', { name: 'Sales Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('Monitor')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Revenue notes' })).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      '/dashboards/2/widgets/sales-table/execute',
      undefined,
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  it('shows stale references and skips execution for the affected widget', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        ...DASHBOARD,
        layout: { version: 1, widgets: [TABLE_WIDGET] },
        reference_issues: [
          {
            widget_id: 'sales-table',
            reference_type: 'dataset',
            reference_id: 7,
            message: 'Dataset 7 is no longer available.',
          },
        ],
      },
    });
    const postSpy = vi.spyOn(api, 'post');

    renderViewer();

    expect(
      await screen.findByText('Some dashboard data sources are no longer available.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Dataset 7 is no longer available.').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'This widget cannot run until its missing reference is repaired in the dashboard editor.',
      ),
    ).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('isolates a widget execution error and can retry only that widget', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        ...DASHBOARD,
        layout: { version: 1, widgets: [TABLE_WIDGET] },
      },
    });
    const postSpy = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce({
        response: { data: { detail: 'Column does_not_exist was not found' } },
      })
      .mockResolvedValueOnce({ data: TABLE_RESULT });
    const user = userEvent.setup();

    renderViewer();

    expect(
      await screen.findByText('Column does_not_exist was not found'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Widget' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry Widget' }));

    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('shows a dashboard loading failure without attempting widget execution', async () => {
    vi.spyOn(api, 'get').mockRejectedValue({
      response: { data: { detail: 'Dashboard not found' } },
    });
    const postSpy = vi.spyOn(api, 'post');

    renderViewer();

    expect(await screen.findByText('Dashboard unavailable')).toBeInTheDocument();
    expect(screen.getByText('Dashboard not found')).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });
});
