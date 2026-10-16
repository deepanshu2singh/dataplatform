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
  csv_text: string | null;
  download_url?: string | null;
  csv_size_bytes?: number | null;
  sha256?: string | null;
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

  let csvText = response.data.csv_text;
  if (response.data.download_url) {
    const expected = response.data.csv_size_bytes;
    const digest = response.data.sha256;
    const url = new URL(response.data.download_url);
    if (url.protocol !== 'https:' || url.username || url.password
      || !Number.isSafeInteger(expected) || expected! < 1 || expected! > 10 * 1024 * 1024
      || !digest || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error('The dataset download metadata is invalid.');
    }
    const result = await fetch(url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!result.ok || !result.body) throw new Error('Dataset download failed. Please retry.');
    const reader = result.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > expected!) throw new Error('The dataset download exceeded its expected size.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== expected) throw new Error('The dataset download was incomplete. Please retry.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== digest) throw new Error('The dataset download failed its integrity check.');
    csvText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  if (typeof csvText !== 'string') throw new Error('The dataset export is unavailable.');

  return {
    id: response.data.dataset_id,
    name: response.data.dataset_name,
    csvText,
    sourceRowCount: response.data.source_row_count,
    loadedRowCount: response.data.loaded_row_count,
    truncated: response.data.truncated,
    rowLimit: response.data.row_limit,
  };
}
