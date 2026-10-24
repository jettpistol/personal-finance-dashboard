import crypto from 'node:crypto';
import { z } from 'zod';
import { db, getSetting } from '../db/index.js';
import { allocate } from './money.js';
import { addMonths, isValidDate } from './dates.js';
import { accountVisible, getTx, loadAccounts, loadCategories, loadUsers, type Account, type Split, type Tx } from './domain.js';
import { HttpError } from './http.js';
import type { Converter } from './fx.js';

const dateStr = z.string().refine(isValidDate, 'Fecha inválida');

export const splitSchema = z.object({
  method: z.enum(['default', 'equal', 'percent', 'exact']),
  // percent: user_id -> percentage; exact: user_id -> cents
  values: z.array(z.object({ user_id: z.number().int(), value: z.number() })).optional(),
});
export type SplitInput = z.infer<typeof splitSchema>;

export const txInputSchema = z.object({
  type: z.enum(['expense', 'income', 'transfer', 'adjustment']),
  status: z.enum(['confirmed', 'pending']).optional(),
  date: dateStr,
  amount: z.number().int(),
  account_id: z.number().int(),
  to_account_id: z.number().int().nullish(),
  to_amount: z.number().int().positive().nullish(),
  category_id: z.number().int().nullish(),
  description: z.string().max(300).default(''),
  merchant: z.string().max(120).nullish(),
  notes: z.string().max(2000).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  is_shared: z.boolean().default(false),
  split: splitSchema.nullish(),
  is_private: z.boolean().default(false),
  is_settlement: z.boolean().nullish(),
});
export type TxInput = z.infer<typeof txInputSchema>;

/** Percentages per user for the household's default split (equal when not configured). */
export function defaultSplitWeights(userIds: number[]): number[] {
  const cfg = getSetting<Record<string, number>>('default_split') ?? {};
  const weights = userIds.map((id) => Number(cfg[String(id)] ?? 0));
  return weights.some((w) => w > 0) ? weights : userIds.map(() => 1);
}

export function computeSplits(total: number, split: SplitInput | null | undefined, userIds: number[]): Split[] {
  const method = split?.method ?? 'default';
  const valueOf = (uid: number) => split?.values?.find((v) => v.user_id === uid)?.value ?? 0;
  let amounts: number[];
  switch (method) {
    case 'default':
      amounts = allocate(total, defaultSplitWeights(userIds));
      break;
    case 'equal':
      amounts = allocate(total, userIds.map(() => 1));
      break;
    case 'percent': {
      const pcts = userIds.map(valueOf);
      if (pcts.some((p) => p < 0)) throw new HttpError(400, 'Los porcentajes no pueden ser negativos.');
      if (Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) > 0.01) throw new HttpError(400, 'Los porcentajes deben sumar 100.');
      amounts = allocate(total, pcts);
      break;
    }
    case 'exact': {
      amounts = userIds.map((u) => Math.round(valueOf(u)));
      if (amounts.some((a) => a < 0)) throw new HttpError(400, 'Los montos no pueden ser negativos.');
      if (amounts.reduce((a, b) => a + b, 0) !== total) throw new HttpError(400, 'Los montos de la división deben sumar el total.');
      break;
    }
  }
  return userIds.map((user_id, i) => ({ user_id, amount: amounts[i] })).filter((s) => s.amount !== 0);
}

type Normalised = Omit<Tx, 'id' | 'created_at' | 'updated_at' | 'splits'> & { splits: Split[] };

/** Validates input against accounts, categories and permissions, and fills derived fields. */
export function normaliseTx(input: TxInput, viewer: number, existing?: Tx): Normalised {
  const accounts = loadAccounts();
  const account = accounts.get(input.account_id);
  if (!account || !accountVisible(account, viewer)) throw new HttpError(400, 'Cuenta inválida.');
  assertWritable(account, viewer);

  let toAccount: Account | undefined;
  let toAmount: number | null = null;
  let isSettlement = false;
  if (input.type === 'transfer') {
    if (input.to_account_id == null) throw new HttpError(400, 'Elegí la cuenta destino.');
    toAccount = accounts.get(input.to_account_id);
    if (!toAccount || !accountVisible(toAccount, viewer)) throw new HttpError(400, 'Cuenta destino inválida.');
    if (toAccount.id === account.id) throw new HttpError(400, 'La cuenta destino debe ser distinta a la de origen.');
    if (toAccount.currency !== account.currency) {
      if (!input.to_amount) throw new HttpError(400, 'Indicá el monto recibido en la moneda de la cuenta destino.');
      toAmount = input.to_amount;
    }
    const crossOwner = account.owner_id !== null && toAccount.owner_id !== null && account.owner_id !== toAccount.owner_id;
    isSettlement = crossOwner && (input.is_settlement ?? true);
    if (isSettlement && toAmount !== null) throw new HttpError(400, 'Para saldar deudas, ambas cuentas deben tener la misma moneda.');
  }

  if (input.type === 'adjustment') {
    if (input.amount === 0) throw new HttpError(400, 'El ajuste no puede ser cero.');
  } else if (input.amount <= 0) {
    throw new HttpError(400, 'El monto debe ser mayor a cero.');
  }

  let categoryId: number | null = input.category_id ?? null;
  if (input.type === 'expense' || input.type === 'income') {
    if (categoryId != null) {
      const cat = loadCategories().get(categoryId);
      if (!cat) throw new HttpError(400, 'Categoría inválida.');
      if (cat.kind !== input.type) throw new HttpError(400, 'La categoría no corresponde al tipo de movimiento.');
    }
  } else {
    categoryId = null;
  }

  const isShared = input.type === 'expense' && input.is_shared;
  const userIds = loadUsers().map((u) => u.id);
  const splits = isShared ? computeSplits(input.amount, input.split, userIds) : [];
  const isPrivate = input.is_private && !isShared && !isSettlement && account.owner_id !== null;

  return {
    type: input.type,
    status: input.status ?? existing?.status ?? 'confirmed',
    date: input.date,
    amount: input.amount,
    currency: account.currency,
    account_id: account.id,
    to_account_id: toAccount?.id ?? null,
    to_amount: toAmount,
    category_id: categoryId,
    description: input.description.trim(),
    merchant: input.merchant?.trim() || null,
    notes: input.notes?.trim() || null,
    tags: JSON.stringify([...new Set(input.tags)]),
    paid_by: account.owner_id,
    is_shared: isShared ? 1 : 0,
    split_method: isShared ? (input.split?.method ?? 'default') : null,
    is_private: isPrivate ? 1 : 0,
    is_settlement: isSettlement ? 1 : 0,
    installment_plan_id: existing?.installment_plan_id ?? null,
    installment_number: existing?.installment_number ?? null,
    recurring_id: existing?.recurring_id ?? null,
    import_batch_id: existing?.import_batch_id ?? null,
    import_hash: existing?.import_hash ?? null,
    receipt_file: existing?.receipt_file ?? null,
    created_by: existing?.created_by ?? viewer,
    splits,
  };
}

/** Joint accounts and your own are writable; a partner's accounts only if they are not private. */
export function assertWritable(account: Account, viewer: number) {
  if (account.owner_id !== null && account.owner_id !== viewer && account.is_private) {
    throw new HttpError(403, 'No podés modificar movimientos de una cuenta privada de tu pareja.');
  }
}

const TX_COLUMNS = [
  'type', 'status', 'date', 'amount', 'currency', 'account_id', 'to_account_id', 'to_amount', 'category_id',
  'description', 'merchant', 'notes', 'tags', 'paid_by', 'is_shared', 'split_method', 'is_private', 'is_settlement',
  'installment_plan_id', 'installment_number', 'recurring_id', 'import_batch_id', 'import_hash', 'receipt_file', 'created_by',
] as const;

export function insertTx(tx: Normalised): number {
  const sql = `INSERT INTO transactions (${TX_COLUMNS.join(',')}) VALUES (${TX_COLUMNS.map(() => '?').join(',')})`;
  const id = Number(db().prepare(sql).run(...TX_COLUMNS.map((c) => tx[c])).lastInsertRowid);
  writeSplits(id, tx.splits);
  return id;
}

export function updateTx(id: number, tx: Normalised) {
  const sql = `UPDATE transactions SET ${TX_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`;
  db().prepare(sql).run(...TX_COLUMNS.map((c) => tx[c]), id);
  writeSplits(id, tx.splits);
}

function writeSplits(id: number, splits: Split[]) {
  db().prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(id);
  const ins = db().prepare('INSERT INTO transaction_splits (transaction_id, user_id, amount) VALUES (?, ?, ?)');
  for (const s of splits) ins.run(id, s.user_id, s.amount);
}

export function createTx(input: TxInput, viewer: number, extra: Partial<Normalised> = {}): Tx {
  const id = db().transaction(() => insertTx({ ...normaliseTx(input, viewer), ...extra }))();
  return getTx(id)!;
}

/** A statement row (CSV import or Mercado Pago) after rules, expressed from the point of view of `account`. */
export type StatementRow = {
  type: 'expense' | 'income' | 'transfer';
  direction: 'out' | 'in';
  status?: 'confirmed' | 'pending';
  date: string;
  /** Positive cents, in `account`'s currency. */
  amount: number;
  to_account_id?: number | null;
  category_id?: number | null;
  description: string;
  merchant?: string | null;
  notes?: string | null;
  tags: string[];
  is_shared: boolean;
};

/**
 * Turns a statement row into a transaction. A transfer row moves money between `account` and
 * `to_account_id` in the row's direction, converting at that day's rate when the currencies differ.
 */
export function normaliseStatementRow(account: Account, r: StatementRow, accounts: Map<number, Account>, fx: Converter, viewer: number): Normalised {
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
  return normaliseTx(
    {
      type: r.type,
      status: r.status,
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
}

export function importHash(accountId: number, date: string, amount: number, description: string): string {
  const norm = description.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(`${accountId}|${date}|${amount}|${norm}`).digest('hex');
}

// ---- Installments (cuotas) ----

export const installmentSchema = txInputSchema
  .omit({ type: true, status: true, to_account_id: true, to_amount: true, is_settlement: true, date: true })
  .extend({
    purchase_date: dateStr,
    first_date: dateStr,
    count: z.number().int().min(2).max(72),
  });
export type InstallmentInput = z.infer<typeof installmentSchema>;

/** Creates a plan and one expense per month. Future installments are future-dated, so they show as committed spending. */
export function createInstallmentPlan(input: InstallmentInput, viewer: number): number {
  return db().transaction(() => {
    const description = input.description.trim() || 'Compra en cuotas';
    const planId = Number(
      db()
        .prepare('INSERT INTO installment_plans (description, total_amount, count, first_date, purchase_date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(description, input.amount, input.count, input.first_date, input.purchase_date, viewer).lastInsertRowid,
    );
    const parts = allocate(input.amount, Array(input.count).fill(1));
    const day = Number(input.first_date.slice(8, 10));
    // An exact split is given for the whole purchase; apply it proportionally to each installment.
    const split: SplitInput | null | undefined =
      input.split?.method === 'exact'
        ? { method: 'percent', values: (input.split.values ?? []).map((v) => ({ user_id: v.user_id, value: (v.value / input.amount) * 100 })) }
        : input.split;
    parts.forEach((amount, i) => {
      const tx = normaliseTx(
        { ...input, split, type: 'expense', date: addMonths(input.first_date, i, day), amount, description: `${description} (cuota ${i + 1}/${input.count})` },
        viewer,
      );
      insertTx({ ...tx, installment_plan_id: planId, installment_number: i + 1 });
    });
    return planId;
  })();
}
