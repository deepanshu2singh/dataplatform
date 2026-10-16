// Verify the emitted static files and entrypoint contracts, without network or secrets.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
for (const path of ['favicon.ico', 'favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png', 'site.webmanifest', 'brand.css', 'loading-screen-1920x1080.png']) {
  if (!existsSync(join(dist, path)) || !html.includes(`/${path}`)) throw new Error(`Built entrypoint asset missing: ${path}`);
}
for (const [name, width, height] of [
  ['favicon-16x16.png', 16, 16], ['favicon-32x32.png', 32, 32],
  ['apple-touch-icon.png', 180, 180], ['android-chrome-192x192.png', 192, 192],
  ['android-chrome-512x512.png', 512, 512], ['homepage-logo-dark.png', 1600, 500],
  ['homepage-logo-transparent.png', 1600, 420], ['loading-screen-1920x1080.png', 1920, 1080],
]) {
  const data = readFileSync(join(dist, name));
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || data.readUInt32BE(16) !== width || data.readUInt32BE(20) !== height) throw new Error(`Incorrect PNG asset: ${name}`);
}
const manifest = JSON.parse(readFileSync(join(dist, 'site.webmanifest'), 'utf8'));
if (manifest.name !== 'Data Platform' || manifest.start_url !== '/' || manifest.scope !== '/') throw new Error('Incorrect app manifest identity or route.');
for (const icon of manifest.icons) {
  if (!/^\/android-chrome-(192x192|512x512)\.png$/.test(icon.src) || !existsSync(join(dist, icon.src.slice(1)))) throw new Error('App manifest references a missing or external icon.');
}
const ico = readFileSync(join(dist, 'favicon.ico'));
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('Invalid browser icon.');
if (!html.includes('<title>Data Platform</title>') || !html.includes('role="status"') || !html.includes('theme-color')) throw new Error('Brand identity or accessible startup state is missing.');
console.log('CLOUD_BRAND_ASSETS=PASS');
