import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { DISABLE_SCHEDULER: 'true', TELEGRAM_BOT_TOKEN: '', DATA_DIR: path.join(os.tmpdir(), `pfd-test-${process.pid}`) },
  },
});
