// Vercel invokes this from the frontend service root. Also works on Windows.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const override = process.env.VITE_API_URL;
if (override !== undefined && override !== '/api/v1') {
  console.error('Cloud build requires VITE_API_URL=/api/v1. Remove the incompatible hosting override.');
  process.exit(1);
}
// An existing local frontend/.env may point to localhost. Vite gives this
// explicit process variable priority, without modifying that local file.
const env = { ...process.env, VITE_API_URL: '/api/v1' };
for (const [entry, args] of [
  ['node_modules/typescript/bin/tsc', ['-b']],
  ['node_modules/vite/bin/vite.js', ['build']],
]) {
  const result = spawnSync(process.execPath, [join(root, entry), ...args], {
    cwd: root, env, stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    console.error('Cloud frontend build failed.');
    process.exit(result.status || 1);
  }
}

const dist = join(root, 'dist');
const runtime = join(dist, 'pyodide', '314.0.7');
for (const asset of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  if (!existsSync(join(runtime, asset))) throw new Error(`Missing browser runtime asset: ${asset}`);
}
if (!existsSync(join(dist, 'python-worker.mjs'))) throw new Error('Missing browser Python worker.');
// Check the shipped main application bundle, not source maps or test output.
const bundle = readdirSync(join(dist, 'assets')).filter((name) => /^index-.*\.js$/.test(name));
if (bundle.length !== 1) throw new Error('Could not identify the main application bundle.');
const source = readFileSync(join(dist, 'assets', bundle[0]), 'utf8');
if (!source.includes('/api/v1') || source.includes('http://localhost:8000/api/v1')) {
  throw new Error('Built application does not use the required same-origin API.');
}
console.log('CLOUD_FRONTEND_BUILD=PASS');
console.log('CLOUD_API_BASE=/api/v1');
console.log('SELF_HOSTED_PYTHON_ASSETS=PASS');
