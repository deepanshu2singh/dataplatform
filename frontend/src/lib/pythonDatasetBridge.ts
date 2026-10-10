import { api } from './api';

export interface PythonDatasetPayload {
  id: number;
  name: string;
  csvText: string;
  sourceRowCount: number | null;
  loadedRowCount: number;
  truncated: boolean;
  rowLimit: number;
}

interface PythonDatasetExportResponse {
  dataset_id: number;
  dataset_name: string;
  csv_text: string;
  source_row_count: number | null;
  loaded_row_count: number;
  truncated: boolean;
  row_limit: number;
}

export async function loadPythonDataset(
  datasetId: number,
): Promise<PythonDatasetPayload> {
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    throw new Error('A valid dataset ID is required.');
  }

  const response = await api.get<PythonDatasetExportResponse>(
    `/datasets/${datasetId}/python-export`,
  );

  return {
    id: response.data.dataset_id,
    name: response.data.dataset_name,
    csvText: response.data.csv_text,
    sourceRowCount: response.data.source_row_count,
    loadedRowCount: response.data.loaded_row_count,
    truncated: response.data.truncated,
    rowLimit: response.data.row_limit,
  };
}
