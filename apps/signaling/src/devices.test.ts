import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { Devices } from './devices.js';
import { deviceContract } from '../../../tests/server/device-contract.mjs';

it('keeps SQLite identities durable, hash-only and within the atomic registration limit', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'ghostpair-store-'));
  try {
    const path = resolve(directory, 'devices.sqlite');
    const identities = await deviceContract(() => new Devices(path));
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = db.prepare('SELECT * FROM devices').all(); expect(rows).toHaveLength(4);
      for (const identity of identities) expect(rows.find(row => row.device_id === identity.deviceId)?.owner_token_hash).toBe(createHash('sha256').update(identity.ownerToken).digest('hex'));
      expect(JSON.stringify(rows)).not.toContain(identities[0].ownerToken);
    } finally { db.close(); }
  } finally {
    if (!directory.startsWith(resolve(tmpdir(), 'ghostpair-store-'))) throw new Error('Unexpected test path');
    await rm(directory, { recursive: true, force: true });
  }
});
