import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const root = resolve('dist/extension');
const files = {};
function collect(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isDirectory()) collect(path); else files[relative(root, path).split(sep).join('/')] = new Uint8Array(readFileSync(path)); } }
collect(root);
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const version = JSON.parse(readFileSync(resolve('apps/extension/package.json'), 'utf8')).version;
if (manifest.manifest_version !== 3 || manifest.version !== version || manifest.permissions.includes('debugger')) throw new Error('Unexpected manifest');
if (manifest.host_permissions?.length) throw new Error('Test-only required host grants cannot be packaged');
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
