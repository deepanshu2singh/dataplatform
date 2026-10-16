import { Upload } from 'tus-js-client';
import { api, UPLOAD_API_TIMEOUT_MS } from './api';

export interface DatasetUploadConfig {
  storage_backend: 'local' | 'supabase';
  max_upload_bytes: number;
}

export interface SignedDatasetUpload {
  upload_id: string;
  object_key: string;
  token: string;
  tus_endpoint: string;
  bucket: string;
  chunk_size: number;
  expires_at: string;
}

export interface PendingCloudUpload {
  signed: SignedDatasetUpload;
  transferred: boolean;
}

export async function loadDatasetUploadConfig(): Promise<DatasetUploadConfig> {
  const { data } = await api.get<DatasetUploadConfig>('/datasets/upload-config');
  if (!['local', 'supabase'].includes(data.storage_backend)
    || !Number.isSafeInteger(data.max_upload_bytes) || data.max_upload_bytes <= 0) {
    throw new Error('Upload settings are unavailable. Please reload the page.');
  }
  return data;
}

async function transferCloudFile(file: File, signed: SignedDatasetUpload, onProgress: (percent: number) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: signed.tus_endpoint,
      headers: { 'x-signature': signed.token },
      chunkSize: signed.chunk_size,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      fingerprint: async () => `dataplatform-${signed.upload_id}`,
      metadata: {
        bucketName: signed.bucket,
        objectName: signed.object_key,
        contentType: 'text/csv',
        cacheControl: '0',
      },
      onError: () => reject(new Error('The file upload was interrupted. Retry to resume it.')),
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    });
    void upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(() => reject(new Error('Could not start the file upload. Please retry.')));
  });
}

export async function uploadDataset<T>(options: {
  file: File; name: string; description: string; config: DatasetUploadConfig;
  pending: PendingCloudUpload | null;
  onPending: (pending: PendingCloudUpload) => void;
  onProgress: (percent: number) => void;
}): Promise<T> {
  const { file, name, description, config, onPending, onProgress } = options;
  if (!file.size || file.size > config.max_upload_bytes) {
    throw new Error('The file is empty or exceeds the upload limit.');
  }
  if (config.storage_backend === 'local') {
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    form.append('description', description);
    const response = await api.post<T>('/datasets/upload', form, { timeout: UPLOAD_API_TIMEOUT_MS });
    return response.data;
  }
  let pending = options.pending;
  if (pending === null) {
    const response = await api.post<SignedDatasetUpload>('/datasets/uploads/prepare', {
      filename: file.name, file_size: file.size, name, description,
    });
    pending = { signed: response.data, transferred: false };
    onPending(pending);
  }
  if (!pending.transferred) {
    await transferCloudFile(file, pending.signed, onProgress);
    pending = { ...pending, transferred: true };
    onPending(pending);
  }
  const response = await api.post<T>(
    `/datasets/uploads/${pending.signed.upload_id}/complete`, {},
    { timeout: UPLOAD_API_TIMEOUT_MS },
  );
  return response.data;
}
