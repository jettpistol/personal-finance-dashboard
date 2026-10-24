import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// The app version lives in the root package.json and is bumped with every push; the footer shows it.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
