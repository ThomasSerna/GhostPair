import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class Devices {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      owner_token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT`);
  }

  get count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS count FROM devices').get() as { count: number }).count);
  }

  create(): { deviceId: string; ownerToken: string } {
    const deviceId = randomBytes(16).toString('hex');
    const ownerToken = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(ownerToken).digest('hex');
    this.db.prepare('INSERT INTO devices (device_id, owner_token_hash, created_at) VALUES (?, ?, ?)')
      .run(deviceId, hash, Date.now());
    return { deviceId, ownerToken };
  }

  authenticate(deviceId: string, ownerToken: string): boolean {
    const record = this.db.prepare('SELECT owner_token_hash FROM devices WHERE device_id = ?')
      .get(deviceId) as { owner_token_hash: string } | undefined;
    const actual = createHash('sha256').update(ownerToken).digest();
    const expected = record ? Buffer.from(record.owner_token_hash, 'hex') : Buffer.alloc(32);
    return timingSafeEqual(actual, expected) && record !== undefined;
  }

  close(): void {
    this.db.close();
  }
}
