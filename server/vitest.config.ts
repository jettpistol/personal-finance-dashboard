import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { DISABLE_SCHEDULER: 'true', TELEGRAM_BOT_TOKEN: '' },
    // Gives every test file its own DATA_DIR (files run in parallel, and some wipe theirs).
    setupFiles: ['./test/setup.ts'],
  },
});
