import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadRootEnvironment } from './environment.js';
import { PostgresDevices } from './postgres-devices.js';
import { migrateDevices } from './migrate-devices.js';

let target: PostgresDevices | undefined;
try {
  loadRootEnvironment();
  const { values } = parseArgs({ options: { source: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } } });
  if (!values.source || !process.env.DATABASE_URL) throw new Error('Provide --source and DATABASE_URL.');
  target = new PostgresDevices({ databaseUrl: process.env.DATABASE_URL, databaseSslMode: (process.env.DATABASE_SSL_MODE ?? 'verify-full') as 'verify-full' | 'disable', databaseSslCaFile: process.env.DATABASE_SSL_CA_FILE });
  console.info(JSON.stringify(await migrateDevices(resolve(values.source), target, values['dry-run'])));
} catch {
  console.error('Migration failed. Check arguments, database configuration and identity conflicts. No credentials are printed.');
  process.exitCode = 1;
} finally { await target?.close(); }
