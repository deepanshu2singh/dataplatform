import { PresentationNumberInput } from '../components/dashboard/PresentationNumberInput';
import { WidgetPresentationEditor } from '../components/dashboard/WidgetPresentationEditor';
import { WidgetRenderer } from '../components/dashboard/WidgetRenderer';
import type { DashboardWidget, DashboardLayout, DashboardDataSource, DashboardPosition, WidgetType, WidgetDataResponse, PresentationOptions } from '../lib/dashboardTypes';
import { DashboardCanvas } from '../components/dashboard/DashboardCanvas';
import { useDashboardHistory } from '../hooks/useDashboardHistory';
import { appendWidget, boundedPosition, canvasWidgets, placeWidget, tidyWidgets, MAX_WIDGETS } from '../lib/dashboardLayout';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Database,
  Edit3,
  Eye,
  FileText,
  Gauge,
  Grid3X3,
  LayoutDashboard,
  Loader2,
  Copy,
  LockKeyhole,
  LockKeyholeOpen,
  Undo2,
  Redo2,
  AlignStartVertical,
  Plus,
  RefreshCw,
  Save,
  Table2,
  Trash2,
} from 'lucide-react';


import { api } from '../lib/api';
import { AccessibleDialog } from '../components/AccessibleDialog';
import { getApiErrorMessage } from '../lib/apiError';
import {
  isCanceledRequest,
  useLatestKeyedRequests,
  useLatestRequest,
} from '../hooks/useLatestRequest';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChanges';

interface ReferenceIssue {
  widget_id: string;
  reference_type: 'widget' | 'dataset' | 'notebook';
  reference_id: number | null;
  message: string;
}

interface Dashboard {
  version?: number;
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

interface Dataset {
  id: number;
  name: string;
  description: string | null;
  type: string;
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

export function DashboardsPage() {
  const { id } = useParams<{ id?: string }>();

  if (id) {
    return <DashboardBuilder dashboardId={id} />;
  }

  return <DashboardManager />;
}

function DashboardManager() {
  const navigate = useNavigate();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const dashboardListRequest = useLatestRequest();

  const loadDashboards = useCallback(async () => {
    const request = dashboardListRequest.begin();
    setLoading(true);
    setError('');

    try {
      const response = await api.get<Dashboard[]>('/dashboards', {
        signal: request.signal,
      });

      if (!request.isCurrent()) {
        return;
      }

      setDashboards(response.data);
    } catch (err: unknown) {
      if (!request.isCurrent() || isCanceledRequest(err)) {
        return;
      }
      setError(getApiErrorMessage(err, 'Failed to load dashboards.'));
    } finally {
      if (request.isCurrent()) {
        setLoading(false);
      }
      request.finish();
    }
  }, [dashboardListRequest]);

  useEffect(() => {
    void loadDashboards();
  }, [loadDashboards]);

  const deleteDashboard = async (dashboard: Dashboard) => {
    const confirmed = window.confirm(
      `Delete "${dashboard.name}"?\n\nThis permanently removes the dashboard definition. Datasets and notebooks are not deleted.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(dashboard.id);
    setError('');

    try {
      await api.delete(`/dashboards/${dashboard.id}`);
      setDashboards((current) =>
        current.filter((item) => item.id !== dashboard.id),
      );
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to delete dashboard.'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="dashboard-workspace space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Dashboards
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            A clear view of your data. Build and arrange charts from your own datasets.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/dashboards/new')}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Dashboard
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void loadDashboards()} />}

      {loading ? (
        <CenteredLoader label="Loading dashboards..." />
      ) : dashboards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <LayoutDashboard className="mx-auto mb-4 h-14 w-14 text-gray-300 dark:text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            No dashboards yet
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
            Create a dashboard, add a table, KPI, chart, or Markdown widget, preview it, then save the validated definition.
          </p>
          <button
            type="button"
            onClick={() => navigate('/dashboards/new')}
            className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700"
          >
            Create Dashboard
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((dashboard) => {
            const issueCount = dashboard.reference_issues.length;
            const widgetCount = dashboard.layout.widgets.length;

            return (
              <article
                key={dashboard.id}
                className="dashboard-library-card p-5 transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
                      {dashboard.name}
                    </h2>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm text-gray-500 dark:text-gray-400">
                      {dashboard.description || 'No description'}
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    Private
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <StatTile label="Widgets" value={String(widgetCount)} />
                  <StatTile
                    label="References"
                    value={issueCount ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'Healthy'}
                    warning={issueCount > 0}
                  />
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <span>
                    Updated {formatDateTime(dashboard.updated_at || dashboard.created_at)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboards/${dashboard.id}/view`)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboards/${dashboard.id}`)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteDashboard(dashboard)}
                      disabled={deletingId === dashboard.id}
                      className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20"
                      aria-label={`Delete ${dashboard.name}`}
                    >
                      {deletingId === dashboard.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DashboardBuilder({ dashboardId }: { dashboardId: string }) {
  const navigate = useNavigate();
  const isNew = dashboardId === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');

  const [dashboardNumericId, setDashboardNumericId] = useState<number | null>(
    isNew ? null : Number(dashboardId),
  );
  const [name, setName] = useState('Untitled Dashboard');
  const [description, setDescription] = useState('');
  const history = useDashboardHistory<DashboardWidget>();
  const { widgets, set: setWidgets, reset: resetWidgets } = history;
  const [locked, setLocked] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [referenceIssues, setReferenceIssues] = useState<ReferenceIssue[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runtime, setRuntime] = useState<Record<string, WidgetRuntimeState>>({});
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { allowNextNavigation } = useUnsavedChangesGuard(
    dirty,
    'You have unsaved dashboard changes. Leave without saving?',
  );

  const datasetLoadRequest = useLatestRequest();
  const dashboardLoadRequest = useLatestRequest();
  const widgetRequests = useLatestKeyedRequests();
  const saveInFlightRef = useRef(false);

  const selectedWidget = useMemo(
    () => widgets.find((widget) => widget.id === editingWidgetId) ?? null,
    [editingWidgetId, widgets],
  );

  const loadDatasets = useCallback(async () => {
    const request = datasetLoadRequest.begin();

    try {
      const response = await api.get<Dataset[]>('/datasets', {
        signal: request.signal,
      });

      if (request.isCurrent()) {
        setDatasets(response.data.filter((dataset) => dataset.type === 'file'));
      }
    } catch (err: unknown) {
      if (request.isCurrent() && !isCanceledRequest(err)) {
        setPageError(getApiErrorMessage(err, 'Failed to load datasets.'));
      }
    } finally {
      request.finish();
    }
  }, [datasetLoadRequest]);

  const executeSavedWidget = useCallback(
    async (numericDashboardId: number, widget: DashboardWidget) => {
      if (widget.type === 'markdown') {
        return;
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
          return;
        }

        setRuntime((current) => ({
          ...current,
          [widget.id]: {
            loading: false,
            data: response.data,
            error: '',
          },
        }));
      } catch (err: unknown) {
        if (!request.isCurrent() || isCanceledRequest(err)) {
          return;
        }
        setRuntime((current) => ({
          ...current,
          [widget.id]: {
            loading: false,
            data: null,
            error: getApiErrorMessage(err, 'Widget execution failed.'),
          },
        }));
      } finally {
        request.finish();
      }
    },
    [widgetRequests],
  );

  const loadDashboard = useCallback(async () => {
    const request = dashboardLoadRequest.begin();
    widgetRequests.cancelAll();
    setRuntime({});
    setPageError('');
    setNotice('');

    if (isNew) {
      setDashboardNumericId(null);
      setName('Untitled Dashboard');
      setDescription('');
      resetWidgets([]);
      setLocked(false);
      setSavedVersion(null);
      setReferenceIssues([]);
      setEditingWidgetId(null);
      setShowAddWidget(false);
      setDirty(false);
      setLoading(false);
      request.finish();
      return;
    }

    const numericId = Number(dashboardId);

    if (!Number.isInteger(numericId) || numericId <= 0) {
      setPageError('Invalid dashboard ID.');
      setLoading(false);
      request.finish();
      return;
    }

    setLoading(true);

    try {
      const response = await api.get<Dashboard>(`/dashboards/${numericId}`, {
        signal: request.signal,
      });

      if (!request.isCurrent()) {
        return;
      }

      const dashboard = response.data;
      setDashboardNumericId(dashboard.id);
      setName(dashboard.name);
      setDescription(dashboard.description || '');
      resetWidgets(canvasWidgets(dashboard.layout.widgets, dashboard.layout.version));
      setLocked(dashboard.layout.locked ?? false);
      setSavedVersion(dashboard.version ?? null);
      setReferenceIssues(dashboard.reference_issues);
      setDirty(false);

      for (const widget of dashboard.layout.widgets) {
        if (widget.type !== 'markdown') {
          void executeSavedWidget(dashboard.id, widget);
        }
      }
    } catch (err: unknown) {
      if (!request.isCurrent() || isCanceledRequest(err)) {
        return;
      }
      setPageError(getApiErrorMessage(err, 'Failed to load dashboard.'));
    } finally {
      if (request.isCurrent()) {
        setLoading(false);
      }
      request.finish();
    }
  }, [dashboardId, dashboardLoadRequest, executeSavedWidget, isNew, widgetRequests, resetWidgets]);

  useEffect(() => {
    void loadDatasets();
    void loadDashboard();
  }, [loadDashboard, loadDatasets]);

  const markDirty = () => {
    setDirty(true);
    setNotice('');
  };

  const changeLayout = (next: DashboardWidget[]) => {
    if (locked || saving || JSON.stringify(next) === JSON.stringify(widgets)) return;
    setWidgets(next);
    markDirty();
  };

  const updateWidget = (widgetId: string, nextWidget: DashboardWidget) => {
    if (saving) return;
    const originalWidget = widgets.find(w => w.id === widgetId);
    const dataChanged = originalWidget?.type !== nextWidget.type || JSON.stringify(originalWidget?.source) !== JSON.stringify(nextWidget.source);
    if (dataChanged) widgetRequests.cancel(widgetId);
    setWidgets((current) => {
      const original = current.find(w => w.id === widgetId)!;
      const next = current.map(w => w.id === widgetId ? { ...nextWidget, position: original.position } : w);
      return locked ? next : placeWidget(next, widgetId, nextWidget.position);
    });
    if (dataChanged) setRuntime((current) => ({ ...current, [widgetId]: EMPTY_RUNTIME }));
    markDirty();
  };

  const duplicateWidget = (widget: DashboardWidget) => {
    if (widgets.length >= MAX_WIDGETS || locked || saving) return;
    const duplicate = { ...structuredClone(widget), id: crypto.randomUUID(), title: `${widget.title} (copy)`.slice(0,255) };
    const next = appendWidget(widgets, duplicate);
    if (next === widgets) { setNotice('No free space remains. Resize or remove a widget first.'); return; }
    changeLayout(next);
  };

  const travelHistory = (direction: 'undo' | 'redo') => {
    if (locked || saving) return;
    const next = direction === 'undo' ? history.previous : history.next;
    if (!next) return;
    const unchanged = new Set(next.filter(w => widgets.some(current => current.id === w.id && JSON.stringify(current.source) === JSON.stringify(w.source) && JSON.stringify(current.config) === JSON.stringify(w.config))).map(w => w.id));
    for (const widget of widgets) if (!unchanged.has(widget.id)) widgetRequests.cancel(widget.id);
    setRuntime(current => Object.fromEntries(Object.entries(current).filter(([id]) => unchanged.has(id))));
    setEditingWidgetId(null);
    history[direction]();
    markDirty();
  };

  const previewWidget = async (widget: DashboardWidget) => {
    if (widget.type === 'markdown') {
      return;
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
        '/dashboards/widgets/preview',
        { widget },
        { signal: request.signal },
      );

      if (!request.isCurrent()) {
        return;
      }

      setRuntime((current) => ({
        ...current,
        [widget.id]: {
          loading: false,
          data: response.data,
          error: '',
        },
      }));
    } catch (err: unknown) {
      if (!request.isCurrent() || isCanceledRequest(err)) {
        return;
      }
      setRuntime((current) => ({
        ...current,
        [widget.id]: {
          loading: false,
          data: null,
          error: getApiErrorMessage(err, 'Widget preview failed.'),
        },
      }));
    } finally {
      request.finish();
    }
  };

  const refreshWidget = async (widget: DashboardWidget) => {
    if (dashboardNumericId && !dirty) {
      await executeSavedWidget(dashboardNumericId, widget);
      return;
    }

    await previewWidget(widget);
  };

  const refreshAllWidgets = async () => {
    for (const widget of widgets) {
      if (widget.type !== 'markdown') {
        await refreshWidget(widget);
      }
    }
  };

  const addWidget = (type: WidgetType) => {
    if (widgets.length >= MAX_WIDGETS || locked || saving) return;
    const firstDatasetId = datasets[0]?.id ?? 0;
    const id = crypto.randomUUID();

    const widget = createDefaultWidget(
      type,
      id,
      firstDatasetId,
      widgets.length,
    );

    const next = appendWidget(widgets, widget);
    if (next === widgets) { setNotice('No free space remains. Resize or remove a widget first.'); return; }
    setWidgets(next);
    setShowAddWidget(false);
    setEditingWidgetId(id);
    markDirty();
  };

  const deleteWidget = (widget: DashboardWidget) => {
    if (locked || saving) return;
    const confirmed = window.confirm(`Delete widget "${widget.title}"?`);

    if (!confirmed) {
      return;
    }

    widgetRequests.cancel(widget.id);
    setWidgets((current) => current.filter((item) => item.id !== widget.id));
    setRuntime((current) => {
      const next = { ...current };
      delete next[widget.id];
      return next;
    });
    if (editingWidgetId === widget.id) {
      setEditingWidgetId(null);
    }
    markDirty();
  };

  const saveDashboard = async () => {
    if (saveInFlightRef.current) {
      return;
    }

    const cleanName = name.trim();

    if (!cleanName) {
      setPageError('Dashboard name is required.');
      return;
    }

    if (dashboardNumericId && savedVersion === null) {
      setPageError('Reload this dashboard before saving so its latest version can be checked.');
      return;
    }
    saveInFlightRef.current = true;
    setSaving(true);
    setPageError('');
    setNotice('');

    const payload = {
      name: cleanName,
      description: description.trim() || null,
      layout: {
        version: 3 as const,
        locked,
        widgets,
      },
      is_public: false,
      ...(dashboardNumericId && savedVersion ? { expected_version: savedVersion } : {}),
    };

    try {
      const response = dashboardNumericId
        ? await api.put<Dashboard>(`/dashboards/${dashboardNumericId}`, payload)
        : await api.post<Dashboard>('/dashboards', payload);

      const saved = response.data;

      setDashboardNumericId(saved.id);
      setName(saved.name);
      setDescription(saved.description || '');
      resetWidgets(canvasWidgets(saved.layout.widgets, saved.layout.version));
      setLocked(saved.layout.locked ?? false);
      setSavedVersion(saved.version ?? null);
      setReferenceIssues(saved.reference_issues);
      setDirty(false);
      setNotice('Dashboard saved.');

      if (!dashboardNumericId) {
        allowNextNavigation();
        navigate(`/dashboards/${saved.id}`, { replace: true });
      }

      widgetRequests.cancelAll();
      setRuntime({});
      for (const widget of saved.layout.widgets) {
        if (widget.type !== 'markdown') {
          void executeSavedWidget(saved.id, widget);
        }
      }
    } catch (err: unknown) {
      setPageError(getApiErrorMessage(err, 'Failed to save dashboard.'));
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const leaveBuilder = () => {
    navigate('/dashboards');
  };

  if (loading) {
    return <CenteredLoader label="Loading dashboard..." />;
  }

  return (
    <div className="dashboard-workspace space-y-5" aria-busy={saving}>
      <div className="sticky top-16 z-30 -mx-4 border-b border-gray-200 bg-gray-50/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-gray-700 dark:bg-gray-900/95">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={leaveBuilder}
              className="mt-1 rounded-lg p-2 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="Back to dashboards"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              <input
                value={name}
                disabled={saving}
                aria-label="Dashboard name"
                maxLength={255}
                onChange={(event) => {
                  setName(event.target.value);
                  markDirty();
                }}
                className="w-full border-none bg-transparent p-0 text-2xl font-bold text-gray-900 outline-none focus:ring-0 dark:text-white"
                placeholder="Untitled Dashboard"
              />
              <input
                value={description}
                disabled={saving}
                aria-label="Dashboard description"
                maxLength={5000}
                onChange={(event) => {
                  setDescription(event.target.value);
                  markDirty();
                }}
                className="mt-1 w-full border-none bg-transparent p-0 text-sm text-gray-500 outline-none focus:ring-0 dark:text-gray-400"
                placeholder="Add a dashboard description (optional)"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                Unsaved changes
              </span>
            )}
            {dashboardNumericId && !dirty && (
              <button
                type="button"
                onClick={() => navigate(`/dashboards/${dashboardNumericId}/view`)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <Eye className="h-4 w-4" />
                View
              </button>
            )}
            <button
              type="button"
              onClick={() => void refreshAllWidgets()}
              disabled={widgets.every((widget) => widget.type === 'markdown')}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Data
            </button>
            <button
              type="button"
              onClick={() => setShowAddWidget(true)}
              disabled={locked || saving || widgets.length >= MAX_WIDGETS}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Plus className="h-4 w-4" />
              Add Widget
            </button>
            <button
              type="button"
              onClick={() => void saveDashboard()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-toolbar" role="toolbar" aria-label="Dashboard layout">
        <div className="dashboard-toolbar-heading"><span className="dashboard-eyebrow">WORKSPACE / CANVAS</span><strong>{widgets.length} / {MAX_WIDGETS} widgets</strong><span>12-column grid · changes stay in your draft until Save</span></div>
        <div className="dashboard-toolbar-actions">
          <button type="button" onClick={() => { setLocked(!locked); markDirty(); }} disabled={saving} aria-pressed={locked}>{locked ? <LockKeyhole size={16}/> : <LockKeyholeOpen size={16}/>} {locked ? 'Unlock layout' : 'Lock layout'}</button>
          <button type="button" aria-label="Undo layout" disabled={locked || saving || !history.canUndo} onClick={() => travelHistory('undo')}><Undo2 size={16}/>Undo</button>
          <button type="button" aria-label="Redo layout" disabled={locked || saving || !history.canRedo} onClick={() => travelHistory('redo')}><Redo2 size={16}/>Redo</button>
          <button type="button" disabled={locked || saving || !widgets.length} onClick={() => changeLayout(tidyWidgets(widgets))}><AlignStartVertical size={16}/>Tidy layout</button>
        </div>
        <p className="dashboard-toolbar-help">{locked ? 'Placement is locked. You can still edit content and refresh data.' : 'Drag a handle to move. Pull the bottom corner to resize. For exact sizes, open Edit widget → Placement.'}</p>
      </div>

      {pageError && <ErrorBanner message={pageError} />}
      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </div>
      )}

      {referenceIssues.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                This dashboard has {referenceIssues.length} stale reference{referenceIssues.length === 1 ? '' : 's'}.
              </p>
              <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-300">
                {referenceIssues.map((issue, index) => (
                  <li key={`${issue.widget_id}-${index}`}>
                    <strong>{widgetTitleForId(widgets, issue.widget_id)}:</strong>{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-14 text-center dark:border-gray-700 dark:bg-gray-800">
          <Grid3X3 className="mx-auto mb-4 h-14 w-14 text-gray-300 dark:text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Your dashboard is empty
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">
            Start with a metric, a chart, a table, or a note. Arrange your findings into a clear story.
          </p>
          <button
            type="button"
            onClick={() => setShowAddWidget(true)}
            disabled={locked || saving}
            className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700"
          >
            Add First Widget
          </button>
        </div>
      ) : (
        <DashboardCanvas
          widgets={widgets}
          locked={locked || saving}
          onChange={changeLayout}
          renderWidget={(widget) => <WidgetCard
            widget={widget}
            runtime={runtime[widget.id] ?? EMPTY_RUNTIME}
            referenceIssue={referenceIssues.find(issue => issue.widget_id === widget.id)}
            onEdit={() => setEditingWidgetId(widget.id)}
            onDelete={() => deleteWidget(widget)}
            onRefresh={() => void refreshWidget(widget)}
            onDuplicate={() => duplicateWidget(widget)}
            placementDisabled={locked || saving}
            duplicateDisabled={widgets.length >= MAX_WIDGETS}
          />}
        />
      )}

      {showAddWidget && (
        <AddWidgetModal
          onClose={() => setShowAddWidget(false)}
          onAdd={addWidget}
        />
      )}

      {selectedWidget && !saving && (
        <WidgetEditorModal
          widget={selectedWidget}
          placementLocked={locked}
          datasets={datasets}
          runtime={runtime[selectedWidget.id] ?? EMPTY_RUNTIME}
          onChange={(nextWidget) => updateWidget(selectedWidget.id, nextWidget)}
          onPreview={() => void previewWidget(selectedWidget)}
          onClose={() => setEditingWidgetId(null)}
        />
      )}
    </div>
  );
}

function WidgetCard({widget,runtime,referenceIssue,onEdit,onDelete,onRefresh,onDuplicate,placementDisabled,duplicateDisabled}: {
  widget:DashboardWidget;runtime:WidgetRuntimeState;referenceIssue?:ReferenceIssue;
  onEdit:()=>void;onDelete:()=>void;onRefresh:()=>void;onDuplicate:()=>void;placementDisabled:boolean;duplicateDisabled:boolean;
}) {
  return ( <article className="dashboard-card">
      <header className="dashboard-card-header">
        <div className="flex min-w-0 items-center gap-2"><WidgetTypeIcon type={widget.type}/><div className="min-w-0"><h3 className="truncate font-semibold">{widget.title}</h3><p className="dashboard-eyebrow">{widget.type}</p></div></div>
        <div className="flex shrink-0 items-center gap-1">
          {widget.type !== 'markdown' && <IconButton label="Refresh widget" onClick={onRefresh}><RefreshCw className={`h-4 w-4 ${runtime.loading ? 'animate-spin' : ''}`}/></IconButton>}
          <IconButton label="Duplicate widget" onClick={onDuplicate} disabled={placementDisabled || duplicateDisabled}><Copy className="h-4 w-4"/></IconButton>
          <IconButton label="Edit widget" onClick={onEdit}><Edit3 className="h-4 w-4"/></IconButton>
          <IconButton label="Delete widget" onClick={onDelete} disabled={placementDisabled} danger><Trash2 className="h-4 w-4"/></IconButton>
        </div>
      </header>
      {referenceIssue && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          {referenceIssue.message}
        </div>
      )}

      <div className="dashboard-card-body">
        {widget.type === 'markdown' ? (
          <SafeMarkdown text={String(widget.config.markdown ?? '')} />
        ) : runtime.loading ? (
          <div className="flex h-full min-h-52 items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Running widget query...
          </div>
        ) : runtime.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{runtime.error}</span>
            </div>
          </div>
        ) : runtime.data ? (
          <WidgetRenderer response={runtime.data} config={widget.config as PresentationOptions} widgetType={widget.type}/>
        ) : (
          <div className="flex h-full min-h-52 flex-col items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400">
            <Database className="mb-3 h-9 w-9 text-gray-300 dark:text-gray-600" />
            <p>No preview data yet.</p>
            <button
              type="button"
              onClick={onRefresh}
              className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Run Preview
            </button>
          </div>
        )}
      </div>

      {runtime.data && (
        <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
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

function WidgetEditorModal({
  widget,
  placementLocked,
  datasets,
  runtime,
  onChange,
  onPreview,
  onClose,
}: {
  widget: DashboardWidget;
  placementLocked: boolean;
  datasets: Dataset[];
  runtime: WidgetRuntimeState;
  onChange: (widget: DashboardWidget) => void;
  onPreview: () => void;
  onClose: () => void;
}) {
  const setTitle = (title: string) => onChange({ ...widget, title });

  const setConfigValue = (key:string,value:unknown) => onChange({...widget,config:{...widget.config,[key]:value}});

  const setSourceValue = (key: keyof DashboardDataSource, value: unknown) => {
    const currentSource = widget.source ?? {
      dataset_id: datasets[0]?.id ?? 0,
      query: 'SELECT * FROM dataset LIMIT 10',
      limit: 100,
    };

    onChange({
      ...widget,
      source: {
        ...currentSource,
        [key]: value,
      },
    });
  };

  return (
    <AccessibleDialog
      title={`Edit ${capitalize(widget.type)} Widget`}
      description="Preview your widget before saving."
      onClose={onClose}
      closeLabel="Close widget editor"
      panelClassName="max-h-[92vh] max-w-3xl overflow-hidden rounded-2xl"
    >
        <div className="max-h-[calc(92vh-140px)] overflow-y-auto p-5">
          <div className="space-y-5">
            <Field label="Widget title">
              <input
                value={widget.title}
                data-dialog-initial-focus
                maxLength={255}
                onChange={(event) => setTitle(event.target.value)}
                className={inputClassName}
              />
            </Field>

            {widget.type === 'markdown' ? (
              <Field label="Markdown text">
                <textarea
                  value={String(widget.config.markdown ?? '')}
                  maxLength={50000}
                  rows={12}
                  onChange={(event) => setConfigValue('markdown', event.target.value)}
                  className={`${inputClassName} font-mono text-sm`}
                  placeholder="# Sales overview"
                />
              </Field>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Dataset">
                    <select
                      value={widget.source?.dataset_id ?? ''}
                      onChange={(event) =>
                        setSourceValue('dataset_id', Number(event.target.value))
                      }
                      className={inputClassName}
                    >
                      <option value="" disabled>
                        Select a dataset
                      </option>
                      {datasets.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name} (ID {dataset.id})
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Result limit">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={widget.source?.limit ?? 100}
                      onChange={(event) =>
                        setSourceValue(
                          'limit',
                          clampNumber(Number(event.target.value), 1, 1000),
                        )
                      }
                      className={inputClassName}
                    />
                  </Field>
                </div>

                <Field label="SQL query">
                  <textarea
                    value={widget.source?.query ?? ''}
                    maxLength={50000}
                    rows={7}
                    spellCheck={false}
                    onChange={(event) => setSourceValue('query', event.target.value)}
                    className={`${inputClassName} font-mono text-sm`}
                    placeholder="SELECT * FROM dataset LIMIT 10"
                  />
                </Field>

                <WidgetPresentationEditor widget={widget} onChange={config=>onChange({...widget,config})} resultColumns={runtime.data?.columns??[]}/>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        Widget preview
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Style changes use the current result. Preview validates your selected fields; Save keeps the settings.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onPreview}
                      disabled={runtime.loading || !widget.source?.dataset_id}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {runtime.loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Preview
                    </button>
                  </div>

                  {runtime.error ? (
                    <ErrorBanner message={runtime.error} compact />
                  ) : runtime.data ? (
                    <div className="max-h-[360px] overflow-auto rounded-lg bg-white p-3 dark:bg-gray-800" style={widget.type==='chart'?{height:360}:undefined}>
                      <WidgetRenderer response={runtime.data} config={widget.config as PresentationOptions} widgetType={widget.type}/>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Run Preview to validate the query and visualization columns.
                    </p>
                  )}
                </div>
              </>
            )}

            <fieldset disabled={placementLocked} className="space-y-3">
              <legend className="text-sm font-semibold">Placement</legend>
              <p className="text-xs text-gray-500">{placementLocked ? 'Unlock the layout to change placement.' : 'Columns and rows start at 1. Overlapping cards move down automatically.'}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {([['x','Column',1,13-widget.position.w],['y','Row',1,1001-widget.position.h],['w','Width (columns)',3,12],['h','Height (rows)',5,40]] as const).map(([key,label,min,max])=><Field key={key} label={label}><PresentationNumberInput aria-label={label} min={min} max={max} value={widget.position[key] + (key==='x'||key==='y'?1:0)} onCommit={number=>{if(number===null)return;const value=number-(key==='x'||key==='y'?1:0);onChange({...widget,position:boundedPosition({...widget.position,[key]:value})});}} className={inputClassName}/></Field>)}
              </div>
            </fieldset>
          </div>
        </div>

        <div className="flex justify-end border-t border-gray-200 px-5 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            Done
          </button>
        </div>
    </AccessibleDialog>
  );
}

function AddWidgetModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (type: WidgetType) => void;
}) {
  const options: Array<{
    type: WidgetType;
    title: string;
    description: string;
    icon: typeof BarChart3;
  }> = [
    {
      type: 'table',
      title: 'Table',
      description: 'Show bounded SQL rows and columns.',
      icon: Table2,
    },
    {
      type: 'metric',
      title: 'Metric',
      description: 'Show exactly one KPI value.',
      icon: Gauge,
    },
    {
      type: 'chart',
      title: 'Chart',
      description: 'Choose from 10 chart types, including stacked, scatter, and combo charts.',
      icon: BarChart3,
    },
    {
      type: 'markdown',
      title: 'Markdown',
      description: 'Add safe explanatory text to the dashboard.',
      icon: FileText,
    },
  ];

  return (
    <AccessibleDialog
      title="Add Widget"
      description="Choose a visualization type. You can configure and preview it next."
      onClose={onClose}
      closeLabel="Close add widget dialog"
      panelClassName="max-w-2xl rounded-2xl"
    >
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                type="button"
                key={option.type}
                data-dialog-initial-focus={option.type === options[0].type ? true : undefined}
                onClick={() => onAdd(option.type)}
                className="rounded-xl border border-gray-200 p-5 text-left transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-gray-700 dark:hover:border-blue-700 dark:hover:bg-blue-900/10"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {option.title}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>
    </AccessibleDialog>
  );
}

function SafeMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');

  if (!text.trim()) {
    return <EmptyDataState message="No Markdown text yet." />;
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

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      {children}
    </label>
  );
}

function ErrorBanner({
  message,
  compact = false,
  onRetry,
}: {
  message: string;
  compact?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300 ${
        compact ? 'p-3 text-sm' : 'p-4'
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex-shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function CenteredLoader({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-64 items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
      <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
      <span>{label}</span>
    </div>
  );
}

function EmptyDataState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400">
      {message}
    </div>
  );
}

function StatTile({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`mt-1 font-semibold ${
          warning
            ? 'text-amber-700 dark:text-amber-300'
            : 'text-gray-900 dark:text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

const inputClassName =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

function createDefaultWidget(
  type: WidgetType,
  id: string,
  datasetId: number,
  index: number,
): DashboardWidget {
  const position: DashboardPosition = {
    x: 0,
    y: index * 10,
    w: type === 'metric' ? 4 : 6,
    h: type === 'metric' ? 6 : 10,
  };

  if (type === 'markdown') {
    return {
      id,
      type,
      title: 'Notes',
      config: {
        markdown: '# Dashboard notes\n\nAdd context for this analysis.',
      },
      position,
      source: null,
    };
  }

  if (type === 'metric') {
    return {
      id,
      type,
      title: 'Metric',
      config: {
        value_column: 'value',
        format: 'number',
        decimals: 2,
      },
      position,
      source: {
        dataset_id: datasetId,
        query: 'SELECT COUNT(*) AS value FROM dataset',
        limit: 2,
      },
    };
  }

  if (type === 'chart') {
    return {
      id,
      type,
      title: 'Chart',
      config: {
        chart_type: 'bar',
        x_column: 'category',
        y_column: 'value',
        show_legend: true,
      },
      position,
      source: {
        dataset_id: datasetId,
        query: 'SELECT * FROM dataset LIMIT 20',
        limit: 100,
      },
    };
  }

  return {
    id,
    type: 'table',
    title: 'Table',
    config: {},
    position,
    source: {
      dataset_id: datasetId,
      query: 'SELECT * FROM dataset LIMIT 20',
      limit: 100,
    },
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function widgetTitleForId(widgets: DashboardWidget[], id: string): string {
  return widgets.find((widget) => widget.id === id)?.title || id;
}
