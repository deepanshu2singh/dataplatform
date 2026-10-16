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

// Themes are registered on the existing same-origin Monaco instance.
monaco.editor.defineTheme('dataplatform-light', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'comment', foreground: '626557' },
    { token: 'keyword', foreground: '684492' },
    { token: 'string', foreground: '2D6846' },
    { token: 'number', foreground: '935217' },
  ],
  colors: {
    'editor.background': '#FFFBF4', 'editor.foreground': '#11120D',
    'editorLineNumber.foreground': '#706F63', 'editorLineNumber.activeForeground': '#385144',
    'editorCursor.foreground': '#385144', 'editor.selectionBackground': '#92A9E155',
    'editor.lineHighlightBackground': '#F0EEE5', 'editorWidget.background': '#FFFBF4',
  },
});
monaco.editor.defineTheme('dataplatform-dark', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment', foreground: 'B2B5A7' },
    { token: 'keyword', foreground: 'B7C6ED' },
    { token: 'string', foreground: 'B9D4A8' },
    { token: 'number', foreground: 'E4C998' },
  ],
  colors: {
    'editor.background': '#242722', 'editor.foreground': '#F8F5F2',
    'editorLineNumber.foreground': '#A1A596', 'editorLineNumber.activeForeground': '#BDCCEE',
    'editorCursor.foreground': '#BDCCEE', 'editor.selectionBackground': '#92A9E144',
    'editor.lineHighlightBackground': '#2D322A', 'editorWidget.background': '#242722',
  },
});

// Supply the locally installed Monaco instance to @monaco-editor/react.
// The monaco-editor root entry includes the bundled languages/features.
loader.config({ monaco });

export { NotebookPage };
