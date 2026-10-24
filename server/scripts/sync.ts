// One-off backfill: npm run sync -- [--since 2026-01-01] [--until 2026-10-24]
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createMpApi } from '../src/mp/api.js';
import { syncPayments } from '../src/mp/payments.js';

const { values } = parseArgs({ options: { since: { type: 'string' }, until: { type: 'string' } } });
const config = loadConfig();
const db = openDb(config.databasePath);
const result = await syncPayments(db, createMpApi(config.mpAccessToken), {
  since: values.since ? new Date(values.since) : undefined,
  until: values.until ? new Date(values.until) : undefined,
});
console.log(JSON.stringify(result, null, 2));
