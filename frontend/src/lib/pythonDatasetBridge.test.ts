import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { loadPythonDataset } from './pythonDatasetBridge';

describe('loadPythonDataset', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads a private snapshot with no cookies and verifies SHA-256', async () => {
    const bytes = new TextEncoder().encode('a\n1\n');
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
    vi.spyOn(api, 'get').mockResolvedValue({ data: { dataset_id:7, dataset_name:'Sales', csv_text:null,
      download_url:'https://example.supabase.co/storage/v1/object/sign/datasets/sample.csv?token=temporary',
      csv_size_bytes:bytes.length, sha256, source_row_count:1, loaded_row_count:1, truncated:false, row_limit:10000 } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal('fetch', fetchMock);
    expect((await loadPythonDataset(7)).csvText).toBe('a\n1\n');
    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials:'omit', redirect:'error', referrerPolicy:'no-referrer' });
  });

  it.each([['wrong hash',4,'0'.repeat(64)], ['oversized stream',3,'0'.repeat(64)]])('rejects %s', async (_reason,size,sha256) => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { csv_text:null,
      download_url:'https://example.supabase.co/storage/v1/object/sign/datasets/sample.csv?token=temporary',
      csv_size_bytes:size, sha256 } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new TextEncoder().encode('a\n1\n'))));
    await expect(loadPythonDataset(7)).rejects.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid dataset ID %s without calling the API',
    async (datasetId) => {
      const getSpy = vi.spyOn(api, 'get');

      await expect(loadPythonDataset(datasetId)).rejects.toThrow(
        'A valid dataset ID is required.',
      );
      expect(getSpy).not.toHaveBeenCalled();
    },
  );

  it('maps the bounded backend export into the browser runtime payload', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        dataset_id: 7,
        dataset_name: 'Sales Data',
        csv_text: 'product,revenue\nLaptop,3600.49\n',
        source_row_count: 12000,
        loaded_row_count: 10000,
        truncated: true,
        row_limit: 10000,
      },
    });

    await expect(loadPythonDataset(7)).resolves.toEqual({
      id: 7,
      name: 'Sales Data',
      csvText: 'product,revenue\nLaptop,3600.49\n',
      sourceRowCount: 12000,
      loadedRowCount: 10000,
      truncated: true,
      rowLimit: 10000,
    });
    expect(getSpy).toHaveBeenCalledWith('/datasets/7/python-export');
  });
});
