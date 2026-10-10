import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, UPLOAD_API_TIMEOUT_MS } from '../lib/api';
import { DatasetsPage } from './DatasetsPage';

const SALES_DATASET = {
  id: 7,
  name: 'Sales Data',
  description: 'Five sales rows',
  type: 'file',
  schema_info: {
    columns: [
      { name: 'order_id', type: 'BIGINT' },
      { name: 'product', type: 'VARCHAR' },
    ],
    row_count: 5,
    sample_row_count: 2,
    sample_data: [
      { order_id: 1, product: 'Laptop' },
      { order_id: 2, product: 'Monitor' },
    ],
  },
  owner_id: 1,
  created_at: '2026-10-05T12:00:00Z',
  updated_at: null,
};

function mockDatasetList(data = [SALES_DATASET]) {
  return vi.spyOn(api, 'get').mockResolvedValue({ data });
}

describe('DatasetsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads datasets and expands schema and preview data', async () => {
    const getSpy = mockDatasetList();
    const user = userEvent.setup();

    render(<DatasetsPage />);

    expect(await screen.findByText('Sales Data')).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith('/datasets', expect.objectContaining({ signal: expect.any(Object) }));

    await user.click(screen.getByRole('button', { name: 'Expand Sales Data' }));

    expect(screen.getByText('Dataset summary')).toBeInTheDocument();
    expect(screen.getAllByText('order_id').length).toBeGreaterThan(0);
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('Monitor')).toBeInTheDocument();
  });

  it('rejects a non-CSV file before making an upload request', async () => {
    mockDatasetList([]);
    const postSpy = vi.spyOn(api, 'post');
    const user = userEvent.setup();

    render(<DatasetsPage />);
    await screen.findByText('No datasets yet');
    await user.click(screen.getAllByRole('button', { name: 'Upload Dataset' })[0]);

    expect(
      screen.getByRole('dialog', { name: 'Upload Dataset' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Dataset name')).toHaveFocus();

    const input = screen.getByLabelText('CSV file');
    const file = new File(['not,csv'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText('Phase 3 currently supports CSV files only.'),
    ).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('uploads a CSV using FormData and shows the returned dataset', async () => {
    mockDatasetList([]);
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: SALES_DATASET });
    const user = userEvent.setup();

    render(<DatasetsPage />);
    await screen.findByText('No datasets yet');
    await user.click(screen.getAllByRole('button', { name: 'Upload Dataset' })[0]);

    const csv = new File(
      ['order_id,product\n1,Laptop\n2,Monitor\n'],
      'sales.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByLabelText('CSV file'), csv);

    expect(screen.getByLabelText('Dataset name')).toHaveValue('sales');
    await user.type(screen.getByLabelText(/Description/), 'Integration sales data');

    const uploadForm = screen.getByLabelText('Dataset name').closest('form');
    expect(uploadForm).not.toBeNull();
    fireEvent.submit(uploadForm!);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    const [url, body, config] = postSpy.mock.calls[0];
    expect(url).toBe('/datasets/upload');
    expect(body).toBeInstanceOf(FormData);
    expect(config).toEqual(
      expect.objectContaining({ timeout: UPLOAD_API_TIMEOUT_MS }),
    );
    expect((body as FormData).get('name')).toBe('sales');
    expect((body as FormData).get('description')).toBe('Integration sales data');
    expect((body as FormData).get('file')).toBeInstanceOf(File);

    expect(await screen.findByText('Sales Data')).toBeInTheDocument();
    expect(screen.getByText('Dataset summary')).toBeInTheDocument();
  });

  it('deletes a dataset only after confirmation', async () => {
    mockDatasetList();
    const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ data: null });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    render(<DatasetsPage />);
    await screen.findByText('Sales Data');

    await user.click(screen.getByRole('button', { name: 'Delete Sales Data' }));
    expect(deleteSpy).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete Sales Data' }));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('/datasets/7');
    });
    expect(await screen.findByText('No datasets yet')).toBeInTheDocument();
  });


  it('retries a failed dataset list request without reloading the application', async () => {
    const getSpy = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce({
        response: { status: 503, data: { detail: 'temporary internal detail' } },
      })
      .mockResolvedValueOnce({ data: [SALES_DATASET] });
    const user = userEvent.setup();

    render(<DatasetsPage />);

    expect(await screen.findByText('Failed to load datasets.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Sales Data')).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('shows the backend detail when the dataset list cannot be loaded', async () => {
    vi.spyOn(api, 'get').mockRejectedValue({
      response: { data: { detail: 'Dataset service unavailable' } },
    });

    render(<DatasetsPage />);

    expect(await screen.findByText('Dataset service unavailable')).toBeInTheDocument();
  });
});
