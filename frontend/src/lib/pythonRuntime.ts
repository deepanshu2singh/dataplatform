import type { PythonDatasetPayload } from './pythonDatasetBridge';

const PYTHON_INIT_TIMEOUT_MS = 90_000;
const PYTHON_DATASET_PREP_TIMEOUT_MS = 30_000;
const PYTHON_EXECUTION_TIMEOUT_MS = 10_000;

const MAX_PYTHON_CODE_CHARS = 50_000;
const MAX_PYTHON_DATASET_ROWS = 10_000;
const MAX_PYTHON_DATASET_CSV_BYTES = 10 * 1024 * 1024;

const RESOURCE_RESET_MESSAGE =
  'Python runtime was reset after a resource exhaustion error.';

export interface PythonRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  result: string;
  error: string | null;
  executionMs: number;
  outputTruncated: boolean;
}

interface WorkerReply {
  id: string;
  type: 'ready' | 'running' | 'result' | 'error';
  payload?: PythonRunResult;
  error?: string;
  resetRequired?: boolean;
}

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timer: number;
  kind: 'init' | 'run';
}

function exceedsUtf8ByteLimit(
  value: string,
  maxBytes: number,
): boolean {
  if (value.length > maxBytes) {
    return true;
  }

  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > maxBytes) {
      return true;
    }
  }

  return false;
}

function validateRunInputs(
  code: string,
  dataset: PythonDatasetPayload,
): void {
  if (!code.trim()) {
    throw new Error('Python code cannot be empty.');
  }

  if (code.length > MAX_PYTHON_CODE_CHARS) {
    throw new Error(
      'Python code exceeds the 50,000 character V1 limit.',
    );
  }

  if (
    !dataset ||
    !Number.isSafeInteger(dataset.id) ||
    typeof dataset.name !== 'string' ||
    typeof dataset.csvText !== 'string' ||
    !Number.isSafeInteger(dataset.loadedRowCount) ||
    dataset.loadedRowCount < 0 ||
    typeof dataset.truncated !== 'boolean' ||
    !Number.isSafeInteger(dataset.rowLimit) ||
    dataset.rowLimit < 0 ||
    !(
      dataset.sourceRowCount === null ||
      (
        Number.isSafeInteger(dataset.sourceRowCount) &&
        dataset.sourceRowCount >= 0
      )
    )
  ) {
    throw new Error(
      'A valid dataset is required for Python execution.',
    );
  }

  if (
    dataset.loadedRowCount > MAX_PYTHON_DATASET_ROWS ||
    dataset.rowLimit > MAX_PYTHON_DATASET_ROWS
  ) {
    throw new Error(
      'Python dataset exceeds the 10,000 row V1 limit.',
    );
  }

  if (
    exceedsUtf8ByteLimit(
      dataset.csvText,
      MAX_PYTHON_DATASET_CSV_BYTES,
    )
  ) {
    throw new Error(
      'Python dataset exceeds the 10 MiB V1 transfer limit.',
    );
  }
}

export class PythonRuntime {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest<unknown>>();
  private busy = false;

  async initialize(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.ensureWorker();

    const readyPromise = this.request<void>(
      { kind: 'init' },
      PYTHON_INIT_TIMEOUT_MS,
      'init',
    );

    this.readyPromise = readyPromise;

    try {
      await readyPromise;
    } catch (error) {
      if (this.readyPromise === readyPromise) {
        this.reset('Python failed to initialize.');
      }

      throw error;
    }
  }

  async run(
    code: string,
    dataset: PythonDatasetPayload,
  ): Promise<PythonRunResult> {
    if (this.busy) {
      throw new Error(
        'Python is already running. Wait for the current execution to finish.',
      );
    }

    validateRunInputs(
      code,
      dataset,
    );

    this.busy = true;

    try {
      await this.initialize();

      return await this.request<PythonRunResult>(
        {
          kind: 'run',
          code,
          dataset,
        },
        PYTHON_DATASET_PREP_TIMEOUT_MS,
        'run',
      );
    } finally {
      this.busy = false;
    }
  }

  reset(reason = 'Python runtime reset.'): void {
    this.terminateWorker(reason);
    this.readyPromise = null;
    this.busy = false;
  }

  destroy(): void {
    this.terminateWorker('Python runtime closed.');
    this.readyPromise = null;
    this.busy = false;
  }

  isBusy(): boolean {
    return this.busy;
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const workerUrl =
      `${import.meta.env.BASE_URL}python-worker.mjs`;

    const worker = new Worker(
      workerUrl,
      {
        type: 'module',
        name: 'notebook-python-runtime',
      },
    );

    worker.addEventListener(
      'message',
      (event: MessageEvent<WorkerReply>) => {
        if (this.worker !== worker) {
          return;
        }

        const message = event.data;
        const pending = this.pending.get(message.id);

        if (!pending) {
          return;
        }

        if (message.type === 'running') {
          if (pending.kind !== 'run') {
            return;
          }

          window.clearTimeout(
            pending.timer,
          );

          pending.timer =
            window.setTimeout(
              () => {
                this.timeoutRequest(
                  message.id,
                  'Python execution exceeded the 10 second V1 limit. The runtime was reset.',
                );
              },
              PYTHON_EXECUTION_TIMEOUT_MS,
            );

          return;
        }

        window.clearTimeout(
          pending.timer,
        );

        this.pending.delete(
          message.id,
        );

        if (message.type === 'error') {
          const error =
            new Error(
              message.error ||
              'Python worker failed.',
            );

          pending.reject(
            error,
          );

          if (message.resetRequired) {
            this.failWorker(
              worker,
              RESOURCE_RESET_MESSAGE,
            );
          }

          return;
        }

        if (message.type === 'result') {
          if (!message.payload) {
            pending.reject(
              new Error(
                'Python worker returned no result.',
              ),
            );

            return;
          }

          pending.resolve(
            message.payload,
          );

          if (message.resetRequired) {
            this.failWorker(
              worker,
              RESOURCE_RESET_MESSAGE,
            );
          }

          return;
        }

        pending.resolve(
          undefined,
        );
      },
    );

    worker.addEventListener(
      'error',
      (event) => {
        const message =
          event.message ||
          'Python worker crashed.';

        this.failWorker(
          worker,
          message,
        );
      },
    );

    worker.addEventListener(
      'messageerror',
      () => {
        this.failWorker(
          worker,
          'Python worker communication failed. The runtime was reset.',
        );
      },
    );

    this.worker =
      worker;

    return worker;
  }

  private failWorker(
    worker: Worker,
    reason: string,
  ): void {
    if (this.worker !== worker) {
      return;
    }

    this.terminateWorker(
      reason,
    );

    this.readyPromise = null;
    this.busy = false;
  }

  private request<T>(
    payload: Record<string, unknown>,
    timeoutMs: number,
    kind: 'init' | 'run',
  ): Promise<T> {
    const worker =
      this.ensureWorker();

    const id =
      crypto.randomUUID();

    return new Promise<T>(
      (resolve, reject) => {
        const timeoutMessage =
          kind === 'run'
            ? 'Python dataset preparation exceeded the 30 second V1 limit. The runtime was reset.'
            : 'Python runtime initialization timed out.';

        const timer =
          window.setTimeout(
            () => {
              this.timeoutRequest(
                id,
                timeoutMessage,
              );
            },
            timeoutMs,
          );

        this.pending.set(
          id,
          {
            resolve:
              resolve as (
                value: unknown,
              ) => void,
            reject,
            timer,
            kind,
          },
        );

        worker.postMessage({
          id,
          ...payload,
        });
      },
    );
  }

  private timeoutRequest(
    id: string,
    message: string,
  ): void {
    const pending =
      this.pending.get(id);

    if (!pending) {
      return;
    }

    window.clearTimeout(
      pending.timer,
    );

    this.pending.delete(
      id,
    );

    pending.reject(
      new Error(message),
    );

    this.terminateWorker(
      message,
    );

    this.readyPromise = null;
    this.busy = false;
  }

  private terminateWorker(
    reason: string,
  ): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    for (
      const pending
      of this.pending.values()
    ) {
      window.clearTimeout(
        pending.timer,
      );

      pending.reject(
        new Error(reason),
      );
    }

    this.pending.clear();
  }
}