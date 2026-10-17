import { api } from './api';

export const EXPORT_CATEGORIES = ['datasets', 'notebooks', 'dashboards', 'uploads'] as const;
export type ExportCategory = typeof EXPORT_CATEGORIES[number];
export interface ExportItem { id: string; name: string; revision: string; source_file: boolean }
export interface ExportCatalog { items: ExportItem[]; next_cursor: string | null }
export interface ExportAuthorization {
  proof: string; expires_in_seconds: number; account: Record<string, unknown>; max_file_bytes: number;
}
export interface ExportCursor {
  category: number; after: string | null; pending: ExportItem[];
  next: string | null; loaded: boolean; part: number;
}
export const emptyExportCursor = (): ExportCursor => ({ category: 0, after: null, pending: [], next: null, loaded: false, part: 0 });
const RECORD_MAX = 32 * 1024 * 1024;
const FRAGMENT_MAX = 384 * 1024;
const PART_TARGET = 4 * 1024 * 1024;
const invalid = () => new Error('The export response was incomplete or invalid. No complete file was prepared; please try again.');
const post = async <T>(path: string, data: unknown, signal: AbortSignal): Promise<T> =>
  (await api.post<T>(`/account-data/${path}`, data, { signal })).data;

export async function exportCatalog(proof: string, category: ExportCategory, after: string | null, signal: AbortSignal): Promise<ExportCatalog> {
  const value = await post<ExportCatalog>('catalog', { proof, category, after }, signal);
  if (!value || !Array.isArray(value.items) || value.items.length > 25) throw invalid();
  let previous = after;
  for (const item of value.items) {
    const validId = category === 'uploads' ? /^[0-9a-f]{32}$/.test(item.id) : /^[1-9][0-9]{0,9}$/.test(item.id);
    const advancing = previous === null || (category === 'uploads' ? item.id > previous : Number(item.id) > Number(previous));
    if (!validId || !advancing || typeof item.name !== 'string' || typeof item.revision !== 'string' || !item.revision || typeof item.source_file !== 'boolean') throw invalid();
    previous = item.id;
  }
  if (value.next_cursor !== null && (!value.items.length || value.next_cursor !== previous)) throw invalid();
  signal.throwIfAborted();
  return value;
}

async function recordBytes(proof: string, category: ExportCategory, item: ExportItem, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  let offset = 0;
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  let digest = '';
  while (true) {
    const chunk = await post<{ data_base64: string; total_bytes: number; next_offset: number | null; sha256: string }>(
      'record', { proof, category, record_id: item.id, revision: item.revision, offset }, signal);
    if (!chunk || !Number.isInteger(chunk.total_bytes) || chunk.total_bytes < 1 || chunk.total_bytes > RECORD_MAX ||
      typeof chunk.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(chunk.sha256) || typeof chunk.data_base64 !== 'string' || chunk.data_base64.length > Math.ceil(FRAGMENT_MAX / 3) * 4) throw invalid();
    if (bytes === null) { bytes = new Uint8Array(chunk.total_bytes); digest = chunk.sha256; }
    if (bytes.length !== chunk.total_bytes || digest !== chunk.sha256) throw invalid();
    let decoded: Uint8Array<ArrayBuffer>;
    try { decoded = Uint8Array.from(atob(chunk.data_base64), (c) => c.charCodeAt(0)); } catch { throw invalid(); }
    if (!decoded.length || decoded.length > FRAGMENT_MAX || offset + decoded.length > bytes.length) throw invalid();
    bytes.set(decoded, offset); offset += decoded.length;
    if (chunk.next_offset === null) { if (offset !== bytes.length) throw invalid(); break; }
    if (chunk.next_offset !== offset || decoded.length !== FRAGMENT_MAX || offset >= bytes.length) throw invalid();
    signal.throwIfAborted();
  }
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted();
  if (actual !== digest) throw invalid();
  return bytes;
}

export async function prepareExportPart(options: {
  proof: string; account: Record<string, unknown>; cursor: ExportCursor; signal: AbortSignal;
  startedAt: string; onProgress?: (records: number) => void; targetBytes?: number;
}) {
  const { proof, account, signal } = options;
  const cursor: ExportCursor = { ...options.cursor, pending: [...options.cursor.pending] };
  const pieces: BlobPart[] = [];
  const inventory: { category: ExportCategory; id: string; revision: string }[] = [];
  let size = 0;
  while (cursor.category < EXPORT_CATEGORIES.length) {
    if (!cursor.pending.length) {
      if (cursor.loaded) {
        if (cursor.next === null) { cursor.category += 1; cursor.after = null; }
        else cursor.after = cursor.next;
        cursor.loaded = false;
        if (cursor.category >= EXPORT_CATEGORIES.length) break;
      }
      const page = await exportCatalog(proof, EXPORT_CATEGORIES[cursor.category], cursor.after, signal);
      cursor.pending = [...page.items]; cursor.next = page.next_cursor; cursor.loaded = true;
      if (!cursor.pending.length) continue;
    }
    const kind = EXPORT_CATEGORIES[cursor.category];
    const item = cursor.pending.shift()!;
    const data = await recordBytes(proof, kind, item, signal);
    if (inventory.length) pieces.push(',');
    pieces.push(`{"kind":${JSON.stringify(kind)},"data":`, data.buffer, '}');
    inventory.push({ category: kind, id: item.id, revision: item.revision });
    size += data.length;
    options.onProgress?.(inventory.length);
    if (!cursor.pending.length && cursor.next === null) { cursor.category += 1; cursor.after = null; cursor.loaded = false; }
    if (inventory.length >= 25 || size >= (options.targetBytes ?? PART_TARGET)) break;
  }
  signal.throwIfAborted();
  cursor.part += 1;
  const complete = cursor.category >= EXPORT_CATEGORIES.length;
  const metadata = {
    format: 'dataplatform.workspace-export.v1', part: cursor.part, final_part: complete,
    started_at: options.startedAt, prepared_at: new Date().toISOString(), account,
    inventory,
    notes: ['Keep every numbered part to retain the complete workspace export.',
      'Each saved item is copied at its stated revision; this is not an atomic whole-database snapshot.',
      'Original CSV files are separate private downloads. External databases, credentials, provider logs and backups are not included.',
      'Saved code and outputs may contain sensitive information. Keep these downloaded files private.'],
  };
  const opening = JSON.stringify(metadata).slice(0, -1) + ',"records":[';
  return { blob: new Blob([opening, ...pieces, ']}'], { type: 'application/json;charset=utf-8' }), cursor, complete, records: inventory.length };
}

export async function originalCsv(proof: string, datasetId: number, signal: AbortSignal, onProgress?: (bytes: number) => void) {
  const file = await post<{ url: string; filename: string; max_bytes: number }>('dataset-file', { proof, dataset_id: datasetId }, signal);
  let url: URL;
  try { url = new URL(file.url); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.pathname.startsWith('/storage/v1/object/sign/') || !url.searchParams.get('token') ||
    !/^dataset-[1-9][0-9]*\.csv$/.test(file.filename) || !Number.isInteger(file.max_bytes) || file.max_bytes < 1) throw invalid();
  const maximum = Math.min(file.max_bytes, 50_000_000);
  const response = await fetch(url.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('The source file could not be downloaded. Please try again.');
  if (Number(response.headers.get('Content-Length')) > maximum) { await response.body.cancel(); throw new Error('The source file exceeds the permitted download size.'); }
  const reader = response.body.getReader();
  const pieces: BlobPart[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      signal.throwIfAborted();
      received += value.byteLength;
      if (received > maximum) throw new Error('The source file exceeds the permitted download size.');
      // Copy into an owned ArrayBuffer for Blob and release reader buffers promptly.
      pieces.push(new Uint8Array(value).buffer); onProgress?.(received);
    }
    signal.throwIfAborted();
    if (!received) throw new Error('The source file was empty. No file was prepared.');
    return { blob: new Blob(pieces, { type: 'text/csv' }), filename: file.filename };
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export function startDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noopener';
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); }
  // Give the browser time to consume the Blob; never persist its URL.
  const timer = window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return () => { window.clearTimeout(timer); URL.revokeObjectURL(url); };
}
