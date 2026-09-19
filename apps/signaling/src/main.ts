import { configFromEnv } from './config.js';
import { createServer } from './server.js';
import { loadRootEnvironment } from './environment.js';

try {
  loadRootEnvironment();
  const server = createServer(configFromEnv());
  await server.listen();
  console.info(JSON.stringify({ event: 'signaling.started' }));
  const metrics = setInterval(() => console.info(JSON.stringify({ event: 'signaling.counters', ...server.stats })), 60_000);
  metrics.unref();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(metrics);
    await server.close();
    console.info(JSON.stringify({ event: 'signaling.stopped' }));
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
} catch {
  console.error(JSON.stringify({ event: 'signaling.start_failed', message: 'Check Node 24, database connection/TLS configuration, database permissions and listening port.' }));
  process.exitCode = 1;
}
