import { DatabaseSync } from 'node:sqlite';
import { PostgresDevices } from './postgres-devices.js';

export async function migrateDevices(sourcePath: string, target: PostgresDevices, dryRun = false) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let records: { device_id: string; owner_token_hash: string; created_at: number }[];
  try {
    source.exec('BEGIN');
    records = source.prepare('SELECT device_id, owner_token_hash, created_at FROM devices ORDER BY device_id').all() as typeof records;
    source.exec('COMMIT');
  } finally { source.close(); }
  for (const row of records) {
    if (!/^[a-f0-9]{32}$/.test(row.device_id) || !/^[a-f0-9]{64}$/.test(row.owner_token_hash) || !Number.isSafeInteger(row.created_at) || row.created_at < 0) throw new Error('Invalid source identity data.');
  }
  if (dryRun) return { read: records.length, inserted: 0, existing: 0, dryRun: true };
  await target.initialize();
  return target.transaction(async client => {
    let inserted = 0, existing = 0;
    for (const row of records) {
      const found = (await client.query('SELECT owner_token_hash, created_at FROM devices WHERE device_id = $1', [row.device_id])).rows[0];
      if (found) {
        if (found.owner_token_hash !== row.owner_token_hash || String(found.created_at) !== String(row.created_at)) throw new Error('Conflicting identity; migration rolled back.');
        existing++; continue;
      }
      await client.query('INSERT INTO devices (device_id, owner_token_hash, created_at) VALUES ($1, $2, $3)', [row.device_id, row.owner_token_hash, row.created_at]);
      inserted++;
    }
    return { read: records.length, inserted, existing, dryRun: false };
  });
}
