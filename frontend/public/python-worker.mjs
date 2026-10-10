import { loadPyodide } from './pyodide/314.0.7/pyodide.mjs';

const PYODIDE_INDEX_URL =
  new URL('./pyodide/314.0.7/', self.location.href).href;
const MAX_CAPTURED_OUTPUT_CHARS = 100_000;
const OUTPUT_TRUNCATION_SUFFIX =
  '\n[output truncated at 100,000 characters]';

const MAX_PYTHON_CODE_CHARS = 50_000;
const MAX_PYTHON_DATASET_ROWS = 10_000;
const MAX_PYTHON_DATASET_CSV_BYTES = 10 * 1024 * 1024;

const RESOURCE_RESET_MESSAGE =
  'Python runtime was reset after a resource exhaustion error.';
const NETWORK_BLOCK_MESSAGE =
  'Network access is disabled inside V1 notebook Python.';

function makeBlockedConstructor(apiName) {
  return class BlockedNetworkAPI {
    constructor() {
      throw new Error(`${NETWORK_BLOCK_MESSAGE} (${apiName})`);
    }
  };
}

function lockGlobal(name, value) {
  try {
    Object.defineProperty(self, name, {
      value,
      writable: false,
      configurable: false,
    });
    return;
  } catch {
    // Some browser globals are not configurable. Fall back to assignment.
  }

  try {
    self[name] = value;
  } catch {
    // Missing/read-only APIs are already unavailable, which is acceptable.
  }
}

function installNetworkGuard() {
  const blockedFetch = async () => {
    throw new Error(`${NETWORK_BLOCK_MESSAGE} (fetch)`);
  };

  lockGlobal('fetch', blockedFetch);

  for (const apiName of [
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'WebTransport',
    'Worker',
    'SharedWorker',
    'BroadcastChannel',
    'RTCPeerConnection',
  ]) {
    lockGlobal(apiName, makeBlockedConstructor(apiName));
  }
}

let pyodidePromise = null;
let activeDatasetId = null;
let activeRunId = null;

function appendLimited(target, value) {
  if (target.truncated) {
    return;
  }

  const remaining = MAX_CAPTURED_OUTPUT_CHARS - target.text.length;

  if (remaining <= 0) {
    target.truncated = true;
    return;
  }

  const text = `${value}\n`;

  if (text.length <= remaining) {
    target.text += text;
    return;
  }

  target.text += text.slice(0, remaining);
  target.truncated = true;
}

function limitText(value) {
  const text = String(value);

  if (text.length <= MAX_CAPTURED_OUTPUT_CHARS) {
    return {
      text,
      truncated: false,
    };
  }

  const bodyLimit = Math.max(
    0,
    MAX_CAPTURED_OUTPUT_CHARS - OUTPUT_TRUNCATION_SUFFIX.length,
  );

  return {
    text: `${text.slice(0, bodyLimit)}${OUTPUT_TRUNCATION_SUFFIX}`,
    truncated: true,
  };
}

function exceedsUtf8ByteLimit(value, maxBytes) {
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

function validateRunPayload(code, dataset) {
  if (typeof code !== 'string' || !code.trim()) {
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
    throw new Error('A valid dataset is required for Python execution.');
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

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

function isFatalResourceError(error) {
  const message = errorMessage(error);

  if (/(?:^|\n)MemoryError(?::|$)/m.test(message)) {
    return true;
  }

  const name =
    error instanceof Error
      ? error.name
      : '';

  const combined =
    `${name}: ${message}`.toLowerCase();

  return (
    combined.includes('out of memory') ||
    combined.includes('cannot enlarge memory arrays') ||
    combined.includes('maximum memory size exceeded') ||
    combined.includes('failed to grow memory') ||
    combined.includes('memory.grow') ||
    /\boom\b/.test(combined) ||
    (
      combined.includes('wasm') &&
      combined.includes('memory') &&
      (
        combined.includes('grow') ||
        combined.includes('alloc') ||
        combined.includes('limit') ||
        combined.includes('exceed') ||
        combined.includes('fail')
      )
    )
  );
}

function boundedExecutionError(error, resetRequired) {
  const message = errorMessage(error);

  return limitText(
    resetRequired
      ? `${message}\n${RESOURCE_RESET_MESSAGE}`
      : message,
  );
}
function finalizeCapturedOutput(target) {
  const text = target.text.replace(/\n$/, '');

  if (!target.truncated) {
    return text;
  }

  const bodyLimit = Math.max(
    0,
    MAX_CAPTURED_OUTPUT_CHARS - OUTPUT_TRUNCATION_SUFFIX.length,
  );

  return `${text.slice(0, bodyLimit)}${OUTPUT_TRUNCATION_SUFFIX}`;
}

async function ensurePyodide() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const pyodide = await loadPyodide({
        indexURL: PYODIDE_INDEX_URL,
      });

      await pyodide.loadPackage('pandas');

      // Warm the imports during initialization so the first notebook run is
      // measured as user-code time rather than cold pandas import time.
      await pyodide.runPythonAsync(`
import io as __sprout_io
import pandas as pd
`);

      pyodide.setStdin({ error: true });

      // Pyodide and pandas are fully loaded before the guard is installed.
      // From this point onward, user Python does not receive normal browser
      // networking primitives such as fetch, WebSocket, XHR, or nested Worker.
      installNetworkGuard();

      return pyodide;
    })();
  }

  return pyodidePromise;
}

async function loadDatasetIfNeeded(pyodide, dataset) {
  if (activeDatasetId === dataset.id) {
    return;
  }

  pyodide.globals.set('__sprout_dataset_csv', dataset.csvText);
  pyodide.globals.set('__sprout_dataset_name', dataset.name);
  pyodide.globals.set('__sprout_dataset_id', dataset.id);
  pyodide.globals.set('__sprout_dataset_truncated', dataset.truncated);
  pyodide.globals.set('__sprout_dataset_loaded_rows', dataset.loadedRowCount);
  pyodide.globals.set('__sprout_dataset_source_rows', dataset.sourceRowCount);

  try {
    await pyodide.runPythonAsync(`
df = pd.read_csv(__sprout_io.StringIO(__sprout_dataset_csv))
dataset_name = __sprout_dataset_name
dataset_id = __sprout_dataset_id
dataset_truncated = __sprout_dataset_truncated
dataset_loaded_rows = __sprout_dataset_loaded_rows
dataset_source_rows = __sprout_dataset_source_rows

del __sprout_dataset_csv
del __sprout_dataset_name
del __sprout_dataset_id
del __sprout_dataset_truncated
del __sprout_dataset_loaded_rows
del __sprout_dataset_source_rows
`);

    activeDatasetId = dataset.id;
  } finally {
    for (const name of [
      '__sprout_dataset_csv',
      '__sprout_dataset_name',
      '__sprout_dataset_id',
      '__sprout_dataset_truncated',
      '__sprout_dataset_loaded_rows',
      '__sprout_dataset_source_rows',
    ]) {
      try {
        pyodide.globals.delete(name);
      } catch {
        // The bootstrap code may already have deleted it.
      }
    }
  }
}

function resultToText(result) {
  if (result === undefined || result === null) {
    return {
      text: '',
      truncated: false,
    };
  }

  try {
    return limitText(result);
  } finally {
    if (typeof result?.destroy === 'function') {
      result.destroy();
    }
  }
}

self.onmessage = async (event) => {
  const message = event.data;
  const id = message?.id;

  if (
    typeof id !== 'string' ||
    !id ||
    typeof message?.kind !== 'string'
  ) {
    return;
  }

  if (message.kind !== 'init' && message.kind !== 'run') {
    const boundedError = limitText('Unknown Python worker command.');

    self.postMessage({
      id,
      type: 'error',
      error: boundedError.text,
    });
    return;
  }

  const isRun = message.kind === 'run';

  if (isRun) {
    if (activeRunId !== null) {
      const boundedError = limitText(
        'Python worker is already running. Wait for the current execution to finish.',
      );

      self.postMessage({
        id,
        type: 'error',
        error: boundedError.text,
      });
      return;
    }

    activeRunId = id;
  }

  try {
    if (isRun) {
      validateRunPayload(
        message.code,
        message.dataset,
      );
    }

    const pyodide = await ensurePyodide();

    if (message.kind === 'init') {
      self.postMessage({
        id,
        type: 'ready',
      });
      return;
    }

    const { code, dataset } = message;
    await loadDatasetIfNeeded(pyodide, dataset);

    const stdout = { text: '', truncated: false };
    const stderr = { text: '', truncated: false };

    pyodide.setStdout({
      batched: (line) => appendLimited(stdout, line),
    });

    pyodide.setStderr({
      batched: (line) => appendLimited(stderr, line),
    });

    pyodide.setStdin({ error: true });

    // Re-apply the guard before every user execution. This also covers browser
    // globals that could only be replaced by assignment rather than a locked
    // property on a particular browser implementation.
    installNetworkGuard();

    // The main thread starts the 10-second execution timer only after all
    // dataset preparation has completed.
    self.postMessage({
      id,
      type: 'running',
    });

    const startedAt = performance.now();
    let result = null;

    try {
      result = await pyodide.runPythonAsync(code, {
        filename: '<notebook-python-cell>',
      });
    } catch (error) {
      const resetRequired =
        isFatalResourceError(error);

      const boundedError =
        boundedExecutionError(
          error,
          resetRequired,
        );

      self.postMessage({
        id,
        type: 'result',
        resetRequired,
        payload: {
          success: false,
          stdout: finalizeCapturedOutput(stdout),
          stderr: finalizeCapturedOutput(stderr),
          result: '',
          error: boundedError.text,
          executionMs: performance.now() - startedAt,
          outputTruncated:
            stdout.truncated ||
            stderr.truncated ||
            boundedError.truncated,
        },
      });

      return;
    }
    const boundedResult =
      resultToText(result);

    self.postMessage({
      id,
      type: 'result',
      payload: {
        success: true,
        stdout: finalizeCapturedOutput(stdout),
        stderr: finalizeCapturedOutput(stderr),
        result: boundedResult.text,
        error: null,
        executionMs: performance.now() - startedAt,
        outputTruncated:
          stdout.truncated ||
          stderr.truncated ||
          boundedResult.truncated,
      },
    });
  } catch (error) {
    const resetRequired =
      isFatalResourceError(error);

    const boundedError =
      boundedExecutionError(
        error,
        resetRequired,
      );

    self.postMessage({
      id,
      type: 'error',
      error: boundedError.text,
      resetRequired,
    });  } finally {
    if (
      isRun &&
      activeRunId === id
    ) {
      activeRunId = null;
    }
  }
};
