import {fileURLToPath} from 'node:url';

import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

/** The dashboard talks to `loom start` on port 3000 during development. */
const target = process.env['LOOM_SERVER'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {'@': fileURLToPath(new URL('./src', import.meta.url))},
  },
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/ws': {target: target.replace(/^http/, 'ws'), ws: true},
    },
  },
  build: {outDir: 'dist', emptyOutDir: true},
});
