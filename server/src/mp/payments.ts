// Payment normalisation, idempotent persistence and backfill/reconcile sync.
import type { Db } from '../db.js';
import { getKv, setKv } from '../db.js';
import { log } from '../lib/logger.js';
import type { MpApi, MpPayment } from './api.js';

export type PaymentRow = {
  id: string;
  direction: 'in' | 'out' | 'unknown';
  status: string | null;
  status_detail: string | null;
  operation_type: string | null;
  payment_type_id: string | null;
  payment_method_id: string | null;
  description: string | null;
  currency_id: string | null;
  transaction_amount: number | null;
  net_received_amount: number | null;
  fee_amount: number | null;
  collector_id: string | null;
  payer_id: string | null;
  payer_email: string | null;
  external_reference: string | null;
  live_mode: number | null;
  date_created: string | null;
  date_approved: string | null;
  date_last_updated: string | null;
  money_release_date: string | null;
};

const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Maps a /v1/payments/{id} or /v1/payments/search item to a flat row. Fields follow the payment resource in the API reference. */
export function toPaymentRow(p: MpPayment, ownUserId: string | undefined): PaymentRow {
  const anyP = p as Record<string, any>;
  const collectorId = str(anyP.collector_id ?? anyP.collector?.id);
  const payerId = str(anyP.payer?.id);
  let direction: PaymentRow['direction'] = 'unknown';
  if (ownUserId && collectorId === ownUserId) direction = 'in';
  else if (ownUserId && payerId === ownUserId) direction = 'out';

  const feeDetails: Array<{ amount?: number }> | undefined = anyP.fee_details;
  const fee = Array.isArray(feeDetails) && feeDetails.length > 0
    ? feeDetails.reduce((sum, f) => sum + (num(f.amount) ?? 0), 0)
    : null;

  return {
    id: String(anyP.id),
    direction,
    status: str(anyP.status),
    status_detail: str(anyP.status_detail),
    operation_type: str(anyP.operation_type),
    payment_type_id: str(anyP.payment_type_id),
    payment_method_id: str(anyP.payment_method_id),
    description: str(anyP.description),
    currency_id: str(anyP.currency_id),
    transaction_amount: num(anyP.transaction_amount),
    net_received_amount: num(anyP.transaction_details?.net_received_amount),
    fee_amount: fee,
    collector_id: collectorId,
    payer_id: payerId,
    payer_email: str(anyP.payer?.email),
    external_reference: str(anyP.external_reference),
    live_mode: typeof anyP.live_mode === 'boolean' ? Number(anyP.live_mode) : null,
    date_created: str(anyP.date_created),
    date_approved: str(anyP.date_approved),
    date_last_updated: str(anyP.date_last_updated),
    money_release_date: str(anyP.money_release_date),
  };
}

/**
 * Inserts or updates a payment. Idempotent and order-safe: an update is applied only when the incoming
 * date_last_updated is not older than the stored one, so a late/duplicate notification cannot roll a
 * payment back to a previous status.
 * Returns 'inserted' | 'updated' | 'stale'.
 */
export function upsertPayment(db: Db, p: MpPayment, ownUserId: string | undefined, source: 'webhook' | 'sync') {
  const row = toPaymentRow(p, ownUserId);
  const existing = db.prepare('SELECT date_last_updated FROM mp_payments WHERE id = ?').get(row.id) as
    | { date_last_updated: string | null }
    | undefined;

  if (existing && existing.date_last_updated && row.date_last_updated &&
      Date.parse(row.date_last_updated) < Date.parse(existing.date_last_updated)) {
    return 'stale' as const;
  }

  const cols = Object.keys(row) as (keyof PaymentRow)[];
  const all = [...cols, 'raw_json', 'source', 'ingested_at'];
  const values = [...cols.map((c) => row[c]), JSON.stringify(p), source, new Date().toISOString()];
  db.prepare(
    `INSERT INTO mp_payments (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${all.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
  ).run(...(values as (string | number | null)[]));
  return existing ? ('updated' as const) : ('inserted' as const);
}

/** Caches /users/me so direction can be derived without a call per payment. */
export async function getOwnUserId(db: Db, api: MpApi): Promise<string> {
  const cached = getKv(db, 'mp_user_id');
  if (cached) return cached;
  const me = await api.getMe();
  const id = String(me.id);
  setKv(db, 'mp_user_id', id);
  if (me.site_id) setKv(db, 'mp_site_id', me.site_id);
  return id;
}

export type SyncResult = { scanned: number; inserted: number; updated: number; stale: number; since: string; until: string };

/**
 * Pulls payments whose date_last_updated falls in [since, until] via /v1/payments/search.
 *
 * Two passes: the default search (payments where this account is the collector, i.e. money in) and a
 * `payer.id` filtered search (money out). GAP: the reference documents the search filters generically;
 * whether every wallet movement (QR payments, transfers, bill payments, card spend) is returned as a
 * payment must be verified against the real account. The Account money report is the complete ledger.
 */
export async function syncPayments(db: Db, api: MpApi, opts: { since?: Date; until?: Date } = {}): Promise<SyncResult> {
  const userId = await getOwnUserId(db, api);
  const until = opts.until ?? new Date();
  const lastCursor = getKv(db, 'mp_sync_cursor');
  // Default window: from last cursor minus 1h overlap (late updates), else the last 90 days.
  const since = opts.since ?? (lastCursor ? new Date(Date.parse(lastCursor) - 3600_000) : new Date(until.getTime() - 90 * 86400_000));

  const base = {
    range: 'date_last_updated' as const,
    begin_date: since.toISOString(),
    end_date: until.toISOString(),
    sort: 'date_last_updated' as const,
    criteria: 'asc' as const,
    limit: 100,
  };

  const result: SyncResult = { scanned: 0, inserted: 0, updated: 0, stale: 0, since: base.begin_date, until: base.end_date };
  const seen = new Set<string>();
  for (const options of [base, { ...base, 'payer.id': userId }]) {
    for await (const p of api.searchPayments(options)) {
      const id = String(p.id);
      if (seen.has(id)) continue;
      seen.add(id);
      result.scanned++;
      result[upsertPayment(db, p, userId, 'sync')]++;
    }
  }

  if (!opts.since) setKv(db, 'mp_sync_cursor', base.end_date);
  log.info('mp.sync.done', result);
  return result;
}
