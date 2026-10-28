import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';

const run = promisify(execFile);
const root = process.cwd(), artifacts = resolve('tests/server/.artifacts');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through npm run test:heroku.');
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(resolve(artifacts, 'heroku-smoke-'));
const app = resolve(directory, 'app'), cluster = resolve(directory, 'cluster');
const nativeBin = process.env.GHOSTPAIR_TEST_POSTGRES_BIN;
const password = randomBytes(16).toString('hex');
const npm = (...args) => run(process.execPath, [npmCli, ...args], { cwd: app, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 120000 });
const docker = (...args) => run('docker', args, { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 60000 });
async function dockerReady() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { await docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); return; } catch {}
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error('PostgreSQL container did not become ready.');
}
async function port() {
  const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done));
  const value = server.address().port; await new Promise(done => server.close(done)); return value;
}
async function native(name, args) {
  const child = spawn(resolve(nativeBin, name + (process.platform === 'win32' ? '.exe' : '')), args, { windowsHide: true, stdio: 'ignore', env: { ...process.env, PGPASSWORD: password } });
  await new Promise((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(new Error(name + ' timed out')); }, 60000);
    child.once('error', error => { clearTimeout(timer); fail(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? done() : fail(new Error(name + ' exited ' + code)); });
  });
}
const missing = async path => { try { await stat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
let databaseStarted = false, container, running, denied, socket;
async function start(databaseUrl, requestedPort) {
  const env = { ...process.env, DYNO: 'web.1', NODE_ENV: 'production', HOST: '0.0.0.0', PORT: String(requestedPort) };
  for (const field of ['DATABASE_URL', 'DATABASE_PATH', 'DATABASE_SSL_MODE', 'DATABASE_SSL_CA_FILE']) delete env[field];
  if (databaseUrl) { env.DATABASE_URL = databaseUrl; env.DATABASE_SSL_MODE = 'disable'; }
  // Windows does not deliver POSIX SIGTERM; emit the signal over a test-only IPC bridge.
  const hook = "process.once('message', m => { if(m === 'SIGTERM') { process.disconnect(); process.emit('SIGTERM'); } });";
  const bridge = process.platform === 'win32' ? ['--import', 'data:text/javascript,' + encodeURIComponent(hook)] : [];
  const child = spawn(process.execPath, [...bridge, 'apps/signaling/dist/main.js'], { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', ...(bridge.length ? ['ipc'] : [])] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exit = new Promise((done, fail) => { child.once('error', fail); child.once('exit', (code, signal) => done({ code, signal })); });
  return { child, exit, output: () => output, port: requestedPort };
}
async function ready(process) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (process.child.exitCode !== null) throw new Error('Runtime exited before readiness: ' + process.output());
    try { if ((await fetch('http://127.0.0.1:' + process.port + '/ready', { signal: AbortSignal.timeout(1000) })).status === 200) return; } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error('Runtime did not become ready: ' + process.output());
}
async function stop(process) {
  if (process.child.connected) process.child.send('SIGTERM'); else process.child.kill('SIGTERM');
  let timer;
  try {
    const result = await Promise.race([process.exit, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('Graceful shutdown timed out')), 10000); })]);
    assert.equal(result.code, 0); assert.match(process.output(), /signaling.stopped/);
  } finally { clearTimeout(timer); }
}
async function authenticate(identity, requestedPort) {
  socket = new WebSocket('ws://127.0.0.1:' + requestedPort + '/v1/connect', { origin: 'chrome-extension://' + 'p'.repeat(32), handshakeTimeout: 5000 });
  await new Promise((done, fail) => { socket.once('open', done); socket.once('error', fail); });
  const response = new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Authentication timed out')), 10000);
    socket.once('message', data => { clearTimeout(timer); done(JSON.parse(data)); });
  });
  socket.send(JSON.stringify({ type: 'host.open', protocol: 6, ...identity, salt: '0'.repeat(32), password: 'a'.repeat(64) }));
  assert.equal((await response).type, 'host.ready');
  socket.terminate(); socket = undefined;
}
try {
  await mkdir(app);
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.base.json', 'apps/signaling/package.json', 'apps/signaling/tsconfig.json', 'apps/extension/package.json', 'apps/landing/package.json', 'packages/protocol/package.json', 'docs/privacy.html']) {
    await mkdir(dirname(resolve(app, file)), { recursive: true }); await cp(resolve(root, file), resolve(app, file));
  }
  for (const path of ['apps/signaling/src', 'packages/protocol/src']) await cp(resolve(root, path), resolve(app, path), { recursive: true });
  await npm('ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund');
  await npm('run', 'heroku-postbuild');
  assert.equal(await missing(resolve(app, 'apps/signaling/dist/main.js')), false);
  assert.equal(await missing(resolve(app, 'dist/extension')), true);
  assert.equal(await missing(resolve(app, 'docs/index.html')), true);
  await npm('prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund');
  for (const name of ['typescript', 'vitest', 'tsx']) assert.equal(await missing(resolve(app, 'node_modules', name)), true);
  denied = await start(undefined, await port());
  // A failed main leaves the test IPC listener alive; disconnect it after startup has failed.
  for (let attempt = 0; attempt < 100 && !denied.output().includes('signaling.start_failed'); attempt++) await new Promise(done => setTimeout(done, 50));
  assert.match(denied.output(), /signaling.start_failed/); if (denied.child.connected) denied.child.disconnect();
  assert.equal((await denied.exit).code, 1);
  assert.equal(await missing(resolve(app, 'data')), true);
  const dbPort = await port(), serverPort = await port();
  if (nativeBin) {
    const passwordFile = resolve(directory, 'password'); await writeFile(passwordFile, password, { mode: 0o600 });
    await native('initdb', ['-D', cluster, '-U', 'postgres', '--pwfile=' + passwordFile, '--auth=scram-sha-256', '--no-locale', '--encoding=UTF8']);
    await native('pg_ctl', ['-D', cluster, '-l', resolve(directory, 'postgres.log'), '-o', '-h 127.0.0.1 -p ' + dbPort, '-w', 'start']); databaseStarted = true;
  } else {
    container = (await docker('run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=' + password, '-p', '127.0.0.1:' + dbPort + ':5432', 'postgres:17-bookworm')).stdout.trim();
    assert.match(container, /^[a-f0-9]{64}$/);
    await dockerReady();
  }
  const databaseUrl = 'postgres://postgres:' + password + '@127.0.0.1:' + dbPort + '/postgres';
  running = await start(databaseUrl, serverPort); await ready(running);
  for (const path of ['/health', '/privacy']) assert.equal((await fetch('http://127.0.0.1:' + serverPort + path)).status, 200);
  const registration = await fetch('http://127.0.0.1:' + serverPort + '/v1/devices', { method: 'POST', headers: { Origin: 'chrome-extension://' + 'a'.repeat(32) } });
  assert.equal(registration.status, 201); const identity = await registration.json(); await authenticate(identity, serverPort);
  await stop(running); running = undefined;
  if (nativeBin) await native('pg_ctl', ['-D', cluster, '-l', resolve(directory, 'postgres.log'), '-m', 'fast', '-w', 'restart']);
  else { await docker('restart', container); await dockerReady(); }
  running = await start(databaseUrl, serverPort); await ready(running); await authenticate(identity, serverPort);
  await stop(running); running = undefined;
  assert.equal(await missing(resolve(app, 'data')), true);
  console.log(JSON.stringify({ node: process.version, runtime: nativeBin ? 'native' : 'docker', herokuPostbuildOnlySignaling: true, freshInstall: true, devDependenciesPruned: true, missingDatabaseRejected: true, injectedPort: true, readiness: true, privacy: true, databaseRestartPersistence: true, signalHandlerShutdown: true, windowsPosixSignalEmittedThroughTestIPC: process.platform === 'win32' }));
} finally {
  socket?.terminate();
  if (denied?.child.exitCode === null) denied.child.kill();
  if (running) running.child.kill();
  if (databaseStarted) await native('pg_ctl', ['-D', cluster, '-m', 'fast', '-w', 'stop']);
  if (container && /^[a-f0-9]{64}$/.test(container)) await docker('rm', '-f', container);
  const inside = relative(artifacts, directory);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Unsafe artifact directory');
  await rm(directory, { recursive: true, force: true });
}
