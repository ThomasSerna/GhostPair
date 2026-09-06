import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const root = resolve('dist/extension');
const files = {};
function collect(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isDirectory()) collect(path); else files[relative(root, path).split(sep).join('/')] = new Uint8Array(readFileSync(path)); } }
collect(root);
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.version !== '0.1.0') throw new Error('Unexpected manifest');
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
