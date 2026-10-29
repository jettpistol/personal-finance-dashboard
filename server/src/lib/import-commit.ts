import { z } from 'zod';
import { db } from '../db/index.js';
import { getTx, loadAccounts, type Account } from './domain.js';
import { addFees, feesSchema } from './fees.js';
import { loadConverter } from './fx.js';
import { insertTx, normaliseTx } from './transactions.js';

// Saving the reviewed rows of an import (Importar, Resúmenes, Mercado Pago), all in one place.

export const commitRowSchema = z.object({
  date: z.string(),
  description: z.string().max(300),
  amount: z.number().int().positive(),
  direction: z.enum(['out', 'in']),
  type: z.enum(['expense', 'income', 'transfer']),
  category_id: z.number().int().nullish(),
  merchant: z.string().nullish(),
  notes: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  to_account_id: z.number().int().nullish(),
  is_shared: z.boolean().default(false),
  import_hash: z.string(),
  // From a platform sync: its own id for the movement (never imported twice) and its fees.
  external_id: z.string().max(120).nullish(),
  fees: feesSchema.optional(),
  // A movement typed by hand that this row completes instead of adding a new one.
  merge_with: z.number().int().nullish(),
});
export type CommitRow = z.infer<typeof commitRowSchema>;

export type CommitResult = { batch_id: number; imported: number; merged: number; failures: { description: string; error: string; external_id?: string | null }[]; created: number[]; touched: number[] };

/**
 * A hand-typed movement this row can complete: same account, same amount and direction, at most a
 * day apart, not imported from anywhere. The closest date wins; ids already taken are skipped.
 */
export function mergeCandidate(account: Account, date: string, signed: number, taken: Set<number>): { id: number; description: string; date: string; category_id: number | null } | null {
  const type = signed < 0 ? 'expense' : 'income';
  const rows = db()
    .prepare(
      `SELECT id, description, date, category_id FROM transactions
       WHERE account_id = ? AND amount = ? AND type = ? AND external_id IS NULL AND import_batch_id IS NULL AND status = 'confirmed'
         AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day')
       ORDER BY abs(julianday(date) - julianday(?)), id`,
    )
    .all(account.id, Math.abs(signed), type, date, date, date) as { id: number; description: string; date: string; category_id: number | null }[];
  return rows.find((r) => !taken.has(r.id)) ?? null;
}

/**
 * Saves the rows into `account` as one import batch (undone from Importar → Historial). Must run
 * inside a database transaction. A row with `merge_with` completes that movement (date, store,
 * external id and fees) and keeps its description, category, notes and links.
 */
export function commitImportRows(account: Account, rows: CommitRow[], viewer: number, batch: { file_name: string; preset_id?: number | null }): CommitResult {
  const accounts = loadAccounts();
  const fx = loadConverter();
  const batchId = Number(
    db().prepare('INSERT INTO import_batches (file_name, preset_id, account_id, created_by) VALUES (?, ?, ?, ?)').run(batch.file_name, batch.preset_id ?? null, account.id, viewer)
      .lastInsertRowid,
  );
  const created: number[] = [];
  const touched: number[] = [];
  const failures: CommitResult['failures'] = [];
  const known = db().prepare('SELECT 1 FROM transactions WHERE external_id = ? LIMIT 1');
  const setExternal = db().prepare('UPDATE transactions SET external_id = ? WHERE id = ?');
  let merged = 0;
  for (const r of rows) {
    try {
      if (r.external_id && known.get(r.external_id)) continue;
      if (r.merge_with != null) {
        const own = getTx(r.merge_with);
        if (own && own.account_id === account.id && own.amount === r.amount && !own.external_id && !own.import_batch_id) {
          db()
            .prepare(`UPDATE transactions SET date = ?, merchant = COALESCE(merchant, ?), external_id = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(r.date, r.merchant ?? null, r.external_id ?? null, own.id);
          if (r.fees?.length) addFees(own.id, r.fees);
          touched.push(own.id);
          merged++;
          continue;
        }
        // The hand-typed movement changed or went away since the review: add this one instead.
      }
      // The row amount is always in this account's currency.
      let from = account.id;
      let to: number | null = null;
      let amount = r.amount;
      let toAmount: number | null = null;
      if (r.type === 'transfer') {
        if (r.to_account_id == null) throw new Error('Falta la cuenta destino de la transferencia');
        const other = accounts.get(r.to_account_id);
        if (!other) throw new Error('Cuenta destino inválida');
        const converted = other.currency === account.currency ? r.amount : fx.convert(r.amount, account.currency, other.currency, r.date);
        if (!converted) throw new Error('No hay cotización para convertir la transferencia');
        if (r.direction === 'out') {
          to = other.id;
          if (other.currency !== account.currency) toAmount = converted;
        } else {
          // Money coming in is a transfer from the other account into this one.
          from = other.id;
          to = account.id;
          amount = converted;
          if (other.currency !== account.currency) toAmount = r.amount;
        }
      }
      const tx = normaliseTx(
        {
          type: r.type,
          date: r.date,
          amount,
          account_id: from,
          to_account_id: to,
          to_amount: toAmount,
          category_id: r.category_id ?? null,
          description: r.description,
          merchant: r.merchant ?? null,
          notes: r.notes ?? null,
          tags: r.tags,
          is_shared: r.is_shared,
          is_private: false,
        },
        viewer,
      );
      const id = insertTx({ ...tx, import_batch_id: batchId, import_hash: r.import_hash });
      if (r.external_id) setExternal.run(r.external_id, id);
      if (r.fees?.length) addFees(id, r.fees);
      created.push(id);
    } catch (e) {
      failures.push({ description: r.description, error: (e as Error).message, external_id: r.external_id ?? null });
    }
  }
  db().prepare('UPDATE import_batches SET row_count = ? WHERE id = ?').run(created.length, batchId);
  return { batch_id: batchId, imported: created.length, merged, failures, created, touched };
}
