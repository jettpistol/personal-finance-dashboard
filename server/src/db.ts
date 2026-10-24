// SQLite storage using Node's built-in node:sqlite (Node >= 22.13, no native dependency).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mp_payments (
  id                 TEXT PRIMARY KEY,           -- Mercado Pago payment id
  direction          TEXT NOT NULL,              -- 'in' (we are collector) | 'out' (we are payer) | 'unknown'
  status             TEXT,
  status_detail      TEXT,
  operation_type     TEXT,
  payment_type_id    TEXT,
  payment_method_id  TEXT,
  description        TEXT,
  currency_id        TEXT,
  transaction_amount REAL,
  net_received_amount REAL,
  fee_amount         REAL,
  collector_id       TEXT,
  payer_id           TEXT,
  payer_email        TEXT,
  external_reference TEXT,
  live_mode          INTEGER,
  date_created       TEXT,
  date_approved      TEXT,
  date_last_updated  TEXT,
  money_release_date TEXT,
  raw_json           TEXT NOT NULL,              -- full API payload, kept for audit/re-derivation
  source             TEXT NOT NULL,              -- 'webhook' | 'sync'
  ingested_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mp_payments_date_created ON mp_payments(date_created);
CREATE INDEX IF NOT EXISTS mp_payments_date_last_updated ON mp_payments(date_last_updated);

-- One row per accepted webhook delivery. dedupe_key makes re-deliveries idempotent.
CREATE TABLE IF NOT EXISTS mp_webhook_events (
  dedupe_key     TEXT PRIMARY KEY,
  notification_id TEXT,
  request_id     TEXT,
  type           TEXT,
  action         TEXT,
  data_id        TEXT,
  live_mode      INTEGER,
  body_json      TEXT NOT NULL,
  status         TEXT NOT NULL,                -- 'pending' | 'processed' | 'ignored' | 'failed'
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  next_attempt_at TEXT,                        -- backoff for transient processing failures
  received_at    TEXT NOT NULL,
  processed_at   TEXT,
  deliveries     INTEGER NOT NULL DEFAULT 1    -- how many times Mercado Pago delivered this event
);
CREATE INDEX IF NOT EXISTS mp_webhook_events_status ON mp_webhook_events(status);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function getKv(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setKv(db: Db, key: string, value: string) {
  db.prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
