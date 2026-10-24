import { db } from '../../db/index.js';
import { today } from '../dates.js';
import { loadAccounts, loadCategories, type Account } from '../domain.js';
import { loadConverter } from '../fx.js';
import { applyRules, loadRules } from '../rules.js';
import { insertTx, normaliseStatementRow, type StatementRow } from '../transactions.js';
import type { MpPayment } from './client.js';

export type Connection = {
  id: number;
  user_id: number;
  account_id: number;
  mp_user_id: string;
  nickname: string | null;
  site_id: string | null;
  test_credentials: number;
  access_token_enc: string;
  webhook_secret_enc: string | null;
  webhook_key: string;
  sync_from: string;
  sync_cursor: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  balance_json: string | null;
  balance_at: string | null;
  balance_error: string | null;
  report_state: string | null;
  report_error: string | null;
};

export type MovementInput = {
  source: 'payment' | 'report';
  external_id: string;
  status: string | null;
  payment_type: string | null;
  payment_ref?: string | null;
  description: string;
  /** Signed cents: positive = money into the account, negative = money out. */
  amount: number;
  /** Cents charged to this account on top of / out of the amount. */
  fee: number;
  currency: string | null;
  date: string;
  date_last_updated: string | null;
  raw: unknown;
};

type MovementRow = {
  id: number;
  source: 'payment' | 'report';
  external_id: string;
  status: string | null;
  payment_type: string | null;
  payment_ref: string | null;
  description: string;
  amount: number;
  fee: number;
  currency: string | null;
  date: string;
  date_last_updated: string | null;
  tx_state: 'none' | 'created' | 'matched' | 'reversed' | 'skipped' | 'error';
  transaction_id: number | null;
  fee_transaction_id: number | null;
};

export const connectionById = (id: number) => db().prepare('SELECT * FROM mp_connections WHERE id = ?').get(id) as Connection | undefined;
export const connectionForUser = (userId: number) => db().prepare('SELECT * FROM mp_connections WHERE user_id = ?').get(userId) as Connection | undefined;
export const allConnections = () => db().prepare('SELECT * FROM mp_connections ORDER BY id').all() as Connection[];

const cents = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : 0);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Payment statuses after which the money did not (or no longer) move. */
const REVERSED = new Set(['refunded', 'cancelled', 'charged_back', 'rejected']);

/**
 * Maps a payment to a movement of this connection's account, or null when the account is neither the
 * collector (money in) nor the payer (money out). Field names follow the payment resource in the API reference.
 */
export function paymentToMovement(p: MpPayment, conn: Pick<Connection, 'mp_user_id'>): MovementInput | null {
  const r = p as Record<string, any>;
  const collector = String(r.collector_id ?? r.collector?.id ?? '');
  const payer = String(r.payer?.id ?? '');
  const direction = collector === conn.mp_user_id ? 'in' : payer === conn.mp_user_id ? 'out' : null;
  if (!direction) return null;

  const gross = cents(r.transaction_amount);
  // Fees are charged to whoever fee_payer names; without it, Mercado Pago's own fee falls on the collector.
  const role = direction === 'in' ? 'collector' : 'payer';
  const fee = Array.isArray(r.fee_details)
    ? r.fee_details.filter((f: any) => (f?.fee_payer ?? 'collector') === role).reduce((sum: number, f: any) => sum + cents(f?.amount), 0)
    : 0;
  const when = text(r.date_approved) ?? text(r.date_created) ?? new Date().toISOString();
  const counterpart = direction === 'in' ? text(r.payer?.email) : null;
  const description =
    text(r.description) ?? text(r.statement_descriptor) ?? (direction === 'in' ? `Cobro Mercado Pago${counterpart ? ` de ${counterpart}` : ''}` : 'Pago con Mercado Pago');

  return {
    source: 'payment',
    external_id: String(r.id),
    status: text(r.status),
    payment_type: text(r.payment_type_id),
    description,
    amount: direction === 'in' ? gross : -gross,
    fee,
    currency: text(r.currency_id),
    date: today(new Date(when)),
    date_last_updated: text(r.date_last_updated),
    raw: p,
  };
}

/** Today's import batch for this connection, so Importar > Deshacer removes what Mercado Pago added. */
function batchFor(conn: Connection): number {
  const name = `Mercado Pago${conn.nickname ? ` (${conn.nickname})` : ''} ${today()}`;
  const row = db().prepare('SELECT id FROM import_batches WHERE file_name = ? AND account_id = ? ORDER BY id DESC LIMIT 1').get(name, conn.account_id) as
    | { id: number }
    | undefined;
  if (row) return row.id;
  return Number(
    db().prepare('INSERT INTO import_batches (file_name, account_id, created_by) VALUES (?, ?, ?)').run(name, conn.account_id, conn.user_id).lastInsertRowid,
  );
}

function feeCategoryId(): number | null {
  const row = db().prepare(`SELECT id FROM categories WHERE name = 'Comisiones bancarias' AND kind = 'expense' AND archived = 0 LIMIT 1`).get() as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

function setState(id: number, state: MovementRow['tx_state'], fields: { transaction_id?: number | null; fee_transaction_id?: number | null; note?: string | null } = {}) {
  db()
    .prepare(
      `UPDATE mp_movements SET tx_state = ?, transaction_id = COALESCE(?, transaction_id), fee_transaction_id = COALESCE(?, fee_transaction_id),
       note = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .run(state, fields.transaction_id ?? null, fields.fee_transaction_id ?? null, fields.note ?? null, id);
}

/** Creates the app transaction(s) for a movement, or links it to one that is already there. */
function createTransaction(conn: Connection, mv: MovementRow, account: Account, accounts: Map<number, Account>, opts: { pending: boolean; note: string | null }) {
  if (mv.currency && mv.currency !== account.currency) {
    return setState(mv.id, 'skipped', { note: `Moneda ${mv.currency} distinta de la cuenta (${account.currency}).` });
  }
  const abs = Math.abs(mv.amount);
  // Already in the app (manual entry or a CSV import of the same statement): link instead of duplicating.
  const existing = db()
    .prepare(
      `SELECT t.id FROM transactions t
       WHERE t.amount = ? AND t.date = ? AND (t.account_id = ? OR t.to_account_id = ?)
         AND (t.import_hash IS NULL OR t.import_hash NOT LIKE 'mp:%')
         AND NOT EXISTS (SELECT 1 FROM mp_movements m WHERE m.transaction_id = t.id)
       LIMIT 1`,
    )
    .get(abs, mv.date, account.id, account.id) as { id: number } | undefined;
  if (existing) return setState(mv.id, 'matched', { transaction_id: existing.id, note: 'Ya estaba cargado en la app.' });

  const direction = mv.amount < 0 ? 'out' : 'in';
  const patch = applyRules(loadRules(), { description: mv.description, amount: mv.amount, account_id: account.id });
  const type = patch?.type ?? (direction === 'out' ? 'expense' : 'income');
  const kinds = loadCategories();
  const categoryId = patch?.category_id != null && kinds.get(patch.category_id)?.kind === type ? patch.category_id : null;
  const fx = loadConverter();
  const status = opts.pending ? 'pending' : 'confirmed';
  const row: StatementRow = {
    type,
    direction,
    status,
    date: mv.date,
    amount: abs,
    to_account_id: patch?.to_account_id ?? null,
    category_id: categoryId,
    description: mv.description,
    merchant: patch?.merchant ?? null,
    notes: opts.note,
    tags: patch?.tags ?? [],
    is_shared: patch?.is_shared ?? false,
  };
  const batch = batchFor(conn);
  const hash = `mp:${conn.id}:${mv.source}:${mv.external_id}`;
  const txId = insertTx({ ...normaliseStatementRow(account, row, accounts, fx, conn.user_id), import_batch_id: batch, import_hash: hash });

  let feeTxId: number | null = null;
  if (mv.fee > 0) {
    const feeRow: StatementRow = {
      type: 'expense',
      direction: 'out',
      status,
      date: mv.date,
      amount: mv.fee,
      category_id: feeCategoryId(),
      description: `Comisión Mercado Pago: ${mv.description}`.slice(0, 300),
      tags: [],
      is_shared: false,
    };
    feeTxId = insertTx({ ...normaliseStatementRow(account, feeRow, accounts, fx, conn.user_id), import_batch_id: batch, import_hash: `${hash}:fee` });
  }
  db().prepare('UPDATE import_batches SET row_count = row_count + ? WHERE id = ?').run(feeTxId ? 2 : 1, batch);
  const note = [patch ? `Regla: ${patch.rule_name}.` : null, opts.pending ? 'Queda pendiente: confirmalo en Movimientos.' : null].filter(Boolean).join(' ');
  setState(mv.id, 'created', { transaction_id: txId, fee_transaction_id: feeTxId, note: note || null });
}

function reverse(mv: MovementRow, status: string) {
  // Only what Mercado Pago itself added is removed; matched or user-created transactions are left alone.
  const del = db().prepare(`DELETE FROM transactions WHERE id = ? AND import_hash LIKE 'mp:%'`);
  if (mv.transaction_id) del.run(mv.transaction_id);
  if (mv.fee_transaction_id) del.run(mv.fee_transaction_id);
  setState(mv.id, 'reversed', { note: `Mercado Pago lo marcó como ${status}.` });
}

/** Decides what a movement means for the app's transactions, given its current status. */
function reconcile(conn: Connection, mv: MovementRow) {
  const accounts = loadAccounts();
  const account = accounts.get(conn.account_id);
  if (!account) return setState(mv.id, 'error', { note: 'La cuenta vinculada ya no existe.' });

  if (mv.date < conn.sync_from) {
    if (mv.tx_state === 'none') setState(mv.id, 'skipped', { note: `Anterior a la fecha de inicio (${conn.sync_from}).` });
    return;
  }

  if (mv.source === 'report') {
    if (mv.tx_state !== 'none' && mv.tx_state !== 'error') return;
    if (mv.amount === 0) return setState(mv.id, 'skipped', { note: 'Monto cero.' });
    const payment = db()
      .prepare(`SELECT 1 FROM mp_movements WHERE connection_id = ? AND source = 'payment' AND external_id = ?`)
      .get(conn.id, mv.payment_ref ?? '');
    if (payment) return setState(mv.id, 'matched', { note: 'Ya registrado por el pago correspondiente.' });
    // Report columns are not verified against a real file yet, so these wait for a person to confirm.
    return createTransaction(conn, mv, account, accounts, { pending: true, note: 'Del reporte de dinero en cuenta de Mercado Pago. Revisá y confirmá.' });
  }

  const status = mv.status ?? '';
  if (REVERSED.has(status)) {
    if (mv.tx_state === 'created') reverse(mv, status);
    else if (mv.tx_state === 'matched') setState(mv.id, 'matched', { note: `Mercado Pago lo marcó como ${status}: revisá el movimiento.` });
    else if (mv.tx_state === 'none') setState(mv.id, 'skipped', { note: `Estado ${status}.` });
    return;
  }
  if (status !== 'approved' && status !== 'partially_refunded') return; // pending, in_process, authorized: wait
  if (mv.tx_state !== 'none' && mv.tx_state !== 'error') {
    if (status === 'partially_refunded' && mv.tx_state === 'created') {
      setState(mv.id, 'created', { note: 'Tiene un reintegro parcial: ajustá el monto a mano.' });
    }
    return;
  }

  // Paying through Mercado Pago with a card does not touch the wallet balance.
  const cardFunded = mv.amount < 0 && mv.payment_type != null && mv.payment_type !== 'account_money';
  try {
    createTransaction(conn, mv, account, accounts, {
      pending: cardFunded,
      note: cardFunded ? `Pagado con ${mv.payment_type} desde Mercado Pago: pasalo a la cuenta de la tarjeta antes de confirmar.` : null,
    });
  } catch (e) {
    setState(mv.id, 'error', { note: (e as Error).message });
  }
}

/**
 * Stores or updates a movement and applies it. Order-safe: an update older than what is stored
 * (by date_last_updated) is ignored, so late or repeated notifications cannot roll a payment back.
 */
export function ingestMovement(conn: Connection, input: MovementInput): 'inserted' | 'updated' | 'stale' {
  return db().transaction(() => {
    const prev = db()
      .prepare('SELECT date_last_updated FROM mp_movements WHERE connection_id = ? AND source = ? AND external_id = ?')
      .get(conn.id, input.source, input.external_id) as { date_last_updated: string | null } | undefined;
    if (prev?.date_last_updated && input.date_last_updated && Date.parse(input.date_last_updated) < Date.parse(prev.date_last_updated)) return 'stale' as const;

    db()
      .prepare(
        `INSERT INTO mp_movements (connection_id, source, external_id, status, payment_type, payment_ref, description, amount, fee, currency, date, date_last_updated, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, source, external_id) DO UPDATE SET
           status = excluded.status, payment_type = excluded.payment_type, payment_ref = excluded.payment_ref, description = excluded.description, amount = excluded.amount,
           fee = excluded.fee, currency = excluded.currency, date = excluded.date, date_last_updated = excluded.date_last_updated,
           raw_json = excluded.raw_json, updated_at = datetime('now')`,
      )
      .run(
        conn.id, input.source, input.external_id, input.status, input.payment_type, input.payment_ref ?? null, input.description.slice(0, 300),
        input.amount, input.fee, input.currency, input.date, input.date_last_updated, JSON.stringify(input.raw),
      );
    const mv = db()
      .prepare('SELECT * FROM mp_movements WHERE connection_id = ? AND source = ? AND external_id = ?')
      .get(conn.id, input.source, input.external_id) as MovementRow;
    reconcile(conn, mv);
    return prev ? ('updated' as const) : ('inserted' as const);
  })();
}

export function ingestPayment(conn: Connection, p: MpPayment) {
  const mv = paymentToMovement(p, conn);
  return mv ? ingestMovement(conn, mv) : null;
}
