import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Database,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';

import { api, UPLOAD_API_TIMEOUT_MS } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { isCanceledRequest, useLatestRequest } from '../hooks/useLatestRequest';
import { AccessibleDialog } from '../components/AccessibleDialog';

interface SchemaColumn {
  name: string;
  type: string;
}

interface DatasetSchema {
  columns?: SchemaColumn[];
  row_count?: number;
  sample_row_count?: number;
  sample_data?: Record<string, unknown>[];
}

interface Dataset {
  id: number;
  name: string;
  description: string | null;
  type: string;
  schema_info: DatasetSchema | null;
  owner_id: number;
  created_at: string;
  updated_at: string | null;
}

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);

  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState('');
  const [datasetDescription, setDatasetDescription] = useState('');

  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [pageError, setPageError] = useState('');
  const [uploadError, setUploadError] = useState('');

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const datasetListRequest = useLatestRequest();

  const fetchDatasets = useCallback(async () => {
    const request = datasetListRequest.begin();
    setLoading(true);
    setPageError('');

    try {
      const response = await api.get<Dataset[]>('/datasets', {
        signal: request.signal,
      });

      if (!request.isCurrent()) {
        return;
      }

      setDatasets(response.data);
    } catch (err: unknown) {
      if (!request.isCurrent() || isCanceledRequest(err)) {
        return;
      }

      setPageError(
        getApiErrorMessage(
          err,
          'Failed to load datasets.',
        ),
      );
    } finally {
      if (request.isCurrent()) {
        setLoading(false);
      }
      request.finish();
    }
  }, [datasetListRequest]);

  useEffect(() => {
    void fetchDatasets();
  }, [fetchDatasets]);

  const openUploadModal = () => {
    setUploadError('');
    setShowUpload(true);
  };

  const closeUploadModal = () => {
    if (uploading) {
      return;
    }

    setShowUpload(false);
    setSelectedFile(null);
    setDatasetName('');
    setDatasetDescription('');
    setUploadError('');
  };

  const handleFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setUploadError('');

    const file = e.target.files?.[0];

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const extension = getFileExtension(file.name);

    if (extension !== '.csv') {
      setSelectedFile(null);
      e.target.value = '';

      setUploadError(
        'Phase 3 currently supports CSV files only.',
      );

      return;
    }

    if (file.size === 0) {
      setSelectedFile(null);
      e.target.value = '';

      setUploadError(
        'The selected file is empty.',
      );

      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setSelectedFile(null);
      e.target.value = '';

      setUploadError(
        'The selected file exceeds the 100 MB upload limit.',
      );

      return;
    }

    setSelectedFile(file);

    if (!datasetName.trim()) {
      setDatasetName(
        file.name.replace(/\.[^/.]+$/, ''),
      );
    }
  };

  const handleUpload = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();

    setUploadError('');

    const cleanName = datasetName.trim();

    if (!cleanName) {
      setUploadError(
        'Please enter a dataset name.',
      );
      return;
    }

    if (!selectedFile) {
      setUploadError(
        'Please select a CSV file.',
      );
      return;
    }

    if (
      getFileExtension(selectedFile.name) !== '.csv'
    ) {
      setUploadError(
        'Phase 3 currently supports CSV files only.',
      );
      return;
    }

    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        'The selected file exceeds the 100 MB upload limit.',
      );
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();

      formData.append('file', selectedFile);
      formData.append('name', cleanName);
      formData.append(
        'description',
        datasetDescription.trim(),
      );

      /*
       * Do not manually set Content-Type here.
       *
       * The browser/Axios will generate the required
       * multipart boundary automatically.
       */
      const response = await api.post<Dataset>(
        '/datasets/upload',
        formData,
        { timeout: UPLOAD_API_TIMEOUT_MS },
      );

      setDatasets((current) => [
        response.data,
        ...current.filter(
          (dataset) =>
            dataset.id !== response.data.id,
        ),
      ]);

      setExpandedId(response.data.id);

      setSelectedFile(null);
      setDatasetName('');
      setDatasetDescription('');
      setUploadError('');
      setShowUpload(false);
    } catch (err: unknown) {
      setUploadError(
        getApiErrorMessage(
          err,
          'Upload failed. Please try again.',
        ),
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (
    dataset: Dataset,
  ) => {
    const confirmed = window.confirm(
      `Delete "${dataset.name}"?\n\nThis will permanently remove the dataset and its uploaded file.`,
    );

    if (!confirmed) {
      return;
    }

    setPageError('');
    setDeletingId(dataset.id);

    try {
      await api.delete(
        `/datasets/${dataset.id}`,
      );

      setDatasets((current) =>
        current.filter(
          (item) => item.id !== dataset.id,
        ),
      );

      setExpandedId((current) =>
        current === dataset.id
          ? null
          : current,
      );
    } catch (err: unknown) {
      setPageError(
        getApiErrorMessage(
          err,
          'Could not delete the dataset.',
        ),
      );
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(
      dateStr,
    ).toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
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
            Datasets
          </h1>

          <p className="text-gray-600 dark:text-gray-400">
            Upload and inspect datasets used by your notebooks.
          </p>
        </div>

        <button
          type="button"
          onClick={openUploadModal}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
        >
          <Upload className="h-4 w-4" />
          Upload Dataset
        </button>
      </div>

      {pageError && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <span>{pageError}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchDatasets()}
            className="flex-shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
          >
            Retry
          </button>
        </div>
      )}

      {datasets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <Database className="mx-auto mb-4 h-16 w-16 text-gray-300 dark:text-gray-600" />

          <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">
            No datasets yet
          </h3>

          <p className="mb-6 text-gray-500 dark:text-gray-400">
            Upload a CSV file to create your first dataset.
          </p>

          <button
            type="button"
            onClick={openUploadModal}
            className="rounded-lg bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-700"
          >
            Upload Dataset
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px]">
              <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Name
                  </th>

                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Type
                  </th>

                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Rows
                  </th>

                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Columns
                  </th>

                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Created
                  </th>

                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {datasets.map((dataset) => {
                  const isExpanded =
                    expandedId === dataset.id;

                  const schema =
                    dataset.schema_info;

                  const columnCount =
                    schema?.columns?.length ?? 0;

                  const rowCount =
                    schema?.row_count;

                  return (
                    <Fragment key={dataset.id}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-gray-100 p-2 dark:bg-gray-700">
                              <FileText className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                            </div>

                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white">
                                {dataset.name}
                              </p>

                              {dataset.description && (
                                <p className="max-w-sm truncate text-sm text-gray-500 dark:text-gray-400">
                                  {dataset.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium capitalize text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                            {dataset.type}
                          </span>
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                          {typeof rowCount === 'number'
                            ? rowCount.toLocaleString()
                            : '—'}
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                          {columnCount || '—'}
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                          {formatDate(
                            dataset.created_at,
                          )}
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedId(
                                  isExpanded
                                    ? null
                                    : dataset.id,
                                )
                              }
                              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                              aria-label={
                                isExpanded
                                  ? `Collapse ${dataset.name}`
                                  : `Expand ${dataset.name}`
                              }
                              title={
                                isExpanded
                                  ? 'Hide schema and preview'
                                  : 'Show schema and preview'
                              }
                            >
                              <ChevronDown
                                className={`h-5 w-5 transition-transform ${
                                  isExpanded
                                    ? 'rotate-180'
                                    : ''
                                }`}
                              />
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void handleDelete(
                                  dataset,
                                )
                              }
                              disabled={
                                deletingId ===
                                dataset.id
                              }
                              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/30"
                              aria-label={`Delete ${dataset.name}`}
                              title="Delete dataset"
                            >
                              {deletingId ===
                              dataset.id ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                              ) : (
                                <Trash2 className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={6}
                            className="bg-gray-50 px-6 py-6 dark:bg-gray-900/40"
                          >
                            <DatasetDetails
                              dataset={dataset}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showUpload && (
        <AccessibleDialog
          title="Upload Dataset"
          description="Phase 3 currently supports CSV files."
          onClose={closeUploadModal}
          closeDisabled={uploading}
          closeLabel="Close upload dialog"
          panelClassName="max-h-[90vh] max-w-lg overflow-y-auto rounded-xl"
        >
            <form
              onSubmit={handleUpload}
              className="space-y-5 p-6"
            >
              {uploadError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="dataset-name"
                  className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Dataset name
                </label>

                <input
                  id="dataset-name"
                  data-dialog-initial-focus
                  type="text"
                  required
                  maxLength={255}
                  value={datasetName}
                  onChange={(e) =>
                    setDatasetName(
                      e.target.value,
                    )
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  placeholder="Example: October sales"
                />
              </div>

              <div>
                <label
                  htmlFor="dataset-description"
                  className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Description
                  <span className="font-normal text-gray-400">
                    {' '}
                    (optional)
                  </span>
                </label>

                <textarea
                  id="dataset-description"
                  value={datasetDescription}
                  onChange={(e) =>
                    setDatasetDescription(
                      e.target.value,
                    )
                  }
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  placeholder="What does this dataset contain?"
                />
              </div>

              <div>
                <label
                  htmlFor="dataset-file"
                  className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  CSV file
                </label>

                <input
                  id="dataset-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileSelect}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />

                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  CSV only. Maximum size:
                  {' '}
                  100 MB.
                </p>
              </div>

              {selectedFile && (
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                        {selectedFile.name}
                      </p>

                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        CSV file selected
                      </p>
                    </div>

                    <span className="whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatFileSize(
                        selectedFile.size,
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeUploadModal}
                  disabled={uploading}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    uploading ||
                    !selectedFile ||
                    !datasetName.trim()
                  }
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </span>
                  ) : (
                    'Upload Dataset'
                  )}
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}
    </div>
  );
}

function DatasetDetails({
  dataset,
}: {
  dataset: Dataset;
}) {
  const schema = dataset.schema_info;

  const columns = schema?.columns ?? [];
  const sampleData = schema?.sample_data ?? [];

  if (!schema) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Schema information is not available for this dataset.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Dataset summary
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label="Rows"
            value={
              typeof schema.row_count ===
              'number'
                ? schema.row_count.toLocaleString()
                : '—'
            }
          />

          <SummaryCard
            label="Columns"
            value={columns.length.toString()}
          />

          <SummaryCard
            label="Preview rows"
            value={sampleData.length.toString()}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Schema
        </h3>

        {columns.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No columns were detected.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full">
              <thead className="bg-white dark:bg-gray-800">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    Column
                  </th>

                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    Detected type
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                {columns.map(
                  (column, index) => (
                    <tr
                      key={`${column.name}-${index}`}
                    >
                      <td className="px-4 py-2 font-mono text-sm text-gray-800 dark:text-gray-200">
                        {column.name}
                      </td>

                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                        {column.type}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          First rows
        </h3>

        {sampleData.length === 0 ||
        columns.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No preview rows are available.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full">
              <thead className="bg-white dark:bg-gray-800">
                <tr>
                  {columns.map(
                    (column, index) => (
                      <th
                        key={`${column.name}-${index}`}
                        className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400"
                      >
                        {column.name}
                      </th>
                    ),
                  )}
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                {sampleData.map(
                  (row, rowIndex) => (
                    <tr key={rowIndex}>
                      {columns.map(
                        (
                          column,
                          columnIndex,
                        ) => (
                          <td
                            key={`${rowIndex}-${columnIndex}`}
                            className="max-w-xs whitespace-nowrap px-4 py-2 text-sm text-gray-700 dark:text-gray-300"
                          >
                            {formatCellValue(
                              row[
                                column.name
                              ],
                            )}
                          </td>
                        ),
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>

      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function getFileExtension(
  filename: string,
) {
  const index = filename.lastIndexOf('.');

  if (index === -1) {
    return '';
  }

  return filename
    .slice(index)
    .toLowerCase();
}

function formatFileSize(
  bytes: number,
) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(
      bytes / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(2)} MB`;
}

function formatCellValue(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 'null';
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
