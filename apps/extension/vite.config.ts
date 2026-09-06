import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
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
});
