import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { buildSettings, validateStoreSettings } from '../apps/extension/build-settings.mjs';

const root = resolve(import.meta.dirname, '..');
const expected = validateStoreSettings(buildSettings(loadEnv('production', root, 'VITE_')));
if (!process.env.npm_execpath) throw new Error('Run through npm run package:store.');
const build = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], { cwd: root, env: { ...process.env, GHOSTPAIR_STORE_BUILD: '1' }, stdio: 'inherit', windowsHide: true });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const actual = validateStoreSettings(JSON.parse(readFileSync(resolve(root, 'dist/extension/build-defaults.json'), 'utf8')));
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Built endpoints do not match the validated production configuration.');
const packaged = spawnSync(process.execPath, ['scripts/package.mjs', '--store'], { cwd: root, stdio: 'inherit', windowsHide: true });
if (packaged.error) throw packaged.error;
process.exitCode = packaged.status ?? 1;
