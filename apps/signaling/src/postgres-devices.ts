import { readFileSync } from 'node:fs';
import { Pool, type PoolClient } from 'pg';
import { newIdentity, verifyOwner, type DeviceStore, type Identity } from './devices.js';

export interface PostgresConfig { databaseUrl: string; databaseSslMode: 'verify-full' | 'disable'; databaseSslCaFile?: string }
export function validatePostgresConfig(config: PostgresConfig) {
  let url: URL;
  try { url = new URL(config.databaseUrl); } catch { throw new Error('Invalid DATABASE_URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error('Invalid DATABASE_URL.');
  if (['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl'].some(key => url.searchParams.has(key))) throw new Error('Configure TLS with DATABASE_SSL_MODE and DATABASE_SSL_CA_FILE, not DATABASE_URL parameters.');
  if (!['verify-full', 'disable'].includes(config.databaseSslMode)) throw new Error('Invalid DATABASE_SSL_MODE.');
  if (config.databaseSslMode === 'disable' && config.databaseSslCaFile) throw new Error('DATABASE_SSL_CA_FILE requires verify-full.');
}
export class PostgresDevices implements DeviceStore {
  readonly pool: Pool;
  private closed = false;
  constructor(config: PostgresConfig) {
    validatePostgresConfig(config);
    this.pool = new Pool({
      connectionString: config.databaseUrl, max: 4,
      connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000,
      ssl: config.databaseSslMode === 'disable' ? false : { rejectUnauthorized: true, ...(config.databaseSslCaFile ? { ca: readFileSync(config.databaseSslCaFile, 'utf8') } : {}) },
    });
    this.pool.on('error', () => {}); // Never log credentials or SQL on idle connection failures.
  }
  async initialize() {
    await this.pool.query('CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, owner_token_hash TEXT NOT NULL, created_at BIGINT NOT NULL)');
  }
  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect(); let broken = false;
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE devices IN SHARE ROW EXCLUSIVE MODE');
      const result = await operation(client);
      await client.query('COMMIT'); return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }
  async register(limit: number): Promise<Identity | null> {
    return this.transaction(async client => {
      if (Number((await client.query('SELECT COUNT(*) AS count FROM devices')).rows[0].count) >= limit) return null;
      const { identity, hash, createdAt } = newIdentity();
      await client.query('INSERT INTO devices (device_id, owner_token_hash, created_at) VALUES ($1, $2, $3)', [identity.deviceId, hash, createdAt]);
      return identity;
    });
  }
  async authenticate(deviceId: string, ownerToken: string) {
    const result = await this.pool.query('SELECT owner_token_hash FROM devices WHERE device_id = $1', [deviceId]);
    return verifyOwner(ownerToken, result.rows[0]?.owner_token_hash);
  }
  async check() { await this.pool.query('SELECT 1'); }
  async close() { if (!this.closed) { this.closed = true; await this.pool.end(); } }
}
