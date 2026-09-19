import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';

const run = promisify(execFile), docker = (...args) => run('docker', args, { windowsHide: true, maxBuffer: 1024 * 1024 });
const origin = `chrome-extension://${'a'.repeat(32)}`;
let container, socket;
async function ready() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const status = JSON.parse((await docker('inspect', container)).stdout)[0];
    if (status.State.Health?.Status === 'healthy') {
      const binding = (await docker('port', container, '9797/tcp')).stdout.trim();
      return `http://127.0.0.1:${binding.split(':').at(-1)}`;
    }
    if (!status.State.Running) throw new Error('Validation container stopped.');
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error('Docker health check did not pass on the configured PORT.');
}
try {
  container = (await docker('run', '--rm', '-d', '-e', 'PORT=9797', '--health-interval=1s', '--health-start-period=1s', '-p', '127.0.0.1::9797', 'ghostpair:validation')).stdout.trim();
  assert.match(container, /^[a-f0-9]{64}$/);
  let base = await ready();
  for (const route of ['/health', '/ready', '/privacy']) assert.equal((await fetch(base + route)).status, 200);
  assert.equal((await fetch(base + '/v1/devices', { method: 'POST', headers: { Origin: 'https://denied.test' } })).status, 403);
  const response = await fetch(base + '/v1/devices', { method: 'POST', headers: { Origin: origin } });
  assert.equal(response.status, 201); const identity = await response.json();
  await docker('restart', container); base = await ready();
  socket = new WebSocket(base.replace('http:', 'ws:') + '/v1/connect', { origin: `chrome-extension://${'p'.repeat(32)}` });
  await new Promise((done, fail) => { socket.once('open', done); socket.once('error', fail); });
  const result = new Promise((done, fail) => { const timer = setTimeout(() => fail(new Error('Container authentication timeout')), 10000); socket.once('message', data => { clearTimeout(timer); done(JSON.parse(data)); }); });
  socket.send(JSON.stringify({ type: 'host.open', ...identity, password: 'Synthetic container password' }));
  assert.equal((await result).type, 'host.ready');
  console.log(JSON.stringify({ container: true, configuredPortHealthcheck: true, privacy: true, originChecks: true, restartIdentity: true }));
} finally {
  socket?.terminate();
  if (container && /^[a-f0-9]{64}$/.test(container)) await docker('rm', '-f', container);
}
