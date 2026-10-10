import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { loadPythonDataset } from './pythonDatasetBridge';

describe('loadPythonDataset', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
