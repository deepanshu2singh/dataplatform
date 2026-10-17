import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

// Vite may move shared modules out of index.js. Inspect the actual statically
// imported bootstrap graph, rather than depending on a particular chunk name.
export function verifyCloudApiBundle(assetsDirectory, entryName) {
  const root = resolve(assetsDirectory);
  const pending = [resolve(root, entryName)];
  const visited = new Set();
  let foundApi = false;
  while (pending.length) {
    const file = pending.pop();
    if (!file.startsWith(root + sep)) throw new Error('Bootstrap import escapes the assets directory.');
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    if (source.includes('http://localhost:8000/api/v1')) {
      throw new Error('Built application contains a local API URL.');
    }
    foundApi ||= source.includes('/api/v1');
    // Static ESM imports/exports emitted by Vite. Dynamic import() is not a
    // bootstrap dependency and cannot satisfy the required API configuration.
    for (const match of source.matchAll(/\b(?:from\s*|import\s*)["'](\.\.?\/[^"']+\.js)["']/g)) {
      pending.push(resolve(dirname(file), match[1]));
    }
  }
  if (!foundApi) throw new Error('Built application does not use the required same-origin API.');
}
