import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadRootEnvironment } from './environment.js';

afterEach(() => { delete process.env.GHOSTPAIR_ENV_TEST; });
it('loads an explicit file, preserves injected values and tolerates an absent file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ghostpair-env-'));
  try {
    const path = join(directory, '.env');
    writeFileSync(path, 'GHOSTPAIR_ENV_TEST=from-file\n');
    loadRootEnvironment(path);
    expect(process.env.GHOSTPAIR_ENV_TEST).toBe('from-file');
    process.env.GHOSTPAIR_ENV_TEST = 'injected';
    loadRootEnvironment(path);
    expect(process.env.GHOSTPAIR_ENV_TEST).toBe('injected');
    expect(() => loadRootEnvironment(join(directory, 'absent'))).not.toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
