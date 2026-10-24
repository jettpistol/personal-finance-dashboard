import { db, getSetting } from '../db/index.js';
import { monthEnd, monthStart, monthOf, currentMonth } from './dates.js';
import { fetchTxs, loadAccounts, loadCategories, loadUsers, scopeEntry, txVisibility, type Scope, type Tx } from './domain.js';
import { loadConverter } from './fx.js';
import { formatMoney, type Currency } from './money.js';
import { notify } from './notify.js';
import { loadCpi } from './cpi.js';
import { HttpError } from './http.js';

export type Budget = { id: number; category_id: number; scope: Scope; amount: number; currency: Currency };

export type BudgetStatus = Budget & {
  category_name: string;
  parent_id: number | null;
  color: string | null;
  spent: number;
  pct: number;
};

/** Spending of a scope in a month, per budget. Budgets on a parent category include its subcategories. */
export function budgetStatus(month: string, scope: Scope, viewer?: number): BudgetStatus[] {
  const budgets = db().prepare('SELECT * FROM budgets WHERE scope = ?').all(scope) as Budget[];
  if (!budgets.length) return [];
  const accounts = loadAccounts();
  const cats = loadCategories();
  const fx = loadConverter();
  const txs = fetchTxs({ from: monthStart(month), to: monthEnd(month), status: 'confirmed' }).filter(
    (t) => viewer === undefined || txVisibility(t, viewer, accounts) !== 'hidden',
  );
  const entries = txs.map((t) => scopeEntry(t, scope, accounts)).filter((e) => e?.kind === 'expense');
  return budgets
    .map((b) => {
      const cat = cats.get(b.category_id);
      let spent = 0;
      for (const e of entries) {
        if (!e || e.category_id == null) continue;
        const c = cats.get(e.category_id);
        if (e.category_id === b.category_id || c?.parent_id === b.category_id) {
          spent += fx.convertOrZero(e.amount, e.currency, b.currency, e.date);
        }
      }
      return {
        ...b,
        category_name: cat?.name ?? '?',
        parent_id: cat?.parent_id ?? null,
        color: cat?.color ?? null,
        spent,
        pct: b.amount > 0 ? Math.round((spent / b.amount) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

/** After a transaction lands, warn the scope's users once per month per threshold crossed. */
export async function checkBudgetAlerts(tx: Tx) {
  if (tx.type !== 'expense' || tx.status !== 'confirmed') return;
  const month = monthOf(tx.date);
  if (month !== currentMonth()) return;
  const accounts = loadAccounts();
  const users = loadUsers();
  const scopes: Scope[] = ['household', ...users.map((u) => `user:${u.id}` as Scope)];
  const thresholds = [...getSetting<number[]>('budget_thresholds')].sort((a, b) => b - a);
  for (const scope of scopes) {
    if (!scopeEntry(tx, scope, accounts)) continue;
    for (const b of budgetStatus(month, scope)) {
      const crossed = thresholds.find((t) => b.pct >= t);
      if (crossed === undefined) continue;
      const res = db().prepare('INSERT OR IGNORE INTO budget_alerts_sent (budget_id, month, threshold) VALUES (?, ?, ?)').run(b.id, month, crossed);
      if (!res.changes) continue;
      const recipients = scope === 'household' ? null : [Number(scope.slice(5))];
      const over = b.pct >= 100;
      await notify({
        kind: 'budget',
        users: recipients,
        title: over ? `Presupuesto superado: ${b.category_name}` : `Presupuesto al ${crossed}%: ${b.category_name}`,
        body: `${scope === 'household' ? 'Hogar' : 'Personal'} · Gastado ${formatMoney(b.spent, b.currency)} de ${formatMoney(b.amount, b.currency)} (${b.pct}%).`,
        link: '/presupuestos',
      });
    }
  }
}

/** Raises every ARS budget of a scope by the last published monthly CPI. */
export function indexBudgetsByCpi(scope: Scope | null): { pct: number; month: string; updated: number } {
  const cpi = loadCpi();
  const month = cpi.latestMonth;
  if (!month) throw new HttpError(400, 'Todavía no hay datos de inflación cargados.');
  const pct = cpi.pct.get(month)!;
  const factor = 1 + pct / 100;
  const res = scope
    ? db().prepare(`UPDATE budgets SET amount = CAST(ROUND(amount * ? / 100.0) * 100 AS INTEGER) WHERE currency = 'ARS' AND scope = ?`).run(factor, scope)
    : db().prepare(`UPDATE budgets SET amount = CAST(ROUND(amount * ? / 100.0) * 100 AS INTEGER) WHERE currency = 'ARS'`).run(factor);
  return { pct, month, updated: res.changes };
}
