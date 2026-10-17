import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The build helper is native ESM JavaScript, shared with the Windows build.
import { verifyCloudApiBundle } from './verifyCloudApiBundle.mjs';

let directory;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'cloud-api-bundle-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
const put = (name, source) => writeFileSync(join(directory, name), source);
describe('cloud API bootstrap validation', () => {
  it('accepts the API in the entry chunk', () => {
    put('index.js', 'const api = { baseURL: "/api/v1" };');
    expect(() => verifyCloudApiBundle(directory, 'index.js')).not.toThrow();
  });
  it('follows static shared imports, exports and cycles', () => {
    put('index.js', 'import {api} from "./shared.js";');
    put('shared.js', 'export {api} from "./api.js"; import "./index.js";');
    put('api.js', 'export const api = { baseURL: "/api/v1" };');
    expect(() => verifyCloudApiBundle(directory, 'index.js')).not.toThrow();
  });
  it('rejects a local API URL in a loaded shared chunk', () => {
    put('index.js', 'import {api} from "./api.js"; const path = "/api/v1";');
    put('api.js', 'export const api = { baseURL: "http://localhost:8000/api/v1" };');
    expect(() => verifyCloudApiBundle(directory, 'index.js')).toThrow('local API URL');
  });
  it('does not accept an unreferenced or only dynamically imported API module', () => {
    put('index.js', 'import("./api.js");');
    put('api.js', 'export const api = { baseURL: "/api/v1" };');
    expect(() => verifyCloudApiBundle(directory, 'index.js')).toThrow('same-origin API');
  });
  it('refuses imports outside emitted assets', () => {
    put('index.js', 'import "../outside.js";');
    expect(() => verifyCloudApiBundle(directory, 'index.js')).toThrow('escapes');
  });
});
