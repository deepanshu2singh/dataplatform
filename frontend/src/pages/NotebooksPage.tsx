import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Clock3,
  Database,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import { api } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { isCanceledRequest, useLatestRequest } from '../hooks/useLatestRequest';
import { AccessibleDialog } from '../components/AccessibleDialog';

interface NotebookContent {
  dataset_id?: number | null;
  cells?: Array<{
    id?: string;
    type?: string;
    content?: string;
  }>;
}

interface Notebook {
  id: number;
  name: string;
  description: string | null;
  content: NotebookContent;
  owner_id: number;
  created_at: string;
  updated_at: string | null;
}

interface DatasetSummary {
  id: number;
  name: string;
}

export function NotebooksPage() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [renameTarget, setRenameTarget] = useState<Notebook | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const notebookListRequest = useLatestRequest();

  const loadNotebooks = useCallback(async () => {
    const request = notebookListRequest.begin();
    setLoading(true);
    setError('');

    try {
      const [notebookResponse, datasetResponse] = await Promise.all([
        api.get<Notebook[]>('/notebooks', { signal: request.signal }),
        api.get<DatasetSummary[]>('/datasets', { signal: request.signal }),
      ]);

      if (!request.isCurrent()) {
        return;
      }

      setNotebooks(notebookResponse.data);
      setDatasets(datasetResponse.data);
    } catch (err: unknown) {
      if (!request.isCurrent() || isCanceledRequest(err)) {
        return;
      }

      setError(getApiErrorMessage(err, 'Failed to load notebooks.'));
    } finally {
      if (request.isCurrent()) {
        setLoading(false);
      }
      request.finish();
    }
  }, [notebookListRequest]);

  useEffect(() => {
    void loadNotebooks();
  }, [loadNotebooks]);

  const datasetNames = useMemo(
    () => new Map(datasets.map((dataset) => [dataset.id, dataset.name])),
    [datasets],
  );

  const openRename = (notebook: Notebook) => {
    setRenameTarget(notebook);
    setRenameName(notebook.name);
    setError('');
  };

  const closeRename = () => {
    if (renaming) {
      return;
    }

    setRenameTarget(null);
    setRenameName('');
  };

  const handleRename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!renameTarget) {
      return;
    }

    const cleanName = renameName.trim();

    if (!cleanName) {
      setError('Notebook name is required.');
      return;
    }

    setRenaming(true);
    setError('');

    try {
      const response = await api.put<Notebook>(
        `/notebooks/${renameTarget.id}`,
        { name: cleanName },
      );

      setNotebooks((current) =>
        current.map((notebook) =>
          notebook.id === renameTarget.id ? response.data : notebook,
        ),
      );

      setRenameTarget(null);
      setRenameName('');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to rename the notebook.'));
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async (notebook: Notebook) => {
    const confirmed = window.confirm(
      `Delete "${notebook.name}"?\n\nThis permanently removes the notebook definition. Your dataset will not be deleted.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(notebook.id);
    setError('');

    try {
      await api.delete(`/notebooks/${notebook.id}`);

      setNotebooks((current) =>
        current.filter((item) => item.id !== notebook.id),
      );
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to delete the notebook.'));
    } finally {
      setDeletingId(null);
    }
  };

  const datasetLabel = (notebook: Notebook) => {
    const datasetId = notebook.content?.dataset_id;

    if (typeof datasetId !== 'number') {
      return 'No dataset selected';
    }

    return datasetNames.get(datasetId) ?? 'Dataset unavailable';
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Notebooks
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Open, rename, and manage your saved SQL notebooks.
          </p>
        </div>

        <Link
          to="/notebooks/new"
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Notebook
        </Link>
      </div>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadNotebooks()}
            className="flex-shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
          >
            Retry
          </button>
        </div>
      )}

      {notebooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <FileText className="mx-auto mb-4 h-16 w-16 text-gray-300 dark:text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            No saved notebooks yet
          </h2>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            Create a notebook, run SQL against a dataset, and save your analysis.
          </p>
          <Link
            to="/notebooks/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Create Notebook
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {notebooks.map((notebook) => {
            const cells = Array.isArray(notebook.content?.cells)
              ? notebook.content.cells.length
              : 0;
            const displayDate = notebook.updated_at ?? notebook.created_at;

            return (
              <div
                key={notebook.id}
                className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-blue-50 p-3 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                    <FileText className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/notebooks/${notebook.id}`}
                      className="block truncate text-lg font-semibold text-gray-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                    >
                      {notebook.name}
                    </Link>

                    <p className="mt-1 line-clamp-2 min-h-10 text-sm text-gray-500 dark:text-gray-400">
                      {notebook.description || 'No description'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <Database className="h-4 w-4" />
                      Dataset
                    </div>
                    <p className="mt-1 truncate font-medium text-gray-800 dark:text-gray-200">
                      {datasetLabel(notebook)}
                    </p>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
                    <div className="text-gray-500 dark:text-gray-400">Cells</div>
                    <p className="mt-1 font-medium text-gray-800 dark:text-gray-200">
                      {cells}
                    </p>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <Clock3 className="h-4 w-4" />
                      Updated
                    </div>
                    <p className="mt-1 font-medium text-gray-800 dark:text-gray-200">
                      {formatDate(displayDate)}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <Link
                    to={`/notebooks/${notebook.id}`}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Open
                  </Link>

                  <button
                    type="button"
                    onClick={() => openRename(notebook)}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <Pencil className="h-4 w-4" />
                    Rename
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDelete(notebook)}
                    disabled={deletingId === notebook.id}
                    className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-900/20"
                  >
                    {deletingId === notebook.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {renameTarget && (
        <AccessibleDialog
          title="Rename notebook"
          description="Change the display name without changing the notebook contents."
          onClose={closeRename}
          closeDisabled={renaming}
          closeLabel="Close rename dialog"
          panelClassName="max-w-md rounded-xl"
        >
            <form onSubmit={handleRename} className="space-y-4 p-5">
              <div>
                <label
                  htmlFor="rename-notebook"
                  className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Notebook name
                </label>
                <input
                  id="rename-notebook"
                  data-dialog-initial-focus
                  value={renameName}
                  onChange={(event) => setRenameName(event.target.value)}
                  maxLength={255}
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeRename}
                  disabled={renaming}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renaming || !renameName.trim()}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {renaming && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Name
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

