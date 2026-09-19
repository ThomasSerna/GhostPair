import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createServer as createTcpServer } from 'node:net';
import { Devices } from '../../apps/signaling/dist/devices.js';
import { PostgresDevices } from '../../apps/signaling/dist/postgres-devices.js';
import { migrateDevices } from '../../apps/signaling/dist/migrate-devices.js';
import { createServer } from '../../apps/signaling/dist/server.js';
import { deviceContract } from './device-contract.mjs';

const run = promisify(execFile), docker = (...args) => run('docker', args, { windowsHide: true, maxBuffer: 1024 * 1024 });
const root = resolve('tests/server/.artifacts'); await mkdir(root, { recursive: true });
const directory = await mkdtemp(resolve(root, 'postgres-'));
const password = randomBytes(16).toString('hex');
// Optional local PostgreSQL binaries keep the same integration checks usable
// when Docker is unavailable. Every cluster is isolated inside test artifacts.
const nativeBin = process.env.GHOSTPAIR_TEST_POSTGRES_BIN;
const cluster = resolve(directory, 'cluster');
const native = (name, args) => new Promise((done, fail) => {
  // pg_ctl starts a background server. Ignored stdio avoids inherited pipe
  // handles keeping execFile's close event pending on Windows after pg_ctl exits.
  const child = spawn(resolve(nativeBin, name + (process.platform === 'win32' ? '.exe' : '')), args, {
    windowsHide: true, stdio: 'ignore', env: { ...process.env, PGPASSWORD: password },
  });
  const timer = setTimeout(() => { child.kill(); fail(new Error(`${name} timed out`)); }, 60000);
  child.once('error', error => { clearTimeout(timer); fail(error); });
  child.once('exit', code => { clearTimeout(timer); code === 0 ? done() : fail(new Error(`${name} exited with code ${code}`)); });
});
let container, nativeStarted = false, store, server, socket, sourceDb;
async function retry(check) {
  const deadline = Date.now() + 60000; let last;
  while (Date.now() < deadline) { try { return await check(); } catch (error) { if (!last) console.log(JSON.stringify({ waitingForPostgres: error.code || error.message })); last = error; await new Promise(done => setTimeout(done, 250)); } }
  throw new Error('PostgreSQL did not become ready: ' + (last?.code || last?.message));
}
try {
  const reservation = createTcpServer(); await new Promise(done => reservation.listen(0, '127.0.0.1', done));
  const requestedPort = reservation.address().port; await new Promise(done => reservation.close(done));
  let port = requestedPort;
  if (nativeBin) {
    const passwordFile = resolve(directory, 'password');
    await writeFile(passwordFile, password, { mode: 0o600 });
    await native('initdb', ['-D', cluster, '-U', 'postgres', '--pwfile=' + passwordFile, '--auth=scram-sha-256', '--no-locale', '--encoding=UTF8']);
    await native('pg_ctl', ['-D', cluster, '-l', resolve(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    nativeStarted = true;
    const bootstrap = new PostgresDevices({ databaseUrl: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`, databaseSslMode: 'disable' });
    try { await bootstrap.pool.query('CREATE DATABASE ghostpair'); } finally { await bootstrap.close(); }
  } else {
    container = (await docker('run', '--rm', '-d', '--name', `ghostpair-test-${process.pid}-${randomBytes(3).toString('hex')}`, '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=ghostpair', '-p', `127.0.0.1:${requestedPort}:5432`, 'postgres:17-bookworm')).stdout.trim();
    assert.match(container, /^[a-f0-9]{64}$/);
    const binding = (await docker('port', container, '5432/tcp')).stdout.trim();
    port = Number(binding.split(':').at(-1)); assert.ok(port > 0);
  }
  const config = { databaseUrl: `postgres://postgres:${password}@127.0.0.1:${port}/ghostpair`, databaseSslMode: 'disable' };
  store = new PostgresDevices(config); await retry(() => store.check());
  const identities = await deviceContract(() => new PostgresDevices(config));
  const rows = (await store.pool.query('SELECT * FROM devices')).rows;
  for (const identity of identities) assert.equal(rows.find(row => row.device_id === identity.deviceId).owner_token_hash, createHash('sha256').update(identity.ownerToken).digest('hex'));
  assert.ok(!JSON.stringify(rows).includes(identities[0].ownerToken));
  if (nativeBin) await native('pg_ctl', ['-D', cluster, '-l', resolve(directory, 'postgres.log'), '-m', 'fast', '-w', 'restart']);
  else await docker('restart', container);
  await retry(() => store.check());
  assert.equal(await store.authenticate(identities[0].deviceId, identities[0].ownerToken), true);
  const source = resolve(directory, 'source.sqlite'), sqlite = new Devices(source);
  await sqlite.initialize(); const original = await sqlite.register(10); await sqlite.close();
  const before = (await store.pool.query('SELECT COUNT(*) FROM devices')).rows[0].count;
  assert.deepEqual(await migrateDevices(source, store, true), { read: 1, inserted: 0, existing: 0, dryRun: true });
  assert.equal((await store.pool.query('SELECT COUNT(*) FROM devices')).rows[0].count, before);
  assert.equal((await migrateDevices(source, store)).inserted, 1);
  assert.equal((await migrateDevices(source, store)).existing, 1);
  assert.equal(await store.authenticate(original.deviceId, original.ownerToken), true);
  sourceDb = new DatabaseSync(source);
  const sourceRow = sourceDb.prepare('SELECT * FROM devices').get();
  const imported = (await store.pool.query('SELECT * FROM devices WHERE device_id=$1', [original.deviceId])).rows[0];
  assert.deepEqual({ ...imported, created_at: Number(imported.created_at) }, { ...sourceRow });
  // Sorted new row is inserted before the conflicting row; the entire import rolls back.
  sourceDb.prepare('INSERT INTO devices VALUES (?, ?, ?)').run('0'.repeat(32), 'a'.repeat(64), 1);
  sourceDb.prepare('UPDATE devices SET owner_token_hash=? WHERE device_id=?').run('b'.repeat(64), original.deviceId); sourceDb.close();
  await assert.rejects(migrateDevices(source, store), /Conflicting/);
  assert.equal((await store.pool.query('SELECT * FROM devices WHERE device_id=$1', ['0'.repeat(32)])).rowCount, 0);
  assert.equal(await store.authenticate(original.deviceId, original.ownerToken), true);
  const origin = `chrome-extension://${'a'.repeat(32)}`;
  server = createServer({ ...config, port: 0, scryptN: 1024 });
  const address = await server.listen();
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/ready`)).status, 200);
  socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/connect`, { origin });
  await new Promise((done, fail) => { socket.once('open', done); socket.once('error', fail); });
  const response = new Promise((done, fail) => { const timer = setTimeout(() => fail(new Error('Authentication timeout')), 5000); socket.once('message', data => { clearTimeout(timer); done(JSON.parse(data)); }); });
  socket.send(JSON.stringify({ type: 'host.open', ...original, password: 'Synthetic test password' }));
  assert.equal((await response).type, 'host.ready');
  console.log(JSON.stringify({ postgres: true, runtime: nativeBin ? 'native' : 'docker', sharedContract: true, persistence: true, restart: true, migration: true, dryRun: true, conflictRollback: true, originalCredentials: true }));
} finally {
  if (sourceDb?.isOpen) sourceDb.close();
  socket?.terminate(); await server?.close(); await store?.close();
  if (nativeStarted) await native('pg_ctl', ['-D', cluster, '-m', 'fast', '-w', 'stop']);
  if (container && /^[a-f0-9]{64}$/.test(container)) await docker('rm', '-f', container);
  const within = relative(root, directory);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Unsafe test directory');
  await rm(directory, { recursive: true, force: true });
}
