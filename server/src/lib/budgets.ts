import { db, getSetting } from '../db/index.js';
import { addMonthsToMonth, monthEnd, monthStart, monthOf, currentMonth } from './dates.js';
import { fetchTxs, loadAccounts, loadCategories, loadUsers, scopeEntry, txVisibility, type Scope, type Tx } from './domain.js';
import { loadConverter } from './fx.js';
import { formatMoney, type Currency } from './money.js';
import { notify } from './notify.js';
import { loadCpi, type CpiIndex } from './cpi.js';

export type Budget = { id: number; category_id: number; scope: Scope; amount: number; currency: Currency; base_month: string | null };

export type BudgetStatus = Budget & {
  category_name: string;
  parent_id: number | null;
  color: string | null;
  spent: number;
  pct: number;
  /** The amount as entered; `amount` is this adjusted by inflation when the switch is on. */
  base_amount: number;
  /** Inflation applied to the entered amount, as a percentage (0 when not adjusted). */
  indexed_pct: number;
};

/**
 * The CPI factor for a budget in `month`: inflation published from the month it was set up to the
 * month before `month` (the latest data available while that month runs). Never below 1.
 */
function indexFactor(b: Budget, month: string, cpi: CpiIndex, on: boolean): number {
  if (!on || b.currency !== 'ARS' || !b.base_month || !cpi.latestMonth) return 1;
  const prev = addMonthsToMonth(month, -1);
  const target = prev < cpi.latestMonth ? prev : cpi.latestMonth;
  if (target <= b.base_month) return 1;
  return cpi.factor(b.base_month, target);
}

/** Spending of a scope in a month, per budget. Budgets on a parent category include its subcategories. */
export function budgetStatus(month: string, scope: Scope, viewer?: number): BudgetStatus[] {
  const budgets = db().prepare('SELECT * FROM budgets WHERE scope = ?').all(scope) as Budget[];
  if (!budgets.length) return [];
  const accounts = loadAccounts();
  const cats = loadCategories();
  const fx = loadConverter();
  const cpi = loadCpi();
  const indexing = !!getSetting<boolean>('budget_indexing');
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
      const factor = indexFactor(b, month, cpi, indexing);
      const amount = factor === 1 ? b.amount : Math.round((b.amount * factor) / 100) * 100;
      return {
        ...b,
        amount,
        base_amount: b.amount,
        indexed_pct: Math.round((factor - 1) * 1000) / 10,
        category_name: cat?.name ?? '?',
        parent_id: cat?.parent_id ?? null,
        color: cat?.color ?? null,
        spent,
        pct: amount > 0 ? Math.round((spent / amount) * 1000) / 10 : 0,
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

/** The CPI month a budget's amount refers to: the latest published when it is saved. */
export function currentBaseMonth(): string | null {
  return loadCpi().latestMonth;
}
