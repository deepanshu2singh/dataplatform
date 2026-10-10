import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PythonDatasetPayload } from './pythonDatasetBridge';
import { PythonRuntime } from './pythonRuntime';

type Listener = (event: { data?: unknown; message?: string }) => void;

class MockWorker {
  static instances: MockWorker[] = [];

  readonly posted: Array<Record<string, unknown>> = [];
  readonly listeners = new Map<string, Listener[]>();
  terminated = false;

  readonly url: string;
  readonly options?: WorkerOptions;

  constructor(url: string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    MockWorker.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    const callback =
      listener as unknown as Listener;

    this.listeners.set(
      type,
      [
        ...(this.listeners.get(type) ?? []),
        callback,
      ],
    );
  }

  postMessage(
    message: Record<string, unknown>,
  ) {
    this.posted.push(
      message,
    );
  }

  terminate() {
    this.terminated =
      true;
  }

  emitMessage(
    data: Record<string, unknown>,
  ) {
    for (
      const listener
      of this.listeners.get('message') ?? []
    ) {
      listener({
        data,
      });
    }
  }

  emitError(
    message: string,
  ) {
    for (
      const listener
      of this.listeners.get('error') ?? []
    ) {
      listener({
        message,
      });
    }
  }

  emitMessageError() {
    for (
      const listener
      of this.listeners.get('messageerror') ?? []
    ) {
      listener({});
    }
  }
}

const DATASET: PythonDatasetPayload = {
  id: 7,
  name: 'Sales Data',
  csvText: 'product,revenue\nLaptop,3600.49\n',
  sourceRowCount: 1,
  loadedRowCount: 1,
  truncated: false,
  rowLimit: 10_000,
};

const RESULT = {
  success: true,
  stdout: 'hello\n',
  stderr: '',
  result: '42',
  error: null,
  executionMs: 12.5,
  outputTruncated: false,
};

async function initializeRuntime(
  runtime: PythonRuntime,
) {
  const promise =
    runtime.initialize();

  const worker =
    MockWorker.instances.at(-1);

  expect(worker).toBeDefined();

  const initMessage =
    worker!.posted[0];

  worker!.emitMessage({
    id: initMessage.id,
    type: 'ready',
  });

  await promise;

  return worker!;
}

describe('PythonRuntime', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal(
      'Worker',
      MockWorker,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects empty code before creating a worker', async () => {
    const runtime =
      new PythonRuntime();

    await expect(
      runtime.run(
        '   ',
        DATASET,
      ),
    ).rejects.toThrow(
      'Python code cannot be empty.',
    );

    expect(
      MockWorker.instances,
    ).toHaveLength(0);
  });

  it('rejects Python code above the 50,000 character V1 limit before creating a worker', async () => {
    const runtime =
      new PythonRuntime();

    await expect(
      runtime.run(
        'x'.repeat(50_001),
        DATASET,
      ),
    ).rejects.toThrow(
      'Python code exceeds the 50,000 character V1 limit.',
    );

    expect(
      MockWorker.instances,
    ).toHaveLength(0);
  });

  it('rejects datasets above the 10,000 row V1 limit before creating a worker', async () => {
    const runtime =
      new PythonRuntime();

    const oversizedDataset = {
      ...DATASET,
      loadedRowCount: 10_001,
    };

    await expect(
      runtime.run(
        '42',
        oversizedDataset,
      ),
    ).rejects.toThrow(
      'Python dataset exceeds the 10,000 row V1 limit.',
    );

    expect(
      MockWorker.instances,
    ).toHaveLength(0);
  });

  it('enforces the 10 MiB dataset budget as UTF-8 bytes rather than JavaScript characters', async () => {
    const runtime =
      new PythonRuntime();

    const maxBytes =
      10 * 1024 * 1024;

    const csvText =
      '€'.repeat(
        Math.floor(maxBytes / 3) + 1,
      );

    expect(
      csvText.length,
    ).toBeLessThan(maxBytes);

    const oversizedDataset = {
      ...DATASET,
      csvText,
    };

    await expect(
      runtime.run(
        '42',
        oversizedDataset,
      ),
    ).rejects.toThrow(
      'Python dataset exceeds the 10 MiB V1 transfer limit.',
    );

    expect(
      MockWorker.instances,
    ).toHaveLength(0);
  });

  it('initializes once and reuses the same ready runtime', async () => {
    const runtime =
      new PythonRuntime();

    const worker =
      await initializeRuntime(
        runtime,
      );

    expect(
      worker.url,
    ).toContain(
      'python-worker.mjs',
    );

    expect(
      worker.options,
    ).toMatchObject({
      type: 'module',
      name: 'notebook-python-runtime',
    });

    expect(
      worker.posted,
    ).toHaveLength(1);

    await runtime.initialize();

    expect(
      MockWorker.instances,
    ).toHaveLength(1);

    expect(
      worker.posted,
    ).toHaveLength(1);
  });

  it('sends code and dataset to the worker and resolves the worker result', async () => {
    const runtime =
      new PythonRuntime();

    const worker =
      await initializeRuntime(
        runtime,
      );

    const runPromise =
      runtime.run(
        'print("hello")\n42',
        DATASET,
      );

    await waitFor(() => {
      expect(
        worker.posted,
      ).toHaveLength(2);
    });

    const runMessage =
      worker.posted[1];

    expect(
      runMessage,
    ).toMatchObject({
      kind: 'run',
      code: 'print("hello")\n42',
      dataset: DATASET,
    });

    worker.emitMessage({
      id: runMessage.id,
      type: 'running',
    });

    worker.emitMessage({
      id: runMessage.id,
      type: 'result',
      payload: RESULT,
    });

    await expect(
      runPromise,
    ).resolves.toEqual(
      RESULT,
    );

    expect(
      worker.terminated,
    ).toBe(false);

    expect(
      runtime.isBusy(),
    ).toBe(false);
  });

  it('rejects a second run while an execution is already in progress', async () => {
    const runtime =
      new PythonRuntime();

    const worker =
      await initializeRuntime(
        runtime,
      );

    const firstRun =
      runtime.run(
        'print("first")',
        DATASET,
      );

    await waitFor(() => {
      expect(
        runtime.isBusy(),
      ).toBe(true);
    });

    await expect(
      runtime.run(
        'print("second")',
        DATASET,
      ),
    ).rejects.toThrow(
      'Python is already running. Wait for the current execution to finish.',
    );

    const runMessage =
      worker.posted[1];

    worker.emitMessage({
      id: runMessage.id,
      type: 'result',
      payload: RESULT,
    });

    await expect(
      firstRun,
    ).resolves.toEqual(
      RESULT,
    );
  });

  it('terminates the worker and rejects pending work when reset', async () => {
    const runtime =
      new PythonRuntime();

    const worker =
      await initializeRuntime(
        runtime,
      );

    const runPromise =
      runtime.run(
        'while True: pass',
        DATASET,
      );

    await waitFor(() => {
      expect(
        runtime.isBusy(),
      ).toBe(true);
    });

    runtime.reset(
      'Manual reset from test.',
    );

    await expect(
      runPromise,
    ).rejects.toThrow(
      'Manual reset from test.',
    );

    expect(
      worker.terminated,
    ).toBe(true);

    expect(
      runtime.isBusy(),
    ).toBe(false);
  });

  it('claims the busy lock before cold initialization so first runs cannot overlap', async () => {
    const runtime =
      new PythonRuntime();

    const firstRun =
      runtime.run(
        'print("first")',
        DATASET,
      );

    expect(
      runtime.isBusy(),
    ).toBe(true);

    const worker =
      MockWorker.instances.at(-1);

    expect(
      worker,
    ).toBeDefined();

    expect(
      worker!.posted,
    ).toHaveLength(1);

    await expect(
      runtime.run(
        'print("second")',
        DATASET,
      ),
    ).rejects.toThrow(
      'Python is already running. Wait for the current execution to finish.',
    );

    const initMessage =
      worker!.posted[0];

    worker!.emitMessage({
      id: initMessage.id,
      type: 'ready',
    });

    await waitFor(() => {
      expect(
        worker!.posted,
      ).toHaveLength(2);
    });

    const runMessage =
      worker!.posted[1];

    worker!.emitMessage({
      id: runMessage.id,
      type: 'running',
    });

    worker!.emitMessage({
      id: runMessage.id,
      type: 'result',
      payload: RESULT,
    });

    await expect(
      firstRun,
    ).resolves.toEqual(
      RESULT,
    );

    expect(
      runtime.isBusy(),
    ).toBe(false);
  });

  it('terminates the worker, rejects pending work, and can recover after messageerror', async () => {
    const runtime =
      new PythonRuntime();

    const worker =
      await initializeRuntime(
        runtime,
      );

    const runPromise =
      runtime.run(
        'print("hello")',
        DATASET,
      );

    await waitFor(() => {
      expect(
        worker.posted,
      ).toHaveLength(2);
    });

    const rejection =
      expect(
        runPromise,
      ).rejects.toThrow(
        'Python worker communication failed. The runtime was reset.',
      );

    worker.emitMessageError();

    await rejection;

    expect(
      worker.terminated,
    ).toBe(true);

    expect(
      runtime.isBusy(),
    ).toBe(false);

    const replacementInitialization =
      runtime.initialize();

    const replacementWorker =
      MockWorker.instances.at(-1);

    expect(
      replacementWorker,
    ).toBeDefined();

    expect(
      replacementWorker,
    ).not.toBe(
      worker,
    );

    expect(
      replacementWorker!.terminated,
    ).toBe(false);

    const replacementInitMessage =
      replacementWorker!.posted[0];

    replacementWorker!.emitMessage({
      id: replacementInitMessage.id,
      type: 'ready',
    });

    await replacementInitialization;

    expect(
      replacementWorker!.terminated,
    ).toBe(false);

    runtime.destroy();
  });

  it('does not let a stale initialization rejection terminate a replacement worker', async () => {
    const runtime =
      new PythonRuntime();

    const firstInitialization =
      runtime.initialize();

    const firstWorker =
      MockWorker.instances.at(-1);

    expect(
      firstWorker,
    ).toBeDefined();

    const firstRejection =
      expect(
        firstInitialization,
      ).rejects.toThrow(
        'Manual reset from test.',
      );

    runtime.reset(
      'Manual reset from test.',
    );

    expect(
      firstWorker!.terminated,
    ).toBe(true);

    const secondInitialization =
      runtime.initialize();

    const secondWorker =
      MockWorker.instances.at(-1);

    expect(
      secondWorker,
    ).toBeDefined();

    expect(
      secondWorker,
    ).not.toBe(
      firstWorker,
    );

    await firstRejection;

    expect(
      secondWorker!.terminated,
    ).toBe(false);

    const secondInitMessage =
      secondWorker!.posted[0];

    secondWorker!.emitMessage({
      id: secondInitMessage.id,
      type: 'ready',
    });

    await secondInitialization;

    expect(
      secondWorker!.terminated,
    ).toBe(false);

    runtime.destroy();
  });

  it('terminates a worker after a fatal resource result and recovers with a new worker', async () => {
    const runtime =
      new PythonRuntime();

    const worker =
      await initializeRuntime(
        runtime,
      );

    const runPromise =
      runtime.run(
        'raise MemoryError("phase8g5")',
        DATASET,
      );

    await waitFor(() => {
      expect(
        worker.posted,
      ).toHaveLength(2);
    });

    const runMessage =
      worker.posted[1];

    worker.emitMessage({
      id: runMessage.id,
      type: 'running',
    });

    const fatalResult = {
      ...RESULT,
      success: false,
      result: '',
      error:
        'MemoryError: phase8g5\n' +
        'Python runtime was reset after a resource exhaustion error.',
    };

    worker.emitMessage({
      id: runMessage.id,
      type: 'result',
      payload: fatalResult,
      resetRequired: true,
    });

    await expect(
      runPromise,
    ).resolves.toEqual(
      fatalResult,
    );

    expect(
      worker.terminated,
    ).toBe(true);

    expect(
      runtime.isBusy(),
    ).toBe(false);

    const replacementInitialization =
      runtime.initialize();

    const replacementWorker =
      MockWorker.instances.at(-1);

    expect(
      replacementWorker,
    ).toBeDefined();

    expect(
      replacementWorker,
    ).not.toBe(
      worker,
    );

    const replacementInitMessage =
      replacementWorker!.posted[0];

    replacementWorker!.emitMessage({
      id: replacementInitMessage.id,
      type: 'ready',
    });

    await replacementInitialization;

    expect(
      replacementWorker!.terminated,
    ).toBe(false);

    runtime.destroy();
  });

  it('terminates the worker when dataset preparation reports fatal resource exhaustion', async () => {
    const runtime =
      new PythonRuntime();

    const worker =
      await initializeRuntime(
        runtime,
      );

    const runPromise =
      runtime.run(
        '42',
        DATASET,
      );

    await waitFor(() => {
      expect(
        worker.posted,
      ).toHaveLength(2);
    });

    const runMessage =
      worker.posted[1];

    const rejection =
      expect(
        runPromise,
      ).rejects.toThrow(
        'Python runtime was reset after a resource exhaustion error.',
      );

    worker.emitMessage({
      id: runMessage.id,
      type: 'error',
      error:
        'WebAssembly memory exhausted. ' +
        'Python runtime was reset after a resource exhaustion error.',
      resetRequired: true,
    });

    await rejection;

    expect(
      worker.terminated,
    ).toBe(true);

    expect(
      runtime.isBusy(),
    ).toBe(false);
  });
});