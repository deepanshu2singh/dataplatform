import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const frontendRoot = new URL('../', import.meta.url);
const sanitizerEntry = fileURLToPath(new URL('node_modules/dompurify/dist/purify.es.mjs', frontendRoot));
const embeddedSanitizer = '/monaco-editor/esm/vs/base/browser/dompurify/dompurify.js';

// Monaco 0.56.0 imports this embedded copy by a relative path. An npm
// override alone does not replace it. Vite aliases apply to both production
// builds and development dependency optimization; Vitest uses the same alias.
export const editorSanitizerAlias = {
  find: /^\.\/dompurify\/dompurify\.js$/,
  replacement: sanitizerEntry,
};

export function verifyEditorSanitizer(): Plugin {
  return {
    name: 'verify-editor-sanitizer',
    apply: 'build',
    buildStart() {
      for (const [name, expected] of [['monaco-editor', '0.56.0'], ['dompurify', '3.4.16']] as const) {
        const file = new URL(`node_modules/${name}/package.json`, frontendRoot);
        const actual = JSON.parse(readFileSync(file, 'utf8')).version;
        if (actual !== expected) {
          this.error(`Editor sanitizer integration requires ${name}@${expected}; review before changing this pin.`);
        }
      }
      // Fail if a future editor layout no longer uses the import being replaced.
      const importer = new URL('node_modules/monaco-editor/esm/vs/base/browser/domSanitize.js', frontendRoot);
      if (!readFileSync(importer, 'utf8').includes("from './dompurify/dompurify.js'")) {
        this.error('Monaco sanitizer import changed; review its bundled sanitizer before building.');
      }
    },
    generateBundle(_options, bundle) {
      let patchedModuleIncluded = false;
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          const path = id.replaceAll('\\', '/').split('?')[0];
          if (path.endsWith(embeddedSanitizer)) {
            this.error('The vulnerable embedded Monaco sanitizer reached the production bundle.');
          }
          if (path === sanitizerEntry.replaceAll('\\', '/')) patchedModuleIncluded = true;
        }
      }
      if (!patchedModuleIncluded) {
        this.error('The patched editor sanitizer is missing from the production bundle.');
      }
      console.log('EDITOR_SANITIZER_BUNDLE=PASS (DOMPurify 3.4.16; embedded copy excluded)');
    },
  };
}
