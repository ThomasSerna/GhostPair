import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

/** Resolve independently of npm's workspace working directory. Existing environment wins. */
export function loadRootEnvironment(path = fileURLToPath(new URL('../../../.env', import.meta.url))): void {
  try { loadEnvFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
