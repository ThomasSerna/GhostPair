import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { artifactRoot, removeTestArtifact } from './helpers.mjs';

// Exercise root resolution without reading or rewriting the developer's .env.
await mkdir(artifactRoot, { recursive: true });
const scratch = await mkdtemp(resolve(artifactRoot, 'environment-'));
const vite = resolve('node_modules/vite/bin/vite.js');
const publicDefault = 'https://root-build-default.example.test';
const injected = 'https://injected-build-default.example.test';
const privateValue = 'ghostpair-private-env-sentinel-c72d6';
const env = { ...process.env }; delete env.VITE_SIGNALING_URL; delete env.VITE_STUN_URLS; delete env.PRIVATE_TOKEN;
async function contents(path) {
  let result = '';
  for (const file of await readdir(path, { withFileTypes: true })) {
    const name = resolve(path, file.name);
    result += file.isDirectory() ? await contents(name) : await readFile(name, 'utf8');
  }
  return result;
}
try {
  const extension = resolve(scratch, 'apps/extension');
  await mkdir(extension, { recursive: true });
  for (const file of ['src', 'public', 'build-settings.mjs', 'vite.config.ts', 'popup.html', 'viewer.html', 'offscreen.html']) await cp(resolve('apps/extension', file), resolve(extension, file), { recursive: true });
  await writeFile(resolve(scratch, '.env'), `VITE_SIGNALING_URL=${publicDefault}\nVITE_STUN_URLS=stun:example.test:3478\nDATABASE_PATH=${privateValue}\nPRIVATE_TOKEN=${privateValue}\n`);
  for (const [cwd, override] of [[scratch, false], [extension, false], [extension, true]]) {
    execFileSync(process.execPath, [vite, 'build', extension, '--config', resolve(extension, 'vite.config.ts')], { cwd, env: { ...env, ...(override ? { VITE_SIGNALING_URL: injected } : {}) }, stdio: 'pipe' });
    const bundle = await contents(resolve(scratch, 'dist/extension'));
    assert.ok(bundle.includes(override ? injected : publicDefault), 'public settings use root .env and process precedence from either directory');
    assert.ok(!bundle.includes(privateValue), 'private settings cannot enter the extension package');
  }
  const fixtureSignal = 'https://connect.ghostpair.dev';
  const storeEnv = { ...env, GHOSTPAIR_STORE_BUILD: '1', VITE_SIGNALING_URL: fixtureSignal, VITE_STUN_URLS: 'stun:stun.l.google.com:19302' };
  execFileSync(process.execPath, [vite, 'build', extension, '--config', resolve(extension, 'vite.config.ts')], { cwd: scratch, env: storeEnv, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(await readFile(resolve(scratch, 'dist/extension/build-defaults.json'), 'utf8')), { signalingUrl: fixtureSignal, stunUrls: ['stun:stun.l.google.com:19302'] });
  assert.ok(!(await contents(resolve(scratch, 'dist/extension'))).includes(privateValue));
  await mkdir(resolve(scratch, 'scripts'), { recursive: true });
  await mkdir(resolve(scratch, 'packages/protocol'), { recursive: true });
  await mkdir(resolve(scratch, 'apps/signaling'), { recursive: true });
  for (const file of ['package.json', 'apps/extension/package.json', 'apps/signaling/package.json', 'packages/protocol/package.json', 'scripts/package.mjs']) await cp(resolve(file), resolve(scratch, file));
  const packageFixture = () => execFileSync(process.execPath, [resolve(scratch, 'scripts/package.mjs'), '--store'], { cwd: scratch, env, stdio: 'pipe' });
  packageFixture();
  assert.equal((await readdir(resolve(scratch, 'dist/packages'))).filter(file => file.endsWith('.zip')).length, 2);
  const manifestPath = resolve(scratch, 'dist/extension/manifest.json'), originalManifest = await readFile(manifestPath, 'utf8');
  const testManifest = JSON.parse(originalManifest); testManifest.permissions.push('management');
  await writeFile(manifestPath, JSON.stringify(testManifest));
  assert.throws(packageFixture, /Unexpected store permissions/);
  await writeFile(manifestPath, originalManifest);
  await writeFile(resolve(scratch, 'dist/extension/test-instrumentation.js'), 'window["benchmark.stats"] = true;');
  assert.throws(packageFixture, /Disallowed runtime implementation/);
  assert.throws(() => execFileSync(process.execPath, [vite, 'build', extension, '--config', resolve(extension, 'vite.config.ts')], { cwd: scratch, env: { ...storeEnv, VITE_SIGNALING_URL: 'http://127.0.0.1:8787' }, stdio: 'pipe' }));
  const module = resolve(scratch, 'apps/signaling/dist'); await mkdir(module, { recursive: true });
  await cp(resolve('apps/signaling/dist/environment.js'), resolve(module, 'environment.js'));
  await writeFile(resolve(module, 'check.mjs'), `import {loadRootEnvironment} from './environment.js';loadRootEnvironment();if(process.env.PRIVATE_TOKEN!==process.argv[2])throw new Error('Root environment or process precedence failed');`);
  for (const cwd of [scratch, resolve(scratch, 'apps/signaling')]) execFileSync(process.execPath, [resolve(module, 'check.mjs'), privateValue], { cwd, env, stdio: 'pipe' });
  execFileSync(process.execPath, [resolve(module, 'check.mjs'), 'injected-private-test-value'], { cwd: scratch, env: { ...env, PRIVATE_TOKEN: 'injected-private-test-value' }, stdio: 'pipe' });
  console.log('Environment checks passed: root/workspace loading, public precedence, private bundle exclusion, store ZIPs, endpoint/permission/instrumentation rejection.');
} finally { await removeTestArtifact(scratch); }
