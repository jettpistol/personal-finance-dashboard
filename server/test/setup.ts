import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Runs before each test file is loaded, so src/config.ts picks this folder up. One folder per file:
// profiles.test.ts empties its own at the start, which must never be another file's.
const dir = path.join(os.tmpdir(), `pfd-test-${crypto.randomUUID()}`);
process.env.DATA_DIR = dir;

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
