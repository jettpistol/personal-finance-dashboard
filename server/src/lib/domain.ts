import { db } from '../db/index.js';
import type { Currency } from './money.js';
import { today } from './dates.js';

// Core model shared by routes and reports.
//
// Scopes:
//  - 'household': joint accounts, plus shared (split) expenses paid from anyone's account, at full amount.
//  - 'user:<id>': that user's own accounts, with shared expenses counted only at the user's share
//                 (wherever they were paid from). Joint-account spending is not part of a personal scope.
//
// Visibility: a user sees joint accounts, their own accounts and the partner's non-private accounts.
// Transactions on a partner's private account (or marked private) are hidden, except shared
// expenses and settlements that involve the viewer, which are shown with the account masked.

export type Scope = 'household' | `user:${number}`;

export type User = {
  id: number;
  username: string;
  display_name: string;
  color: string;
  share_dashboard: number;
  telegram_chat_id: string | null;
  email: string | null;
  notify_budget: number;
  notify_recurring: number;
  notify_review: number;
};

export type Account = {
  id: number;
  name: string;
  type: 'bank' | 'cash' | 'credit_card' | 'savings' | 'investment' | 'wallet';
  currency: Currency;
  owner_id: number | null;
  is_private: number;
  opening_balance: number;
  color: string | null;
  archived: number;
  sort: number;
};

export type Split = { user_id: number; amount: number };

export type Tx = {
  id: number;
  type: 'expense' | 'income' | 'transfer' | 'adjustment';
  status: 'confirmed' | 'pending';
  date: string;
  amount: number;
  currency: Currency;
  account_id: number;
  to_account_id: number | null;
  to_amount: number | null;
  category_id: number | null;
  description: string;
  merchant: string | null;
  notes: string | null;
  tags: string;
  paid_by: number | null;
  is_shared: number;
  split_method: string | null;
  is_private: number;
  is_settlement: number;
  installment_plan_id: number | null;
  installment_number: number | null;
  recurring_id: number | null;
  import_batch_id: number | null;
  import_hash: string | null;
  receipt_file: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  splits: Split[];
};

export type Category = {
  id: number;
  name: string;
  parent_id: number | null;
  kind: 'expense' | 'income';
  color: string | null;
  icon: string | null;
  archived: number;
  sort: number;
};

export function parseScope(s: unknown): Scope | null {
  if (s === 'household') return 'household';
  if (typeof s === 'string' && /^user:\d+$/.test(s)) return s as Scope;
  return null;
}

export function scopeUserId(scope: Scope): number | null {
  return scope === 'household' ? null : Number(scope.slice(5));
}

export function loadUsers(): User[] {
  return db()
    .prepare(
      'SELECT id, username, display_name, color, share_dashboard, telegram_chat_id, email, notify_budget, notify_recurring, notify_review FROM users ORDER BY id',
    )
    .all() as User[];
}

export function loadAccounts(): Map<number, Account> {
  const rows = db().prepare('SELECT * FROM accounts ORDER BY sort, id').all() as Account[];
  return new Map(rows.map((a) => [a.id, a]));
}

export function loadCategories(): Map<number, Category> {
  const rows = db().prepare('SELECT * FROM categories ORDER BY sort, id').all() as Category[];
  return new Map(rows.map((c) => [c.id, c]));
}

/** The top-level category for a category id (itself if it is top-level). */
export function rootCategory(cats: Map<number, Category>, id: number | null): number | null {
  if (id == null) return null;
  let c = cats.get(id);
  while (c?.parent_id != null) c = cats.get(c.parent_id);
  return c?.id ?? null;
}

export function accountVisible(a: Account, viewer: number): boolean {
  return a.owner_id === null || a.owner_id === viewer || !a.is_private;
}

/** Whether the viewer may view a scope's dashboard. */
export function scopeVisible(scope: Scope, viewer: number, users: User[]): boolean {
  const uid = scopeUserId(scope);
  if (uid === null || uid === viewer) return true;
  const u = users.find((x) => x.id === uid);
  return !!u && !!u.share_dashboard;
}

function sideVisible(accountId: number | null, tx: Tx, viewer: number, accounts: Map<number, Account>): boolean {
  if (accountId == null) return false;
  const a = accounts.get(accountId);
  if (!a) return false;
  if (a.owner_id === viewer) return true;
  if (!accountVisible(a, viewer)) return false;
  return !(tx.is_private && a.owner_id !== null);
}

export type TxVisibility = 'full' | 'masked' | 'hidden';

export function txVisibility(tx: Tx, viewer: number, accounts: Map<number, Account>): TxVisibility {
  if (sideVisible(tx.account_id, tx, viewer, accounts) || sideVisible(tx.to_account_id, tx, viewer, accounts)) return 'full';
  if (tx.is_shared && tx.splits.some((s) => s.user_id === viewer)) return 'masked';
  if (tx.is_settlement && tx.to_account_id != null && accounts.get(tx.to_account_id)?.owner_id === viewer) return 'masked';
  return 'hidden';
}

/** A copy of the transaction safe to send to the viewer (accounts they can't see are removed). */
export function presentTx(tx: Tx, viewer: number, accounts: Map<number, Account>) {
  const vis = txVisibility(tx, viewer, accounts);
  const fromVisible = sideVisible(tx.account_id, tx, viewer, accounts);
  const toVisible = sideVisible(tx.to_account_id, tx, viewer, accounts);
  const account = accounts.get(tx.account_id);
  return {
    ...tx,
    account_id: fromVisible ? tx.account_id : null,
    to_account_id: toVisible ? tx.to_account_id : null,
    notes: vis === 'full' ? tx.notes : null,
    receipt_file: undefined,
    has_receipt: vis === 'full' && !!tx.receipt_file,
    tags: JSON.parse(tx.tags) as string[],
    masked: vis === 'masked',
    owner_id: account?.owner_id ?? null,
    owner: ownerOf(tx, accounts),
    can_edit: vis === 'full' && !!account && (account.owner_id === null || account.owner_id === viewer || !account.is_private),
  };
}

/** Whose a movement is: 'shared' when it is shared or in a joint account, else the account owner's id. */
export function ownerOf(tx: Tx, accounts: Map<number, Account>): 'shared' | number {
  const owner = accounts.get(tx.account_id)?.owner_id ?? null;
  return tx.is_shared || owner === null ? 'shared' : owner;
}

/** The user a transaction is attributed to as payer (explicit paid_by, else the account owner). */
export function payerOf(tx: Tx, accounts: Map<number, Account>): number | null {
  return tx.paid_by ?? accounts.get(tx.account_id)?.owner_id ?? null;
}

export type ScopeEntry = {
  kind: 'expense' | 'income';
  amount: number; // cents, in tx.currency, always positive
  currency: Currency;
  date: string;
  category_id: number | null;
  tx: Tx;
};

/** How a confirmed transaction counts towards a scope's income/expense figures, or null if it doesn't. */
export function scopeEntry(tx: Tx, scope: Scope, accounts: Map<number, Account>): ScopeEntry | null {
  if (tx.status !== 'confirmed') return null;
  if (tx.type !== 'expense' && tx.type !== 'income') return null;
  const account = accounts.get(tx.account_id);
  if (!account) return null;
  const uid = scopeUserId(scope);
  const base = { kind: tx.type, currency: tx.currency, date: tx.date, category_id: tx.category_id, tx } as const;

  if (tx.is_shared && tx.splits.length) {
    if (uid === null) return { ...base, amount: tx.amount };
    const share = tx.splits.find((s) => s.user_id === uid)?.amount ?? 0;
    return share ? { ...base, amount: share } : null;
  }
  if (uid === null) return account.owner_id === null ? { ...base, amount: tx.amount } : null;
  return account.owner_id === uid ? { ...base, amount: tx.amount } : null;
}

/** Accounts that belong to a scope (for balances and net worth). */
export function scopeAccounts(scope: Scope, accounts: Map<number, Account>): Account[] {
  const uid = scopeUserId(scope);
  return [...accounts.values()].filter((a) => a.owner_id === uid);
}

/** Effect of a confirmed transaction on account balances: [accountId, deltaCents][]. */
export function balanceEffects(tx: Tx): [number, number][] {
  if (tx.status !== 'confirmed') return [];
  switch (tx.type) {
    case 'expense':
      return [[tx.account_id, -tx.amount]];
    case 'income':
    case 'adjustment':
      return [[tx.account_id, tx.amount]];
    case 'transfer':
      return tx.to_account_id == null
        ? [[tx.account_id, -tx.amount]]
        : [
            [tx.account_id, -tx.amount],
            [tx.to_account_id, tx.to_amount ?? tx.amount],
          ];
  }
}

/** Balances as of a date (default today), so future-dated installments don't count yet. */
export function accountBalances(accounts: Map<number, Account>, asOf: string = today()): Map<number, number> {
  const balances = new Map<number, number>([...accounts.values()].map((a) => [a.id, a.opening_balance]));
  const rows = db().prepare(`SELECT * FROM transactions WHERE status = 'confirmed' AND date <= ?`).all(asOf) as Tx[];
  for (const tx of rows) {
    for (const [id, delta] of balanceEffects(tx)) balances.set(id, (balances.get(id) ?? 0) + delta);
  }
  return balances;
}

// ---- Splitwise-style ledger ----

/**
 * Net position per user and currency from shared expenses and settlements.
 * Positive = the user is owed money; negative = the user owes money. Each currency sums to zero.
 */
export function ledger(txs: Tx[], accounts: Map<number, Account>): Map<Currency, Map<number, number>> {
  const out = new Map<Currency, Map<number, number>>();
  const add = (cur: Currency, user: number, delta: number) => {
    if (!out.has(cur)) out.set(cur, new Map());
    const m = out.get(cur)!;
    m.set(user, (m.get(user) ?? 0) + delta);
  };
  for (const tx of txs) {
    if (tx.status !== 'confirmed') continue;
    if (tx.type === 'expense' && tx.is_shared && tx.splits.length) {
      const payer = payerOf(tx, accounts);
      if (payer == null) continue; // paid from the joint pot: nobody owes anybody
      add(tx.currency, payer, tx.amount);
      for (const s of tx.splits) add(tx.currency, s.user_id, -s.amount);
    } else if (tx.type === 'income' && tx.is_shared && tx.splits.length) {
      // Shared income received in one person's account: they owe the others their shares.
      const receiver = payerOf(tx, accounts);
      if (receiver == null) continue; // received in the joint pot: already shared
      add(tx.currency, receiver, -tx.amount);
      for (const s of tx.splits) add(tx.currency, s.user_id, s.amount);
    } else if (tx.type === 'transfer' && tx.is_settlement && tx.to_account_id != null) {
      const from = accounts.get(tx.account_id)?.owner_id;
      const to = accounts.get(tx.to_account_id)?.owner_id;
      if (from == null || to == null || from === to) continue;
      add(tx.currency, from, tx.amount);
      add(tx.currency, to, -tx.amount);
    }
  }
  return out;
}

// ---- Loading transactions ----

export type TxFilter = {
  from?: string;
  to?: string;
  status?: 'confirmed' | 'pending';
  ids?: number[];
};

export function fetchTxs(filter: TxFilter = {}): Tx[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.from) {
    where.push('date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('date <= ?');
    params.push(filter.to);
  }
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.ids) {
    if (!filter.ids.length) return [];
    where.push(`id IN (${filter.ids.map(() => '?').join(',')})`);
    params.push(...filter.ids);
  }
  const sql = `SELECT * FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id DESC`;
  const rows = db().prepare(sql).all(...params) as Tx[];
  attachSplits(rows);
  return rows;
}

export function attachSplits(rows: Tx[]) {
  if (!rows.length) return;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) r.splits = [];
  const ids = rows.map((r) => r.id);
  // Chunk to stay under SQLite's parameter limit.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const splits = db()
      .prepare(`SELECT transaction_id, user_id, amount FROM transaction_splits WHERE transaction_id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk) as (Split & { transaction_id: number })[];
    for (const s of splits) byId.get(s.transaction_id)?.splits.push({ user_id: s.user_id, amount: s.amount });
  }
}

export function getTx(id: number): Tx | null {
  return fetchTxs({ ids: [id] })[0] ?? null;
}
