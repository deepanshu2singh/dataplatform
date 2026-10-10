import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

import { NotebookPage } from './NotebookPage';

type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: () => Worker;
  };
};

// Use a Vite-emitted same-origin Worker rather than Monaco's remote/default loader.
(globalThis as MonacoGlobal).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Supply the locally installed Monaco instance to @monaco-editor/react.
// The monaco-editor root entry includes the bundled languages/features.
loader.config({ monaco });

export { NotebookPage };
