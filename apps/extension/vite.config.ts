import { defineConfig, loadEnv } from 'vite';
import { buildSettings, validateStoreSettings } from './build-settings.mjs';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const defaults = buildSettings(loadEnv(mode, resolve(import.meta.dirname, '../..'), 'VITE_'));
  if (process.env.GHOSTPAIR_STORE_BUILD === '1') validateStoreSettings(defaults);
  return {
    define: { 'import.meta.env.VITE_SIGNALING_URL': JSON.stringify(defaults.signalingUrl), 'import.meta.env.VITE_STUN_URLS': JSON.stringify(defaults.stunUrls.join(',')) },
    envDir: resolve(import.meta.dirname, '../..'),
    plugins: [react(), { name: 'ghostpair-build-defaults', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-defaults.json', source: JSON.stringify(defaults, null, 2) }); } }],
    base: './',
    build: {
      target: 'chrome125',
      outDir: '../../dist/extension',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: {
          popup: resolve(import.meta.dirname, 'popup.html'),
          viewer: resolve(import.meta.dirname, 'viewer.html'),
          offscreen: resolve(import.meta.dirname, 'offscreen.html'),
          background: resolve(import.meta.dirname, 'src/background.ts'),
        },
        output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
      },
    },
  };
});
