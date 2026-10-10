import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Clock3,
  Database,
  Edit3,
  FileText,
  Gauge,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Table2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import {
  isCanceledRequest,
  useLatestKeyedRequests,
  useLatestRequest,
} from '../hooks/useLatestRequest';

type WidgetType = 'chart' | 'table' | 'markdown' | 'metric';
type MetricFormat = 'number' | 'currency' | 'percent' | 'text';

interface DashboardPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DashboardDataSource {
  dataset_id: number;
  notebook_id?: number | null;
  query: string;
  limit: number;
}

interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  position: DashboardPosition;
  source?: DashboardDataSource | null;
}

interface DashboardLayout {
  version: 1;
  widgets: DashboardWidget[];
}

interface ReferenceIssue {
  widget_id: string;
  reference_type: 'widget' | 'dataset' | 'notebook';
  reference_id: number | null;
  message: string;
}

interface Dashboard {
  id: number;
  name: string;
  description: string | null;
  layout: DashboardLayout;
  owner_id: number;
  is_public: boolean;
  created_at: string;
  updated_at: string | null;
  reference_issues: ReferenceIssue[];
}

interface WidgetVisualization {
  kind: 'table' | 'metric' | 'bar' | 'line' | 'pie' | 'donut';
  x_column?: string | null;
  y_column?: string | null;
  series_column?: string | null;
  value_column?: string | null;
  metric_value?: unknown;
  format?: MetricFormat | null;
  decimals?: number | null;
  prefix?: string | null;
  suffix?: string | null;
  display_columns?: string[] | null;
  show_legend?: boolean | null;
}

interface WidgetDataResponse {
  dashboard_id: number | null;
  widget_id: string;
  widget_type: 'chart' | 'table' | 'metric';
  dataset_id: number;
  dataset_name: string;
  columns: string[];
  data: Record<string, unknown>[];
  row_count: number;
  dtypes: Record<string, string>;
  truncated: boolean;
  limit: number;
  execution_ms: number;
  visualization: WidgetVisualization;
}

interface WidgetRuntimeState {
  loading: boolean;
  data: WidgetDataResponse | null;
  error: string;
}

const EMPTY_RUNTIME: WidgetRuntimeState = {
  loading: false,
  data: null,
  error: '',
};

export function DashboardViewerPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [runtime, setRuntime] = useState<Record<string, WidgetRuntimeState>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

  const dashboardLoadRequest = useLatestRequest();
  const refreshBatchRequest = useLatestRequest();
  const widgetRequests = useLatestKeyedRequests();

  const dashboardId = useMemo(() => {
    const numericId = Number(id);
    return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
  }, [id]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const executeWidget = useCallback(
    async (numericDashboardId: number, widget: DashboardWidget) => {
      if (widget.type === 'markdown') {
        return true;
      }

      const request = widgetRequests.begin(widget.id);
      setRuntime((current) => ({
        ...current,
        [widget.id]: {
          loading: true,
          data: current[widget.id]?.data ?? null,
          error: '',
        },
      }));

      try {
        const response = await api.post<WidgetDataResponse>(
          `/dashboards/${numericDashboardId}/widgets/${encodeURIComponent(widget.id)}/execute`,
          undefined,
          { signal: request.signal },
        );

        if (!request.isCurrent()) {
          return false;
        }

        setRuntime((current) => ({
          ...current,
          [widget.id]: {
            loading: false,
            data: response.data,
            error: '',
          },
        }));
        return true;
      } catch (error: unknown) {
        if (!request.isCurrent() || isCanceledRequest(error)) {
          return false;
        }
        setRuntime((current) => ({
          ...current,
          [widget.id]: {
            loading: false,
            data: null,
            error: getApiErrorMessage(error, 'Widget execution failed.'),
          },
        }));
        return false;
      } finally {
        request.finish();
      }
    },
    [widgetRequests],
  );

  const refreshWidgets = useCallback(
    async (nextDashboard: Dashboard) => {
      const batch = refreshBatchRequest.begin();
      widgetRequests.cancelAll();
      const staleWidgetIds = new Set(
        nextDashboard.reference_issues.map((issue) => issue.widget_id),
      );
      const dataWidgets = nextDashboard.layout.widgets.filter(
        (widget) =>
          widget.type !== 'markdown' && !staleWidgetIds.has(widget.id),
      );

      if (dataWidgets.length === 0) {
        if (batch.isCurrent()) {
          setLastRefreshedAt(new Date());
          setRefreshingAll(false);
        }
        batch.finish();
        return;
      }

      setRefreshingAll(true);
      await Promise.allSettled(
        dataWidgets.map((widget) => executeWidget(nextDashboard.id, widget)),
      );

      if (batch.isCurrent()) {
        setLastRefreshedAt(new Date());
        setRefreshingAll(false);
      }
      batch.finish();
    },
    [executeWidget, refreshBatchRequest, widgetRequests],
  );

  const loadDashboard = useCallback(async () => {
    const request = dashboardLoadRequest.begin();
    refreshBatchRequest.cancel();
    widgetRequests.cancelAll();
    setRefreshingAll(false);

    if (!dashboardId) {
      setDashboard(null);
      setPageError('Invalid dashboard ID.');
      setLoading(false);
      request.finish();
      return;
    }

    setLoading(true);
    setPageError('');
    setRuntime({});

    try {
      const response = await api.get<Dashboard>(`/dashboards/${dashboardId}`, {
        signal: request.signal,
      });

      if (!request.isCurrent()) {
        return;
      }

      setDashboard(response.data);
      await refreshWidgets(response.data);
    } catch (error: unknown) {
      if (!request.isCurrent() || isCanceledRequest(error)) {
        return;
      }
      setDashboard(null);
      setPageError(getApiErrorMessage(error, 'Failed to load dashboard.'));
    } finally {
      if (request.isCurrent()) {
        setLoading(false);
      }
      request.finish();
    }
  }, [dashboardId, dashboardLoadRequest, refreshBatchRequest, refreshWidgets, widgetRequests]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setPageError('Fullscreen mode is not available in this browser window.');
    }
  };

  if (loading) {
    return (
      <ViewerShell>
        <div className="flex min-h-[70vh] items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
          <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
          <span>Loading dashboard and widget data...</span>
        </div>
      </ViewerShell>
    );
  }

  if (!dashboard) {
    return (
      <ViewerShell>
        <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center text-center">
          <AlertCircle className="mb-4 h-12 w-12 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Dashboard unavailable
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {pageError || 'The dashboard could not be loaded.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/dashboards')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Back to Dashboards
            </button>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        </div>
      </ViewerShell>
    );
  }

  const dataWidgetCount = dashboard.layout.widgets.filter(
    (widget) => widget.type !== 'markdown',
  ).length;

  return (
    <ViewerShell>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={() => navigate('/dashboards')}
              className="mt-0.5 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="Back to dashboards"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">
                  {dashboard.name}
                </h1>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  Read-only view
                </span>
              </div>
              {dashboard.description && (
                <p className="mt-1 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
                  {dashboard.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{dashboard.layout.widgets.length} widget{dashboard.layout.widgets.length === 1 ? '' : 's'}</span>
                {lastRefreshedAt && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    Refreshed {formatTime(lastRefreshedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshWidgets(dashboard)}
              disabled={refreshingAll || dataWidgetCount === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <RefreshCw className={`h-4 w-4 ${refreshingAll ? 'animate-spin' : ''}`} />
              {refreshingAll ? 'Refreshing...' : 'Refresh Data'}
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/dashboards/${dashboard.id}`)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Edit3 className="h-4 w-4" />
              Edit Dashboard
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:py-8">
        {pageError && <ErrorBanner message={pageError} />}

        {dashboard.reference_issues.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-900/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  Some dashboard data sources are no longer available.
                </p>
                <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-300">
                  {dashboard.reference_issues.map((issue, index) => (
                    <li key={`${issue.widget_id}-${index}`}>
                      <strong>{widgetTitleForId(dashboard.layout.widgets, issue.widget_id)}:</strong>{' '}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {dashboard.layout.widgets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-14 text-center dark:border-gray-700 dark:bg-gray-900">
            <Database className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              This dashboard has no widgets yet
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Open the dashboard editor to add tables, metrics, charts, or notes.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {dashboard.layout.widgets.map((widget) => (
              <ViewerWidgetCard
                key={widget.id}
                dashboardId={dashboard.id}
                widget={widget}
                runtime={runtime[widget.id] ?? EMPTY_RUNTIME}
                referenceIssue={dashboard.reference_issues.find(
                  (issue) => issue.widget_id === widget.id,
                )}
                onRefresh={() => void executeWidget(dashboard.id, widget)}
              />
            ))}
          </div>
        )}
      </main>
    </ViewerShell>
  );
}

function ViewerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
      {children}
    </div>
  );
}

function ViewerWidgetCard({
  dashboardId,
  widget,
  runtime,
  referenceIssue,
  onRefresh,
}: {
  dashboardId: number;
  widget: DashboardWidget;
  runtime: WidgetRuntimeState;
  referenceIssue?: ReferenceIssue;
  onRefresh: () => void;
}) {
  const fullWidth = widget.position.w >= 900;
  const height = Math.max(240, Math.min(widget.position.h, 620));

  return (
    <article
      className={`${fullWidth ? 'xl:col-span-2' : ''} overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900`}
      data-dashboard-id={dashboardId}
    >
      <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="flex min-w-0 items-center gap-2">
          <WidgetTypeIcon type={widget.type} />
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-gray-900 dark:text-white">
              {widget.title}
            </h2>
            <p className="text-xs capitalize text-gray-500 dark:text-gray-400">
              {widget.type}
            </p>
          </div>
        </div>

        {widget.type !== 'markdown' && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={runtime.loading || Boolean(referenceIssue)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${runtime.loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </header>

      {referenceIssue && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          {referenceIssue.message}
        </div>
      )}

      <div className="p-4" style={{ minHeight: height }}>
        {widget.type === 'markdown' ? (
          <SafeMarkdown text={String(widget.config.markdown ?? '')} />
        ) : referenceIssue ? (
          <EmptyDataState message="This widget cannot run until its missing reference is repaired in the dashboard editor." />
        ) : runtime.loading ? (
          <WidgetLoadingState />
        ) : runtime.error ? (
          <div className="flex min-h-52 flex-col items-center justify-center text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-red-500" />
            <p className="max-w-2xl text-sm text-red-700 dark:text-red-300">
              {runtime.error}
            </p>
            <button
              type="button"
              onClick={onRefresh}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <RefreshCw className="h-4 w-4" />
              Retry Widget
            </button>
          </div>
        ) : runtime.data ? (
          <WidgetRenderer response={runtime.data} />
        ) : (
          <EmptyDataState message="No data has been loaded for this widget yet." />
        )}
      </div>

      {runtime.data && !referenceIssue && (
        <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span>{runtime.data.dataset_name}</span>
          <span>{runtime.data.row_count} row{runtime.data.row_count === 1 ? '' : 's'}</span>
          <span>{runtime.data.execution_ms.toFixed(1)} ms</span>
          {runtime.data.truncated && (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              Truncated at {runtime.data.limit}
            </span>
          )}
        </footer>
      )}
    </article>
  );
}

function WidgetLoadingState() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading widget data">
      <div className="h-5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="h-44 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800/70" />
      <div className="flex gap-3">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800/70" />
        <div className="h-4 w-16 animate-pulse rounded bg-gray-100 dark:bg-gray-800/70" />
      </div>
    </div>
  );
}

function WidgetRenderer({ response }: { response: WidgetDataResponse }) {
  const visualization = response.visualization;

  if (visualization.kind === 'table') {
    const columns = visualization.display_columns?.length
      ? visualization.display_columns
      : response.columns;
    return <DataTable columns={columns} rows={response.data} />;
  }

  if (visualization.kind === 'metric') {
    return (
      <MetricCard
        value={visualization.metric_value}
        format={visualization.format ?? 'number'}
        decimals={visualization.decimals ?? 2}
        prefix={visualization.prefix ?? ''}
        suffix={visualization.suffix ?? ''}
      />
    );
  }

  return <DataChart response={response} />;
}

function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0) {
    return <EmptyDataState message="Query returned no rows." />;
  }

  return (
    <div className="max-h-[520px] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
        <thead className="sticky top-0 bg-gray-50 dark:bg-gray-950">
          <tr>
            {columns.map((column) => (
              <th
                scope="col"
                key={column}
                className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td
                  key={`${rowIndex}-${column}`}
                  className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-gray-300"
                >
                  {formatCellValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({
  value,
  format,
  decimals,
  prefix,
  suffix,
}: {
  value: unknown;
  format: MetricFormat;
  decimals: number;
  prefix: string;
  suffix: string;
}) {
  return (
    <div className="flex min-h-52 items-center justify-center">
      <p className="text-center text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
        {formatMetricValue(value, format, decimals, prefix, suffix)}
      </p>
    </div>
  );
}

function DataChart({ response }: { response: WidgetDataResponse }) {
  const visualization = response.visualization;
  const xColumn = visualization.x_column;
  const yColumn = visualization.y_column;

  if (!xColumn || !yColumn) {
    return <EmptyDataState message="Chart configuration is incomplete." />;
  }

  if (response.data.length === 0) {
    return <EmptyDataState message="Query returned no chart points." />;
  }

  if (visualization.kind === 'pie' || visualization.kind === 'donut') {
    return (
      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip />
            {visualization.show_legend !== false && <Legend />}
            <Pie
              data={response.data}
              dataKey={yColumn}
              nameKey={xColumn}
              cx="50%"
              cy="50%"
              outerRadius="78%"
              innerRadius={visualization.kind === 'donut' ? '48%' : 0}
              fill="currentColor"
              className="text-blue-600"
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const series = prepareSeriesChartData(
    response.data,
    xColumn,
    yColumn,
    visualization.series_column ?? null,
  );

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        {visualization.kind === 'line' ? (
          <LineChart data={series.rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xColumn} />
            <YAxis />
            <Tooltip />
            {visualization.show_legend !== false && <Legend />}
            {series.keys.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke="currentColor"
                className="text-blue-600"
                dot={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={series.rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xColumn} />
            <YAxis />
            <Tooltip />
            {visualization.show_legend !== false && <Legend />}
            {series.keys.map((key) => (
              <Bar
                key={key}
                dataKey={key}
                fill="currentColor"
                className="text-blue-600"
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function SafeMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');

  if (!text.trim()) {
    return <EmptyDataState message="No Markdown text." />;
  }

  return (
    <div className="space-y-2 text-sm leading-6 text-gray-700 dark:text-gray-300">
      {lines.map((line, index) => {
        if (line.startsWith('### ')) {
          return (
            <h4 key={index} className="pt-2 text-base font-semibold text-gray-900 dark:text-white">
              {line.slice(4)}
            </h4>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h3 key={index} className="pt-2 text-lg font-semibold text-gray-900 dark:text-white">
              {line.slice(3)}
            </h3>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <h2 key={index} className="pt-2 text-xl font-bold text-gray-900 dark:text-white">
              {line.slice(2)}
            </h2>
          );
        }
        if (line.startsWith('- ')) {
          return (
            <div key={index} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{line.slice(2)}</span>
            </div>
          );
        }
        if (!line.trim()) {
          return <div key={index} className="h-2" />;
        }
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function WidgetTypeIcon({ type }: { type: WidgetType }) {
  const className = 'h-5 w-5 text-blue-600 dark:text-blue-400';
  if (type === 'chart') return <BarChart3 className={className} />;
  if (type === 'table') return <Table2 className={className} />;
  if (type === 'metric') return <Gauge className={className} />;
  return <FileText className={className} />;
}

function EmptyDataState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400">
      {message}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function prepareSeriesChartData(
  data: Record<string, unknown>[],
  xColumn: string,
  yColumn: string,
  seriesColumn: string | null,
): { rows: Record<string, unknown>[]; keys: string[] } {
  if (!seriesColumn) {
    return { rows: data, keys: [yColumn] };
  }

  const rowMap = new Map<string, Record<string, unknown>>();
  const keys: string[] = [];

  for (const row of data) {
    const xValue = row[xColumn];
    const seriesValue = String(row[seriesColumn] ?? 'Series');
    const mapKey = String(xValue ?? '');

    if (!keys.includes(seriesValue)) {
      keys.push(seriesValue);
    }

    const current = rowMap.get(mapKey) ?? { [xColumn]: xValue };
    current[seriesValue] = row[yColumn];
    rowMap.set(mapKey, current);
  }

  return { rows: Array.from(rowMap.values()), keys };
}

function formatMetricValue(
  value: unknown,
  format: MetricFormat,
  decimals: number,
  prefix: string,
  suffix: string,
): string {
  if (value === null || value === undefined) {
    return '—';
  }

  if (format === 'text' || typeof value !== 'number') {
    return `${prefix}${String(value)}${suffix}`;
  }

  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

  const percentSuffix = format === 'percent' && !suffix ? '%' : suffix;
  return `${prefix}${formatted}${percentSuffix}`;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}


function formatTime(value: Date): string {
  return value.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function widgetTitleForId(widgets: DashboardWidget[], id: string): string {
  return widgets.find((widget) => widget.id === id)?.title || id;
}
