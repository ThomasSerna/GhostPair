import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { validateStoreSettings } from '../apps/extension/build-settings.mjs';

const root = resolve('dist/extension');
const files = {};
if (process.argv.includes('--store')) validateStoreSettings(JSON.parse(readFileSync(resolve(root, 'build-defaults.json'), 'utf8')));
function collect(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isDirectory()) collect(path); else files[relative(root, path).split(sep).join('/')] = new Uint8Array(readFileSync(path)); } }
collect(root);
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const version = JSON.parse(readFileSync(resolve('apps/extension/package.json'), 'utf8')).version;
if ([JSON.parse(readFileSync('package.json', 'utf8')).version, JSON.parse(readFileSync('apps/signaling/package.json', 'utf8')).version, JSON.parse(readFileSync('packages/protocol/package.json', 'utf8')).version].some(value => value !== version)) throw new Error('Workspace versions must match.');
if (manifest.manifest_version !== 3 || manifest.version !== version || manifest.permissions.includes('debugger')) throw new Error('Unexpected manifest');
if (manifest.host_permissions?.length) throw new Error('Test-only required host grants cannot be packaged');
if (process.argv.includes('--store')) {
  const expected = {
    permissions: ['tabCapture', 'activeTab', 'scripting', 'webNavigation', 'tabs', 'storage', 'offscreen'],
    optional_permissions: ['clipboardRead', 'clipboardWrite'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  };
  for (const [field, values] of Object.entries(expected)) {
    if (JSON.stringify([...(manifest[field] ?? [])].sort()) !== JSON.stringify(values.sort())) throw new Error(`Unexpected store permissions: ${field}`);
  }
}
for (const [path, bytes] of Object.entries(files)) {
  if (/(^|\/)\.env(?:\.|$)|benchmark-instrument|\.test\.|\.map$/.test(path)) throw new Error(`Unexpected package file: ${path}`);
  if (path.endsWith('.js') && /\bdebugger\b|benchmark\.stats/.test(new TextDecoder().decode(bytes))) throw new Error(`Disallowed runtime implementation: ${path}`);
}
const output = resolve('dist/packages'); mkdirSync(output, { recursive: true });
for (const browser of ['chrome', 'edge']) {
  const product = structuredClone(manifest);
  delete product.key;
  delete product.update_url;
  const archive = { ...files, 'manifest.json': strToU8(JSON.stringify(product, null, 2)) };
  const file = resolve(output, `ghostpair-${browser}-${product.version}.zip`);
  writeFileSync(file, zipSync(archive, { level: 9 }));
  process.stdout.write(`Packaged ${relative(process.cwd(), file)}\n`);
}
