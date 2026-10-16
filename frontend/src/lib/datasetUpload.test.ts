import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { uploadDataset, loadDatasetUploadConfig } from './datasetUpload';
import type { PendingCloudUpload } from './datasetUpload';

const tus = vi.hoisted(() => ({ options: {} as Record<string, unknown>, starts: 0, fail: false }));
vi.mock('tus-js-client', () => ({ Upload: class {
  constructor(_file: File, options: Record<string, unknown>) { tus.options = options; }
  async findPreviousUploads() { return []; }
  start() {
    tus.starts++;
    if (tus.fail) (tus.options.onError as () => void)();
    else (tus.options.onSuccess as () => void)();
  }
} }));

const signed = { upload_id: 'abc', token: 'signed-token', object_key: 'users/7/abc.csv',
  bucket: 'datasets', tus_endpoint: 'https://example.storage.supabase.co/storage/v1/upload/resumable/sign',
  chunk_size: 6*1024*1024, expires_at: '2026-10-11T14:00:00Z' };
const file = new File(['a\n1\n'], 'test.csv', { type: 'text/csv' });
const config = { storage_backend: 'supabase' as const, max_upload_bytes: 50*1024*1024 };

describe('direct dataset upload', () => {
  beforeEach(() => { vi.restoreAllMocks(); tus.starts = 0; tus.fail = false; });

  it('sends metadata to the API and bytes to signed TUS with 6 MiB chunks', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({ data: signed }).mockResolvedValueOnce({ data: { id: 55 } });
    const onPending = vi.fn();
    await expect(uploadDataset({ file, name: 'Test', description: '', config, pending: null, onPending, onProgress: vi.fn() })).resolves.toEqual({ id: 55 });
    expect(post.mock.calls[0]).toEqual(['/datasets/uploads/prepare', { filename:'test.csv', file_size:4, name:'Test', description:'' }]);
    expect(tus.options.endpoint).toBe('https://example.storage.supabase.co/storage/v1/upload/resumable/sign');
    expect(tus.options.headers).toEqual({ 'x-signature': 'signed-token' });
    expect(tus.options).toMatchObject({ headers: { 'x-signature':'signed-token' }, chunkSize:6*1024*1024,
      metadata: { bucketName:'datasets', objectName:signed.object_key } });
    expect(onPending.mock.calls[1][0].transferred).toBe(true);
    expect(post.mock.calls[1][0]).toBe('/datasets/uploads/abc/complete');
  });

  it('retries a lost completion response without preparing or transferring twice', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({ data:signed }).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ data:{ id:55 } });
    let pending: PendingCloudUpload | null = null;
    const options = { file, name:'Test', description:'', config, onPending:(value: PendingCloudUpload) => { pending = value; }, onProgress:vi.fn() };
    await expect(uploadDataset({ ...options, pending })).rejects.toThrow('lost response');
    await expect(uploadDataset({ ...options, pending })).resolves.toEqual({ id:55 });
    expect(tus.starts).toBe(1);
    expect(post.mock.calls.map((call) => call[0])).toEqual(['/datasets/uploads/prepare', '/datasets/uploads/abc/complete', '/datasets/uploads/abc/complete']);
  });

  it('retains the intent after a transfer failure and resumes its next attempt', async () => {
    tus.fail = true;
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({ data:signed }).mockResolvedValueOnce({ data:{ id:55 } });
    let pending: PendingCloudUpload | null = null;
    const options = { file, name:'Test', description:'', config, onPending:(value: PendingCloudUpload) => { pending=value; }, onProgress:vi.fn() };
    await expect(uploadDataset({ ...options, pending })).rejects.toThrow('interrupted');
    expect(post).toHaveBeenCalledTimes(1);
    tus.fail = false;
    await uploadDataset({ ...options, pending });
    expect(tus.starts).toBe(2);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('rejects over-limit files before calling the API', async () => {
    const post = vi.spyOn(api, 'post');
    await expect(uploadDataset({ file, name:'test', description:'', config:{ ...config, max_upload_bytes:1 }, pending:null, onPending:vi.fn(), onProgress:vi.fn() })).rejects.toThrow('exceeds');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects invalid upload configuration', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data:{ storage_backend:'unknown', max_upload_bytes:100 } });
    await expect(loadDatasetUploadConfig()).rejects.toThrow('unavailable');
  });
});
