import { addMonthsToMonth, currentMonth, monthEnd, monthOf, monthRange, monthStart, today } from './dates.js';
import {
  accountVisible,
  balanceEffects,
  fetchTxs,
  ledger,
  loadAccounts,
  loadCategories,
  loadUsers,
  payerOf,
  rootCategory,
  scopeEntry,
  scopeUserId,
  type Account,
  type Scope,
  type ScopeEntry,
  type Tx,
  txVisibility,
} from './domain.js';
import { loadConverter, type Converter } from './fx.js';
import { loadCpi, type CpiIndex } from './cpi.js';
import type { Currency } from './money.js';

// All report amounts are cents in the requested display currency. Each transaction is converted
// at its own day's BNA rate. With `real`, ARS amounts are restated in pesos of the latest month.

export type ReportCtx = {
  scope: Scope;
  currency: Currency;
  viewer: number;
  real?: boolean;
  fx?: Converter;
  cpi?: CpiIndex;
  accounts?: Map<number, Account>;
};

type Ctx = Required<Omit<ReportCtx, 'real'>> & { real: boolean; baseMonth: string; missingRates: boolean };

function ctx(c: ReportCtx): Ctx {
  return {
    ...c,
    real: !!c.real,
    fx: c.fx ?? loadConverter(),
    cpi: c.cpi ?? loadCpi(),
    accounts: c.accounts ?? loadAccounts(),
    baseMonth: currentMonth(),
    missingRates: false,
  };
}

function value(c: Ctx, e: { amount: number; currency: Currency; date: string }): number {
  const v = c.fx.convert(e.amount, e.currency, c.currency, e.date);
  if (v === null) {
    c.missingRates = true;
    return 0;
  }
  if (c.real && c.currency === 'ARS') return Math.round(v * c.cpi.factor(monthOf(e.date), c.baseMonth));
  return v;
}

// Transactions hidden from the viewer (partner's private accounts) never reach a report.
function visibleTxs(c: Ctx, from: string, to: string): Tx[] {
  return fetchTxs({ from, to, status: 'confirmed' }).filter((t) => txVisibility(t, c.viewer, c.accounts) !== 'hidden');
}

function entries(c: Ctx, from: string, to: string): ScopeEntry[] {
  return visibleTxs(c, from, to)
    .map((t) => scopeEntry(t, c.scope, c.accounts))
    .filter((e): e is ScopeEntry => e !== null);
}

function merchantKey(t: Tx): string {
  return (t.merchant || t.description || '(sin descripción)').trim().replace(/\s+/g, ' ');
}

/** Expense per top-level category for a month, in display currency. */
export function categoryTotals(month: string, scope: Scope, currency: Currency, viewer: number): Map<number, number> {
  const c = ctx({ scope, currency, viewer });
  const cats = loadCategories();
  const out = new Map<number, number>();
  for (const e of entries(c, monthStart(month), monthEnd(month))) {
    if (e.kind !== 'expense') continue;
    const root = rootCategory(cats, e.category_id) ?? 0;
    out.set(root, (out.get(root) ?? 0) + value(c, e));
  }
  return out;
}

/**
 * Money moved between the joint pot and personal accounts, per month, from the scope's point of view.
 * Household: + money put into joint accounts, - money taken back out. Personal scope: the opposite,
 * for that user's own accounts. Without this, the household would show no income at all, and
 * personal savings would ignore what each one hands over to the joint pot.
 */
function contributions(c: Ctx, from: string, to: string): Map<string, number> {
  const out = new Map<string, number>();
  const uid = scopeUserId(c.scope);
  for (const t of visibleTxs(c, from, to)) {
    if (t.type !== 'transfer' || t.to_account_id == null) continue;
    const src = c.accounts.get(t.account_id);
    const dst = c.accounts.get(t.to_account_id);
    if (!src || !dst) continue;
    const intoJoint = src.owner_id !== null && dst.owner_id === null;
    const outOfJoint = src.owner_id === null && dst.owner_id !== null;
    if (!intoJoint && !outOfJoint) continue;
    const personal = intoJoint ? src.owner_id : dst.owner_id;
    if (uid !== null && personal !== uid) continue;
    let v = value(c, { amount: t.amount, currency: t.currency, date: t.date });
    if (outOfJoint) v = -v;
    if (uid !== null) v = -v;
    const m = monthOf(t.date);
    out.set(m, (out.get(m) ?? 0) + v);
  }
  return out;
}

function savingsRate(income: number, contrib: number, net: number): number | null {
  const base = income + Math.max(0, contrib);
  return base > 0 ? Math.round((net / base) * 1000) / 10 : null;
}

export type MonthSummary = {
  month: string;
  income: number;
  /** Net money into (household) or out of (negative, personal) the joint pot. */
  contributions: number;
  expense: number;
  net: number;
  savings_rate: number | null;
  by_category: { category_id: number | null; name: string; color: string | null; amount: number; children: { category_id: number | null; name: string; amount: number }[] }[];
  income_by_category: { category_id: number | null; name: string; amount: number }[];
  top_merchants: { name: string; amount: number; count: number }[];
  count: number;
  missing_rates: boolean;
};

export function monthSummary(month: string, rc: ReportCtx): MonthSummary {
  const c = ctx(rc);
  const cats = loadCategories();
  let income = 0;
  let expense = 0;
  const byRoot = new Map<number, { amount: number; children: Map<number, number> }>();
  const incomeByCat = new Map<number, number>();
  const merchants = new Map<string, { amount: number; count: number }>();
  const list = entries(c, monthStart(month), monthEnd(month));
  for (const e of list) {
    const v = value(c, e);
    if (e.kind === 'income') {
      income += v;
      const root = rootCategory(cats, e.category_id) ?? 0;
      incomeByCat.set(root, (incomeByCat.get(root) ?? 0) + v);
      continue;
    }
    expense += v;
    const root = rootCategory(cats, e.category_id) ?? 0;
    const bucket = byRoot.get(root) ?? { amount: 0, children: new Map() };
    bucket.amount += v;
    const child = e.category_id ?? 0;
    bucket.children.set(child, (bucket.children.get(child) ?? 0) + v);
    byRoot.set(root, bucket);
    const key = merchantKey(e.tx);
    const m = merchants.get(key) ?? { amount: 0, count: 0 };
    m.amount += v;
    m.count++;
    merchants.set(key, m);
  }
  const name = (id: number) => (id === 0 ? 'Sin categoría' : (cats.get(id)?.name ?? '?'));
  const contrib = contributions(c, monthStart(month), monthEnd(month)).get(month) ?? 0;
  const net = income + contrib - expense;
  return {
    month,
    income,
    contributions: contrib,
    expense,
    net,
    savings_rate: savingsRate(income, contrib, net),
    by_category: [...byRoot.entries()]
      .map(([id, b]) => ({
        category_id: id || null,
        name: name(id),
        color: cats.get(id)?.color ?? 'gray',
        amount: b.amount,
        children: [...b.children.entries()].map(([cid, amount]) => ({ category_id: cid || null, name: cid === id ? `${name(id)} (general)` : name(cid), amount })).sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.amount - a.amount),
    income_by_category: [...incomeByCat.entries()].map(([id, amount]) => ({ category_id: id || null, name: name(id), amount })).sort((a, b) => b.amount - a.amount),
    top_merchants: [...merchants.entries()].map(([n, m]) => ({ name: n, ...m })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    count: list.length,
    missing_rates: c.missingRates,
  };
}

export type TrendRow = {
  month: string;
  income: number;
  contributions: number;
  expense: number;
  net: number;
  savings_rate: number | null;
  cpi_pct: number | null;
  categories: Record<string, number>;
};

/** Month-by-month income, expense and expense per top-level category (keyed by category name). */
export function trend(fromMonth: string, toMonth: string, rc: ReportCtx): { rows: TrendRow[]; categories: { name: string; color: string | null }[]; missing_rates: boolean } {
  const c = ctx(rc);
  const cats = loadCategories();
  const months = monthRange(fromMonth, toMonth);
  const rows = new Map<string, TrendRow>(
    months.map((m) => [m, { month: m, income: 0, contributions: 0, expense: 0, net: 0, savings_rate: null, cpi_pct: c.cpi.pct.get(m) ?? null, categories: {} }]),
  );
  const seen = new Map<string, string | null>();
  for (const e of entries(c, monthStart(fromMonth), monthEnd(toMonth))) {
    const row = rows.get(monthOf(e.date));
    if (!row) continue;
    const v = value(c, e);
    if (e.kind === 'income') {
      row.income += v;
      continue;
    }
    row.expense += v;
    const root = rootCategory(cats, e.category_id);
    const n = root == null ? 'Sin categoría' : (cats.get(root)?.name ?? '?');
    seen.set(n, root == null ? 'gray' : (cats.get(root)?.color ?? null));
    row.categories[n] = (row.categories[n] ?? 0) + v;
  }
  for (const [m, v] of contributions(c, monthStart(fromMonth), monthEnd(toMonth))) {
    const row = rows.get(m);
    if (row) row.contributions = v;
  }
  for (const r of rows.values()) {
    r.net = r.income + r.contributions - r.expense;
    r.savings_rate = savingsRate(r.income, r.contributions, r.net);
  }
  return { rows: [...rows.values()], categories: [...seen.entries()].map(([name, color]) => ({ name, color })), missing_rates: c.missingRates };
}

/** Accounts counted in a scope's net worth. Household: everything the viewer can see. */
function netWorthAccounts(scope: Scope, viewer: number, accounts: Map<number, Account>): Account[] {
  const uid = scopeUserId(scope);
  return [...accounts.values()].filter((a) => (uid === null ? accountVisible(a, viewer) : a.owner_id === uid && accountVisible(a, viewer)));
}

export function netWorth(fromMonth: string, toMonth: string, rc: ReportCtx) {
  const c = ctx(rc);
  const included = netWorthAccounts(c.scope, c.viewer, c.accounts);
  const ids = new Set(included.map((a) => a.id));
  const balances = new Map(included.map((a) => [a.id, a.opening_balance]));
  const txs = fetchTxs({ to: monthEnd(toMonth), status: 'confirmed' }).reverse(); // ascending
  const months = monthRange(fromMonth, toMonth);
  const rows: { month: string; total: number; by_type: Record<string, number>; assets: number; liabilities: number }[] = [];
  let i = 0;
  for (const m of months) {
    const end = m === currentMonth() ? today() : monthEnd(m);
    while (i < txs.length && txs[i].date <= end) {
      for (const [id, delta] of balanceEffects(txs[i])) if (ids.has(id)) balances.set(id, (balances.get(id) ?? 0) + delta);
      i++;
    }
    const byType: Record<string, number> = {};
    let total = 0;
    let assets = 0;
    let liabilities = 0;
    for (const a of included) {
      const converted = c.fx.convert(balances.get(a.id) ?? 0, a.currency, c.currency, end);
      if (converted === null) c.missingRates = true;
      const v = converted ?? 0;
      byType[a.type] = (byType[a.type] ?? 0) + v;
      total += v;
      if (v >= 0) assets += v;
      else liabilities += v;
    }
    rows.push({ month: m, total, by_type: byType, assets, liabilities });
  }
  return { rows, accounts: included.map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency })), missing_rates: c.missingRates };
}

/** Spending per person: personal spending, their share of shared expenses, and what they paid for shared ones. */
export function perPerson(fromMonth: string, toMonth: string, rc: Omit<ReportCtx, 'scope'>) {
  const users = loadUsers();
  const base = ctx({ ...rc, scope: 'household' });
  const txs = visibleTxs(base, monthStart(fromMonth), monthEnd(toMonth));
  return users.map((u) => {
    const c: Ctx = { ...base, scope: `user:${u.id}` };
    let personal = 0;
    let sharedShare = 0;
    let paidForShared = 0;
    let income = 0;
    for (const t of txs) {
      const e = scopeEntry(t, c.scope, c.accounts);
      if (e) {
        const v = value(c, e);
        if (e.kind === 'income') income += v;
        else if (t.is_shared) sharedShare += v;
        else personal += v;
      }
      if (t.type === 'expense' && t.is_shared && payerOf(t, c.accounts) === u.id) paidForShared += value(c, t);
    }
    return { user_id: u.id, name: u.display_name, color: u.color, personal, shared_share: sharedShare, total: personal + sharedShare, paid_for_shared: paidForShared, income };
  });
}

export function merchants(fromMonth: string, toMonth: string, rc: ReportCtx, limit = 20) {
  const c = ctx(rc);
  const cats = loadCategories();
  const map = new Map<string, { name: string; amount: number; count: number; categories: Map<string, number> }>();
  for (const e of entries(c, monthStart(fromMonth), monthEnd(toMonth))) {
    if (e.kind !== 'expense') continue;
    const key = merchantKey(e.tx).toLowerCase();
    const m = map.get(key) ?? { name: merchantKey(e.tx), amount: 0, count: 0, categories: new Map() };
    const v = value(c, e);
    m.amount += v;
    m.count++;
    const cn = cats.get(rootCategory(cats, e.category_id) ?? -1)?.name ?? 'Sin categoría';
    m.categories.set(cn, (m.categories.get(cn) ?? 0) + v);
    map.set(key, m);
  }
  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((m) => ({ name: m.name, amount: m.amount, count: m.count, average: Math.round(m.amount / m.count), category: [...m.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }));
}

/**
 * Inflation view: how spending moved compared with CPI.
 * real_change = (1 + nominal) / (1 + cpi) - 1. Positive means spending grew faster than prices.
 */
export function inflationReport(month: string, rc: Omit<ReportCtx, 'currency' | 'real'>) {
  const cpi = rc.cpi ?? loadCpi();
  const prev = addMonthsToMonth(month, -1);
  const yearAgo = addMonthsToMonth(month, -12);
  const nominal = (m: string) => categoryTotals(m, rc.scope, 'ARS', rc.viewer);
  const cur = nominal(month);
  const p = nominal(prev);
  const y = nominal(yearAgo);
  const cats = loadCategories();
  const cpiPrev = cpi.between(prev, month);
  const cpiYear = cpi.between(yearAgo, month);
  const change = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const real = (nom: number | null, inf: number | null) => (nom === null || inf === null ? null : ((1 + nom / 100) / (1 + inf / 100) - 1) * 100);
  const ids = new Set([...cur.keys(), ...p.keys()]);
  const categories = [...ids]
    .map((id) => {
      const vsPrev = change(cur.get(id) ?? 0, p.get(id) ?? 0);
      const vsYear = change(cur.get(id) ?? 0, y.get(id) ?? 0);
      return {
        category_id: id || null,
        name: id === 0 ? 'Sin categoría' : (cats.get(id)?.name ?? '?'),
        amount: cur.get(id) ?? 0,
        previous: p.get(id) ?? 0,
        year_ago: y.get(id) ?? 0,
        nominal_vs_prev: vsPrev,
        real_vs_prev: real(vsPrev, cpiPrev),
        nominal_vs_year: vsYear,
        real_vs_year: real(vsYear, cpiYear),
      };
    })
    .sort((a, b) => b.amount - a.amount);
  const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const totalNominal = change(sum(cur), sum(p));
  const totalYear = change(sum(cur), sum(y));
  // 12-month history of CPI vs your month-over-month spending change.
  const history = monthRange(addMonthsToMonth(month, -11), month).map((m) => ({ month: m, cpi_pct: cpi.pct.get(m) ?? null }));
  return {
    month,
    cpi_latest_month: cpi.latestMonth,
    cpi_month: cpi.pct.get(month) ?? null,
    cpi_estimated: cpi.isEstimate(month),
    cpi_vs_prev: cpiPrev,
    cpi_vs_year: cpiYear,
    total: { amount: sum(cur), previous: sum(p), year_ago: sum(y), nominal_vs_prev: totalNominal, real_vs_prev: real(totalNominal, cpiPrev), nominal_vs_year: totalYear, real_vs_year: real(totalYear, cpiYear) },
    categories,
    history,
  };
}

export type BalanceSummary = {
  currency: Currency;
  users: { user_id: number; name: string; net: number }[];
  // Simplified debt: who should pay whom (two-person households give a single line).
  settlements: { from: number; to: number; amount: number }[];
};

export function balances(): BalanceSummary[] {
  const accounts = loadAccounts();
  const users = loadUsers();
  const result = ledger(fetchTxs({ to: today() }), accounts);
  return [...result.entries()].map(([currency, map]) => {
    const nets = users.map((u) => ({ user_id: u.id, name: u.display_name, net: map.get(u.id) ?? 0 }));
    // Greedy settle-up: largest debtor pays largest creditor.
    const debtors = nets.filter((n) => n.net < 0).map((n) => ({ ...n }));
    const creditors = nets.filter((n) => n.net > 0).map((n) => ({ ...n }));
    const settlements: BalanceSummary['settlements'] = [];
    debtors.sort((a, b) => a.net - b.net);
    creditors.sort((a, b) => b.net - a.net);
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(-debtors[i].net, creditors[j].net);
      if (amt > 0) settlements.push({ from: debtors[i].user_id, to: creditors[j].user_id, amount: amt });
      debtors[i].net += amt;
      creditors[j].net -= amt;
      if (debtors[i].net === 0) i++;
      if (creditors[j].net === 0) j++;
    }
    return { currency, users: nets, settlements };
  });
}

/**
 * Platform fees (Mercado Pago and others) inside movements of the scope, per month and platform.
 * Household: joint accounts and shared movements; a person: their own accounts.
 */
export function feeReport(fromMonth: string, toMonth: string, rc: ReportCtx) {
  const c = ctx(rc);
  const uid = scopeUserId(rc.scope);
  const months = new Map(monthRange(fromMonth, toMonth).map((m) => [m, 0]));
  const platforms = new Map<string, { platform: string; total: number; count: number; kinds: Record<string, number> }>();
  let total = 0;
  for (const tx of fetchTxs({ from: monthStart(fromMonth), to: monthEnd(toMonth), status: 'confirmed' })) {
    if (!tx.fees?.length || txVisibility(tx, rc.viewer, c.accounts) !== 'full') continue;
    const owner = c.accounts.get(tx.account_id)?.owner_id ?? null;
    if (uid === null ? !(owner === null || tx.is_shared) : owner !== uid) continue;
    for (const f of tx.fees) {
      const v = value(c, { amount: f.amount, currency: tx.currency, date: tx.date });
      total += v;
      months.set(monthOf(tx.date), (months.get(monthOf(tx.date)) ?? 0) + v);
      const p = platforms.get(f.platform) ?? { platform: f.platform, total: 0, count: 0, kinds: {} };
      p.total += v;
      p.count++;
      p.kinds[f.kind] = (p.kinds[f.kind] ?? 0) + v;
      platforms.set(f.platform, p);
    }
  }
  return {
    total,
    months: [...months.entries()].map(([month, amount]) => ({ month, amount })),
    platforms: [...platforms.values()].sort((a, b) => b.total - a.total),
    missing_rates: c.missingRates,
  };
}
