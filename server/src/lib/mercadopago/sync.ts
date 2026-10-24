import { db } from '../../db/index.js';
import { addDays, today } from '../dates.js';
import { httpStatusOf, mpClientFor, type MpClient } from './client.js';
import { allConnections, connectionById, ingestMovement, ingestPayment, type Connection } from './ingest.js';
import { DEFAULT_REPORT_CONFIG, parseSettlementReport } from './report.js';
import { decryptSecret } from './secrets.js';

export const clientFor = (conn: Connection): MpClient => mpClientFor(decryptSecret(conn.access_token_enc));

const message = (e: unknown) => {
  const status = httpStatusOf(e);
  const base = e instanceof Error ? e.message : String(e);
  if (status === 401) return 'Mercado Pago rechazó el access token (401). Volvé a cargarlo.';
  if (status === 403) return `Mercado Pago no permite esta consulta con este token (403). ${base}`;
  return base.slice(0, 500);
};

export type SyncResult = { scanned: number; inserted: number; updated: number; stale: number; ignored: number };

/**
 * Pulls payments updated since the last run via /v1/payments/search: once as collector (money in, the
 * default search) and once filtered by payer.id (money out). The first run starts at the connection's sync_from.
 */
export async function syncPayments(conn: Connection, client = clientFor(conn)): Promise<SyncResult> {
  const until = new Date();
  const since = conn.sync_cursor ? new Date(Date.parse(conn.sync_cursor) - 3600_000) : new Date(`${addDays(conn.sync_from, -1)}T00:00:00.000Z`);
  const base = {
    range: 'date_last_updated' as const,
    begin_date: since.toISOString(),
    end_date: until.toISOString(),
    sort: 'date_last_updated' as const,
    criteria: 'asc' as const,
    limit: 100,
  };
  const result: SyncResult = { scanned: 0, inserted: 0, updated: 0, stale: 0, ignored: 0 };
  const seen = new Set<string>();
  try {
    for (const options of [base, { ...base, 'payer.id': conn.mp_user_id }]) {
      for await (const p of client.searchPayments(options)) {
        const id = String((p as { id?: unknown }).id);
        if (seen.has(id)) continue;
        seen.add(id);
        result.scanned++;
        const outcome = ingestPayment(conn, p);
        result[outcome ?? 'ignored']++;
      }
    }
    db().prepare(`UPDATE mp_connections SET sync_cursor = ?, last_sync_at = datetime('now'), last_sync_error = NULL WHERE id = ?`).run(base.end_date, conn.id);
  } catch (e) {
    db().prepare(`UPDATE mp_connections SET last_sync_at = datetime('now'), last_sync_error = ? WHERE id = ?`).run(message(e), conn.id);
    throw e;
  }
  return result;
}

export async function refreshBalance(conn: Connection, client = clientFor(conn)) {
  try {
    const balance = await client.getBalance(conn.mp_user_id);
    db().prepare(`UPDATE mp_connections SET balance_json = ?, balance_at = datetime('now'), balance_error = NULL WHERE id = ?`).run(JSON.stringify(balance), conn.id);
  } catch (e) {
    db().prepare('UPDATE mp_connections SET balance_error = ? WHERE id = ?').run(message(e), conn.id);
  }
}

type ReportState = { configured?: boolean; requested_until?: string; requested_at?: string };

function listFileNames(list: unknown): string[] {
  const items = Array.isArray(list) ? list : Array.isArray((list as { results?: unknown })?.results) ? (list as { results: unknown[] }).results : [];
  return items
    .map((it) => (it as { file_name?: unknown })?.file_name)
    .filter((f): f is string => typeof f === 'string' && /\.csv$/i.test(f));
}

/**
 * Once a day: make sure the account has a report config, ask for a report covering everything up to
 * yesterday, and import any report file not seen before. Reports are generated asynchronously, so a file
 * requested today is normally picked up on a later run.
 */
export async function reportCycle(conn: Connection, client = clientFor(conn), opts: { force?: boolean } = {}) {
  const state: ReportState = conn.report_state ? JSON.parse(conn.report_state) : {};
  const save = (error: string | null) =>
    db().prepare('UPDATE mp_connections SET report_state = ?, report_error = ? WHERE id = ?').run(JSON.stringify(state), error, conn.id);
  try {
    if (!state.configured) {
      try {
        await client.settlementReport.getConfig();
      } catch (e) {
        if (httpStatusOf(e) !== 404) throw e;
        await client.settlementReport.createConfig(DEFAULT_REPORT_CONFIG);
      }
      state.configured = true;
    }

    const yesterday = addDays(today(), -1);
    if (opts.force || !state.requested_at || state.requested_at < today()) {
      const begin = state.requested_until ? addDays(state.requested_until, 1) : conn.sync_from;
      if (begin <= yesterday) {
        await client.settlementReport.create({ begin_date: `${begin}T00:00:00Z`, end_date: `${yesterday}T23:59:59Z` });
        state.requested_until = yesterday;
      }
      state.requested_at = today();
    }

    let error: string | null = null;
    const seen = db().prepare('SELECT 1 FROM mp_report_files WHERE connection_id = ? AND file_name = ?');
    for (const fileName of listFileNames(await client.settlementReport.list())) {
      if (seen.get(conn.id, fileName)) continue;
      const parsed = parseSettlementReport(await client.settlementReport.download(fileName));
      const fresh = connectionById(conn.id) ?? conn;
      for (const mv of parsed.movements) ingestMovement(fresh, mv);
      if (parsed.unreadable) error = `${fileName}: ${parsed.unreadable}`;
      db().prepare('INSERT INTO mp_report_files (connection_id, file_name, lines, error) VALUES (?, ?, ?, ?)').run(conn.id, fileName, parsed.movements.length, parsed.unreadable);
    }
    save(error);
  } catch (e) {
    save(message(e));
  }
}

// ---- Webhook events: stored by the route, processed here ----

type EventRow = { dedupe_key: string; connection_id: number; type: string | null; data_id: string | null; attempts: number };
const MAX_ATTEMPTS = 5;

async function processEvent(ev: EventRow) {
  const finish = (status: 'processed' | 'ignored' | 'failed' | 'pending', error: string | null) => {
    const next = status === 'pending' ? new Date(Date.now() + 30_000 * 2 ** ev.attempts).toISOString() : null;
    db()
      .prepare(
        `UPDATE mp_webhook_events SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ?,
         processed_at = CASE WHEN ? IN ('processed', 'ignored') THEN datetime('now') ELSE processed_at END WHERE dedupe_key = ?`,
      )
      .run(status, error, next, status, ev.dedupe_key);
  };
  const conn = connectionById(ev.connection_id);
  if (!conn) return finish('ignored', 'conexión eliminada');
  if (ev.type !== 'payment' || !ev.data_id) return finish('ignored', `tipo ${ev.type} no usado`);
  try {
    // The notification only says "this payment changed"; its current state comes from the API.
    ingestPayment(conn, await clientFor(conn).getPayment(ev.data_id));
    finish('processed', null);
  } catch (e) {
    if (httpStatusOf(e) === 404) return finish('ignored', 'pago no encontrado (404), p. ej. una notificación simulada');
    finish(ev.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending', message(e));
  }
}

let draining: { again: boolean; promise?: Promise<void> } | null = null;

/** Processes due webhook events. A call during a running drain makes it do one more pass. */
export function drainWebhookEvents(): Promise<void> {
  if (draining) {
    draining.again = true;
    return draining.promise!;
  }
  const state: { again: boolean; promise?: Promise<void> } = { again: true };
  draining = state;
  state.promise = (async () => {
    try {
      while (state.again) {
        state.again = false;
        const rows = db()
          .prepare(
            `SELECT dedupe_key, connection_id, type, data_id, attempts FROM mp_webhook_events
             WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY received_at LIMIT 100`,
          )
          .all(new Date().toISOString()) as EventRow[];
        for (const row of rows) await processEvent(row);
      }
    } finally {
      draining = null;
    }
  })();
  return state.promise;
}

/** Scheduler step: webhook retries, then payments, balance and the daily report for every connection. */
export async function mercadoPagoTick() {
  await drainWebhookEvents();
  for (const conn of allConnections()) {
    try {
      await syncPayments(conn);
    } catch (e) {
      console.error(`[mercadopago] sync of connection ${conn.id} failed:`, message(e));
    }
    await refreshBalance(conn);
    await reportCycle(connectionById(conn.id) ?? conn);
  }
}
