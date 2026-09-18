import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Identity { deviceId: string; ownerToken: string }
export interface DeviceStore {
  initialize(): Promise<void>;
  register(limit: number): Promise<Identity | null>;
  authenticate(deviceId: string, ownerToken: string): Promise<boolean>;
  check(): Promise<void>;
  close(): Promise<void>;
}
export function newIdentity() {
  const identity = { deviceId: randomBytes(16).toString('hex'), ownerToken: randomBytes(32).toString('hex') };
  return { identity, hash: createHash('sha256').update(identity.ownerToken).digest('hex'), createdAt: Date.now() };
}
export function verifyOwner(ownerToken: string, hash?: string): boolean {
  const valid = typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
  return timingSafeEqual(createHash('sha256').update(ownerToken).digest(), valid ? Buffer.from(hash, 'hex') : Buffer.alloc(32)) && valid;
}

/** The existing SQLite file format stays unchanged. */
export class Devices implements DeviceStore {
  private db?: DatabaseSync;
  constructor(private readonly path: string) {}
  async initialize() {
    if (this.db) return;
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, owner_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT');
  }
  async register(limit: number): Promise<Identity | null> {
    const db = this.database(); db.exec('BEGIN IMMEDIATE');
    try {
      const count = Number((db.prepare('SELECT COUNT(*) AS count FROM devices').get() as { count: number }).count);
      if (count >= limit) { db.exec('COMMIT'); return null; }
      const { identity, hash, createdAt } = newIdentity();
      db.prepare('INSERT INTO devices (device_id, owner_token_hash, created_at) VALUES (?, ?, ?)').run(identity.deviceId, hash, createdAt);
      db.exec('COMMIT'); return identity;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async authenticate(deviceId: string, ownerToken: string) {
    const record = this.database().prepare('SELECT owner_token_hash FROM devices WHERE device_id = ?').get(deviceId) as { owner_token_hash: string } | undefined;
    return verifyOwner(ownerToken, record?.owner_token_hash);
  }
  async check() { this.database().prepare('SELECT 1').get(); }
  async close() { this.db?.close(); this.db = undefined; }
  private database() { if (!this.db) throw new Error('Identity storage is not initialized.'); return this.db; }
}
