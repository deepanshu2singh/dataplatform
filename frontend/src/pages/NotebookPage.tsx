import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';

import { api } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { isCanceledRequest, useLatestRequest } from '../hooks/useLatestRequest';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChanges';
import {
  loadPythonDataset,
  type PythonDatasetPayload,
} from '../lib/pythonDatasetBridge';
import {
  PythonRuntime,
  type PythonRunResult,
} from '../lib/pythonRuntime';

type CellType = 'sql' | 'python' | 'markdown';

const MAX_NOTEBOOK_CELLS = 100;
const MAX_CELL_CONTENT_CHARS = 50_000;
const MAX_NOTEBOOK_CONTENT_BYTES = 512 * 1024;

interface DatasetSummary {
  id: number;
  name: string;
}

interface SqlApiResponse {
  success: true;
  columns: string[];
  data: Record<string, unknown>[];
  row_count: number;
  dtypes: Record<string, string>;
  truncated: boolean;
  limit: number;
  execution_ms: number;
  error: null;
}

interface SqlOutput extends SqlApiResponse {
  kind: 'sql';
}

interface PythonOutput extends PythonRunResult {
  kind: 'python';
  datasetName: string;
  datasetTruncated: boolean;
  datasetLoadedRows: number;
  datasetSourceRows: number | null;
  datasetRowLimit: number;
}

interface ErrorOutput {
  kind: 'error';
  success: false;
  error: string;
}

type CellOutput = SqlOutput | PythonOutput | ErrorOutput;

interface Cell {
  id: string;
  type: CellType;
  content: string;
  output?: CellOutput;
  loading?: boolean;
}

interface NotebookContent {
  dataset_id?: number | null;
  cells?: Array<Partial<Cell>>;
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

function createDefaultCells(): Cell[] {
  return [
    {
      id: crypto.randomUUID(),
      type: 'markdown',
      content: '# New Notebook\nStart writing your analysis here.',
    },
    {
      id: crypto.randomUUID(),
      type: 'sql',
      content: 'SELECT * FROM dataset LIMIT 10',
    },
  ];
}

export function NotebookPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const isNew = id === undefined;

  const [notebookName, setNotebookName] = useState('Untitled Notebook');
  const [notebookDescription, setNotebookDescription] = useState('');
  const [cells, setCells] = useState<Cell[]>(createDefaultCells);

  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);

  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const pythonRuntimeRef = useRef<PythonRuntime | null>(null);
  const pythonDatasetCacheRef = useRef<Map<number, PythonDatasetPayload>>(
    new Map(),
  );
  const [pythonBusy, setPythonBusy] = useState(false);
  const [pythonStatus, setPythonStatus] = useState('');

  const pageRequest = useLatestRequest();
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    pythonRuntimeRef.current?.destroy();
    pythonRuntimeRef.current = null;
    pythonDatasetCacheRef.current.clear();
    setPythonBusy(false);
    setPythonStatus('');
  }, [id]);

  useEffect(() => {
    const datasetCache = pythonDatasetCacheRef.current;

    return () => {
      pythonRuntimeRef.current?.destroy();
      pythonRuntimeRef.current = null;
      datasetCache.clear();
    };
  }, []);

  const { allowNextNavigation } = useUnsavedChangesGuard(
    dirty,
    'You have unsaved notebook changes. Leave without saving?',
  );

  const markDirty = () => {
    setSaved(false);
    setDirty(true);
  };

  const goToNotebookList = () => {
    navigate('/notebooks');
  };

  const loadPage = useCallback(async () => {
    const request = pageRequest.begin();
    setPageLoading(true);
    setPageError('');
    setSaveError('');
    setSaved(false);
    setDirty(false);

    try {
      const datasetsResponse = await api.get<DatasetSummary[]>('/datasets', {
        signal: request.signal,
      });
      const availableDatasets = datasetsResponse.data;

      if (!request.isCurrent()) {
        return;
      }

      setDatasets(availableDatasets);

      if (isNew) {
        setNotebookName('Untitled Notebook');
        setNotebookDescription('');
        setCells(createDefaultCells());
        setSelectedDatasetId(availableDatasets[0]?.id ?? null);
        return;
      }

      const notebookResponse = await api.get<Notebook>(`/notebooks/${id}`, {
        signal: request.signal,
      });

      if (!request.isCurrent()) {
        return;
      }

      const loadedNotebook = notebookResponse.data;
      setNotebookName(loadedNotebook.name || 'Untitled Notebook');
      setNotebookDescription(loadedNotebook.description || '');
      setCells(normalizeCells(loadedNotebook.content?.cells));

      const savedDatasetId = loadedNotebook.content?.dataset_id;
      const savedDatasetExists =
        typeof savedDatasetId === 'number' &&
        availableDatasets.some((dataset) => dataset.id === savedDatasetId);

      if (savedDatasetExists) {
        setSelectedDatasetId(savedDatasetId);
      } else {
        setSelectedDatasetId(null);

        if (typeof savedDatasetId === 'number') {
          setPageError(
            'The dataset previously selected for this notebook is no longer available. Select a replacement dataset before running SQL or Python, then save the notebook to update it.',
          );
        }
      }
    } catch (err: unknown) {
      if (!request.isCurrent() || isCanceledRequest(err)) {
        return;
      }
      setPageError(getApiErrorMessage(err, 'Failed to load the notebook.'));
    } finally {
      if (request.isCurrent()) {
        setPageLoading(false);
      }
      request.finish();
    }
  }, [id, isNew, pageRequest]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const handleSave = async () => {
    if (saveInFlightRef.current) {
      return;
    }

    setSaveError('');
    setSaved(false);

    const cleanName = notebookName.trim();

    if (!cleanName) {
      setSaveError('Notebook name is required.');
      return;
    }

    if (cells.length > MAX_NOTEBOOK_CELLS) {
      setSaveError(`A notebook can contain at most ${MAX_NOTEBOOK_CELLS} cells in V1.`);
      return;
    }

    const oversizedCell = cells.find(
      (cell) => cell.content.length > MAX_CELL_CONTENT_CHARS,
    );

    if (oversizedCell) {
      setSaveError(
        `Each cell is limited to ${MAX_CELL_CONTENT_CHARS.toLocaleString()} characters in V1.`,
      );
      return;
    }

    saveInFlightRef.current = true;
    setSaving(true);

    const content: NotebookContent = {
      dataset_id: selectedDatasetId,
      cells: cells.map((cell) => ({
        id: cell.id,
        type: cell.type,
        content: cell.content,
      })),
    };

    const contentBytes = new TextEncoder().encode(
      JSON.stringify(content),
    ).length;

    if (contentBytes > MAX_NOTEBOOK_CONTENT_BYTES) {
      saveInFlightRef.current = false;
      setSaving(false);
      setSaveError('Notebook content exceeds the 512 KB V1 limit.');
      return;
    }

    const payload = {
      name: cleanName,
      description: notebookDescription.trim() || null,
      content,
    };

    try {
      if (isNew) {
        const response = await api.post<Notebook>('/notebooks', payload);
        setSaved(true);
        setDirty(false);
        allowNextNavigation();
        navigate(`/notebooks/${response.data.id}`, { replace: true });
      } else {
        const response = await api.put<Notebook>(`/notebooks/${id}`, payload);
        setNotebookName(response.data.name);
        setSaved(true);
        setDirty(false);
      }

      window.setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setSaveError(getApiErrorMessage(err, 'Failed to save the notebook.'));
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const insertCell = (
    referenceId: string | null,
    position: 'above' | 'below' | 'end',
    type: CellType = 'sql',
  ) => {
    if (cells.length >= MAX_NOTEBOOK_CELLS) {
      setPageError(`A notebook can contain at most ${MAX_NOTEBOOK_CELLS} cells in V1.`);
      return;
    }

    const newCell: Cell = {
      id: crypto.randomUUID(),
      type,
      content: defaultContentForType(type),
    };

    setCells((current) => {
      if (position === 'end' || referenceId === null) {
        return [...current, newCell];
      }

      const index = current.findIndex((cell) => cell.id === referenceId);

      if (index === -1) {
        return [...current, newCell];
      }

      const insertAt = position === 'above' ? index : index + 1;

      return [
        ...current.slice(0, insertAt),
        newCell,
        ...current.slice(insertAt),
      ];
    });

    markDirty();
  };

  const removeCell = (cellId: string) => {
    setCells((current) => {
      if (current.length <= 1) {
        return current;
      }

      return current.filter((cell) => cell.id !== cellId);
    });

    markDirty();
  };

  const moveCell = (
  cellId: string,
  direction: 'up' | 'down',
) => {
  setCells((current) => {
    const fromIndex = current.findIndex(
      (cell) => cell.id === cellId,
    );

    if (fromIndex === -1) {
      return current;
    }

    const targetIndex =
      direction === 'up'
        ? fromIndex - 1
        : fromIndex + 1;

    if (
      targetIndex < 0 ||
      targetIndex >= current.length
    ) {
      return current;
    }

    const next = [...current];

    const [movedCell] = next.splice(
      fromIndex,
      1,
    );

    if (!movedCell) {
      return current;
    }

    next.splice(
      targetIndex,
      0,
      movedCell,
    );

    return next;
  });

  markDirty();
};

  const getPythonRuntime = (): PythonRuntime => {
    if (!pythonRuntimeRef.current) {
      pythonRuntimeRef.current = new PythonRuntime();
    }

    return pythonRuntimeRef.current;
  };

  const resetPythonRuntime = (
    message = 'Python runtime reset. State from previous Python cells was cleared.',
  ) => {
    pythonRuntimeRef.current?.reset(message);
    pythonDatasetCacheRef.current.clear();
    setPythonBusy(false);
    setCells((current) =>
      current.map((cell) =>
        cell.type === 'python'
          ? { ...cell, loading: false, output: undefined }
          : cell,
      ),
    );
    setPythonStatus(message);

    window.setTimeout(() => {
      setPythonStatus('');
    }, 3000);
  };

  const getPythonDataset = async (
    datasetId: number,
  ): Promise<PythonDatasetPayload> => {
    const cached = pythonDatasetCacheRef.current.get(datasetId);

    if (cached) {
      return cached;
    }

    const dataset = await loadPythonDataset(datasetId);
    pythonDatasetCacheRef.current.set(datasetId, dataset);
    return dataset;
  };

  const executeCell = async (cellId: string) => {
    const cell = cells.find((candidate) => candidate.id === cellId);

    if (!cell || cell.type === 'markdown') {
      return;
    }

    if (!selectedDatasetId) {
      setCellOutput(cellId, {
        kind: 'error',
        success: false,
        error: 'Upload and select a dataset before running this cell.',
      });
      return;
    }

    if (!cell.content.trim()) {
      setCellOutput(cellId, {
        kind: 'error',
        success: false,
        error:
          cell.type === 'python'
            ? 'Python code cannot be empty.'
            : 'SQL query cannot be empty.',
      });
      return;
    }

    setCells((current) =>
      current.map((candidate) =>
        candidate.id === cellId
          ? { ...candidate, loading: true, output: undefined }
          : candidate,
      ),
    );

    if (cell.type === 'python') {
      setPythonBusy(true);
      setPythonStatus('');

      try {
        const dataset = await getPythonDataset(selectedDatasetId);
        const result = await getPythonRuntime().run(cell.content, dataset);

        setCellOutput(cellId, {
          kind: 'python',
          ...result,
          datasetName: dataset.name,
          datasetTruncated: dataset.truncated,
          datasetLoadedRows: dataset.loadedRowCount,
          datasetSourceRows: dataset.sourceRowCount,
          datasetRowLimit: dataset.rowLimit,
        });
      } catch (err: unknown) {
        setCellOutput(cellId, {
          kind: 'error',
          success: false,
          error: getExecutionErrorMessage(
            err,
            'Python execution failed.',
          ),
        });
      } finally {
        setPythonBusy(false);
      }

      return;
    }

    try {
      const response = await api.post<SqlApiResponse>('/sql/query', {
        query: cell.content,
        dataset_id: selectedDatasetId,
        limit: 100,
      });

      setCellOutput(cellId, {
        kind: 'sql',
        ...response.data,
      });
    } catch (err: unknown) {
      setCellOutput(cellId, {
        kind: 'error',
        success: false,
        error: getApiErrorMessage(err, 'SQL execution failed.'),
      });
    }
  };

  const setCellOutput = (cellId: string, output: CellOutput) => {
    setCells((current) =>
      current.map((cell) =>
        cell.id === cellId
          ? { ...cell, loading: false, output }
          : cell,
      ),
    );
  };

  const updateCell = (cellId: string, content: string) => {
    setCells((current) =>
      current.map((cell) =>
        cell.id === cellId ? { ...cell, content } : cell,
      ),
    );

    markDirty();
  };

  const changeCellType = (cellId: string, type: CellType) => {
    setCells((current) =>
      current.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              type,
              content: cell.content || defaultContentForType(type),
              output: undefined,
              loading: false,
            }
          : cell,
      ),
    );

    markDirty();
  };

  const copyOutput = async (output: CellOutput) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    } catch {
      setPageError('Could not copy the output to the clipboard.');
    }
  };

  if (pageLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="sticky top-16 z-10 border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
            <input
              type="text"
              value={notebookName}
              maxLength={255}
              onChange={(event) => {
                setNotebookName(event.target.value);
                markDirty();
              }}
              className="w-full min-w-0 bg-transparent text-xl font-bold text-gray-900 outline-none md:w-72 dark:text-white"
              placeholder="Untitled Notebook"
              aria-label="Notebook name"
            />

            <div className="flex min-w-0 items-center gap-2">
              <Database className="h-4 w-4 flex-shrink-0 text-gray-400" />

              <select
                value={selectedDatasetId ?? ''}
                disabled={datasets.length === 0}
                onChange={(event) => {
                  const value = event.target.value;

                  setSelectedDatasetId(
                    value ? Number(value) : null,
                  );

                  setPageError('');
                  setCells((current) =>
                    current.map((cell) => ({
                      ...cell,
                      loading: false,
                      output: undefined,
                    })),
                  );

                  if (
                    pythonRuntimeRef.current ||
                    cells.some((cell) => cell.type === 'python')
                  ) {
                    resetPythonRuntime(
                      'Python runtime reset because the selected dataset changed.',
                    );
                  } else {
                    pythonDatasetCacheRef.current.clear();
                  }

                  markDirty();
                }}
                className="max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                aria-label="Selected dataset"
              >
                {datasets.length === 0 ? (
  <option value="">
    No datasets available
  </option>
) : (
  <>
    <option value="" disabled>
      Select a dataset
    </option>

    {datasets.map((dataset) => (
      <option
        key={dataset.id}
        value={dataset.id}
      >
        {dataset.name}
      </option>
    ))}
  </>
)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={goToNotebookList}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ArrowLeft className="h-4 w-4" />
              All Notebooks
            </button>

            {dirty && (
              <span className="text-sm text-amber-700 dark:text-amber-300">
                Unsaved changes
              </span>
            )}

            {cells.some((cell) => cell.type === 'python') && (
              <button
                type="button"
                onClick={() => resetPythonRuntime()}
                className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                title="Restart browser Python and clear Python variables"
              >
                <RotateCcw className="h-4 w-4" />
                Reset Python
              </button>
            )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
          </button>
          </div>
        </div>

        <input
          type="text"
          value={notebookDescription}
          maxLength={5000}
          onChange={(event) => {
            setNotebookDescription(event.target.value);
            markDirty();
          }}
          className="mt-3 w-full bg-transparent text-sm text-gray-600 outline-none placeholder:text-gray-400 dark:text-gray-300"
          placeholder="Add a notebook description (optional)"
          aria-label="Notebook description"
        />

        {pythonStatus && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
            <RotateCcw className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{pythonStatus}</span>
          </div>
        )}

        {datasets.length === 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>Upload a CSV dataset before running SQL or Python cells.</span>
          </div>
        )}

        {pageError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{pageError}</span>
          </div>
        )}

        {saveError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{saveError}</span>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {cells.map((cell, index) => (
          <CellComponent
            key={cell.id}
            cell={cell}
            index={index}
            canMoveDown={index < cells.length - 1}
            selectedDatasetId={selectedDatasetId}
            pythonBusy={pythonBusy}
            onUpdate={(content) => updateCell(cell.id, content)}
            onExecute={() => void executeCell(cell.id)}
            onRemove={() => removeCell(cell.id)}
            onMoveUp={() => moveCell(cell.id, 'up')}
            onMoveDown={() => moveCell(cell.id, 'down')}
            onAddAbove={() => insertCell(cell.id, 'above', 'sql')}
            onAddBelow={() => insertCell(cell.id, 'below', 'sql')}
            onChangeType={(type) => changeCellType(cell.id, type)}
            onCopyOutput={() => {
              if (cell.output) {
                void copyOutput(cell.output);
              }
            }}
          />
        ))}

        <div className="py-8 text-center text-gray-400">
          <p>End of notebook</p>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => insertCell(null, 'end', 'sql')}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              SQL
            </button>

            <button
              type="button"
              onClick={() => insertCell(null, 'end', 'markdown')}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Markdown
            </button>

            <button
              type="button"
              onClick={() => insertCell(null, 'end', 'python')}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Python
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface CellComponentProps {
  cell: Cell;
  index: number;
  canMoveDown: boolean;
  selectedDatasetId: number | null;
  pythonBusy: boolean;
  onUpdate: (content: string) => void;
  onExecute: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddAbove: () => void;
  onAddBelow: () => void;
  onChangeType: (type: CellType) => void;
  onCopyOutput: () => void;
}

function CellComponent({
  cell,
  index,
  canMoveDown,
  selectedDatasetId,
  pythonBusy,
  onUpdate,
  onExecute,
  onRemove,
  onMoveUp,
  onMoveDown,
  onAddAbove,
  onAddBelow,
  onChangeType,
  onCopyOutput,
}: CellComponentProps) {
  const canRun =
    (cell.type === 'sql' || cell.type === 'python') &&
    selectedDatasetId !== null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
        <select
          aria-label={`Cell ${index + 1} type`}
          value={cell.type}
          onChange={(event) => onChangeType(event.target.value as CellType)}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="sql">SQL</option>
          <option value="markdown">Markdown</option>
          <option value="python">Python</option>
        </select>

        <span className="text-sm text-gray-500 dark:text-gray-400">
          Cell {index + 1}
        </span>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAddAbove}
            className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
            title="Add SQL cell above"
            aria-label="Add cell above"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onAddBelow}
            className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
            title="Add SQL cell below"
            aria-label="Add cell below"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded p-1.5 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700"
            title="Move up"
            aria-label="Move cell up"
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="rounded p-1.5 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700"
            title="Move down"
            aria-label="Move cell down"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
            title="Delete cell"
            aria-label="Delete cell"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className="p-3"
        style={{ height: cell.type === 'markdown' ? '220px' : '300px' }}
      >
        <Editor
  key={`${cell.id}-${index}`}
  height="100%"
  language={languageForCell(cell.type)}
  value={cell.content}
          onChange={(value) => onUpdate(value || '')}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </div>

      {cell.type !== 'markdown' && (
        <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onExecute}
              aria-busy={cell.loading}
              disabled={
                cell.loading ||
                !canRun ||
                (cell.type === 'python' && pythonBusy)
              }
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cell.loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              {cell.loading
                ? cell.type === 'python'
                  ? 'Running Python...'
                  : 'Running SQL...'
                : cell.type === 'python'
                  ? 'Run Python'
                  : 'Run SQL'}
            </button>

            {!selectedDatasetId && (
              <span className="text-sm text-amber-700 dark:text-amber-300">
                Select a dataset before running this cell.
              </span>
            )}

            {cell.type === 'python' && selectedDatasetId && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Python runs in a dedicated browser worker rather than on the server. It is not a security sandbox for untrusted code. The selected dataset is available as pandas DataFrame <code>df</code>.
              </span>
            )}
          </div>
        </div>
      )}

      {cell.output && (
        <div className="border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Output
            </span>

            <button
              type="button"
              onClick={onCopyOutput}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
              title="Copy output JSON"
              aria-label="Copy output JSON"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <OutputView output={cell.output} />
        </div>
      )}
    </div>
  );
}

function OutputView({ output }: { output: CellOutput }): ReactNode {
  if (output.kind === 'error') {
    return (
      <div role="alert" className="overflow-auto rounded-lg border border-red-200 bg-red-50 p-4 font-mono text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
        <pre className="whitespace-pre-wrap">{output.error || 'Execution failed.'}</pre>
      </div>
    );
  }

  if (output.kind === 'python') {
    return <PythonOutputView output={output} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{output.row_count.toLocaleString()} row(s) returned</span>
        <span>{output.execution_ms.toFixed(2)} ms</span>
        <span>Server limit: {output.limit.toLocaleString()}</span>
      </div>

      {output.truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Result truncated. Showing the first {output.row_count.toLocaleString()} rows because this notebook currently limits each SQL result to {output.limit.toLocaleString()} rows.
          </span>
        </div>
      )}

      {output.columns.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Query completed without tabular output.
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-gray-100 dark:bg-gray-700">
              <tr>
                {output.columns.map((column, index) => (
                  <th
                    scope="col"
                    key={`${column}-${index}`}
                    className="whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left font-medium dark:border-gray-600"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {output.data.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={
                    rowIndex % 2 === 0
                      ? 'bg-white dark:bg-gray-800'
                      : 'bg-gray-50 dark:bg-gray-700/60'
                  }
                >
                  {output.columns.map((column, columnIndex) => (
                    <td
                      key={`${rowIndex}-${columnIndex}`}
                      className="max-w-md whitespace-nowrap border-b border-gray-200 px-3 py-2 font-mono dark:border-gray-700"
                    >
                      {formatCellValue(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PythonOutputView({ output }: { output: PythonOutput }): ReactNode {
  const hasTextOutput = Boolean(
    output.stdout || output.stderr || output.result,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{output.executionMs.toFixed(2)} ms</span>
        <span>Dataset: {output.datasetName}</span>
        <span>
          df rows: {output.datasetLoadedRows.toLocaleString()}
          {output.datasetSourceRows !== null
            ? ` / ${output.datasetSourceRows.toLocaleString()}`
            : ''}
        </span>
      </div>

      {output.datasetTruncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Python received only the first {output.datasetLoadedRows.toLocaleString()} rows of this dataset because the V1 Python bridge is limited to {output.datasetRowLimit.toLocaleString()} rows.
          </span>
        </div>
      )}

      {output.outputTruncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Python output was truncated at the V1 output limit.
          </span>
        </div>
      )}

      {!output.success && output.error && (
        <div role="alert" className="overflow-auto rounded-lg border border-red-200 bg-red-50 p-4 font-mono text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          <pre className="whitespace-pre-wrap">{output.error}</pre>
        </div>
      )}

      {output.stdout && (
        <PythonTextBlock label="stdout" value={output.stdout} />
      )}

      {output.stderr && (
        <PythonTextBlock label="stderr" value={output.stderr} tone="warning" />
      )}

      {output.result && (
        <PythonTextBlock label="result" value={output.result} />
      )}

      {output.success && !hasTextOutput && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Python completed without text output.
        </p>
      )}
    </div>
  );
}

function PythonTextBlock({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warning';
}) {
  const toneClasses =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
      : 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div className={`overflow-auto rounded-lg border p-3 ${toneClasses}`}>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide opacity-60">
        {label}
      </div>
      <pre className="whitespace-pre-wrap font-mono text-sm">{value}</pre>
    </div>
  );
}

function normalizeCells(rawCells: NotebookContent['cells']): Cell[] {
  if (!Array.isArray(rawCells) || rawCells.length === 0) {
    return createDefaultCells();
  }

  return rawCells.map((rawCell) => {
    const type = isCellType(rawCell.type) ? rawCell.type : 'sql';

    return {
      id:
        typeof rawCell.id === 'string' && rawCell.id
          ? rawCell.id
          : crypto.randomUUID(),
      type,
      content:
        typeof rawCell.content === 'string'
          ? rawCell.content
          : defaultContentForType(type),
    };
  });
}

function isCellType(value: unknown): value is CellType {
  return value === 'sql' || value === 'python' || value === 'markdown';
}

function defaultContentForType(type: CellType): string {
  if (type === 'sql') {
    return 'SELECT * FROM dataset LIMIT 10';
  }

  if (type === 'python') {
    return '# The selected dataset is available as pandas DataFrame `df`.\nprint(df.head())';
  }

  return '# Markdown';
}

function languageForCell(type: CellType): string {
  if (type === 'sql') {
    return 'sql';
  }

  if (type === 'python') {
    return 'python';
  }

  return 'markdown';
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
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

function getExecutionErrorMessage(err: unknown, fallback: string): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'response' in err
  ) {
    return getApiErrorMessage(err, fallback);
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return fallback;
}

