import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { addMonthsToMonth, currentMonth, isValidDate, today } from '../lib/dates.js';
import { accountBalances, accountVisible, fetchTxs, loadAccounts, loadUsers, presentTx, scopeAccounts, scopeEntry, txVisibility } from '../lib/domain.js';
import { balances, inflationReport, merchants, monthSummary, netWorth, perPerson, trend } from '../lib/reports.js';
import { budgetStatus } from '../lib/budgets.js';
import { latestRate, loadConverter, refreshRates, upsertRate } from '../lib/fx.js';
import { loadCpi, refreshCpi } from '../lib/cpi.js';
import { createTx } from '../lib/transactions.js';
import { bool, currencyQuery, monthQuery, parse, scopeQuery } from './util.js';

function rangeQuery(query: unknown, defaultMonths = 12) {
  const to = monthQuery(query, 'to');
  const fromRaw = (query as { from?: string }).from;
  const from = fromRaw ? monthQuery(query, 'from') : addMonthsToMonth(to, -(defaultMonths - 1));
  if (from > to) throw new HttpError(400, 'Rango inválido');
  return { from, to };
}

export default async function reportRoutes(app: FastifyInstance) {
  app.get('/dashboard', async (req) => {
    const scope = scopeQuery(req.query, req.userId);
    const currency = currencyQuery(req.query);
    const month = monthQuery(req.query);
    const viewer = req.userId;
    const accounts = loadAccounts();
    const fx = loadConverter();
    const summary = monthSummary(month, { scope, currency, viewer, fx, accounts });
    const previous = monthSummary(addMonthsToMonth(month, -1), { scope, currency, viewer, fx, accounts });
    const bal = accountBalances(accounts);
    const d = today();
    const scopeAccs = scopeAccounts(scope, accounts)
      .filter((a) => accountVisible(a, viewer) && !a.archived)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: bal.get(a.id) ?? 0, converted: fx.convert(bal.get(a.id) ?? 0, a.currency, currency, d) }));
    const all = fetchTxs({ from: addMonthsToMonth(month, -2) + '-01' }).filter((t) => txVisibility(t, viewer, accounts) !== 'hidden');
    const recent = all
      .filter((t) => t.status === 'confirmed' && t.date <= d && (scopeEntry(t, scope, accounts) || (t.type !== 'expense' && t.type !== 'income' && scopeAccs.some((a) => a.id === t.account_id || a.id === t.to_account_id))))
      .slice(0, 8)
      .map((t) => presentTx(t, viewer, accounts));
    // Only what is already due: future income installments wait until their date.
    const pending = all.filter((t) => t.status === 'pending' && t.date <= today()).length;
    const upcoming = fetchTxs({ from: d })
      .filter((t) => t.installment_plan_id && t.date > d && scopeEntry(t, scope, accounts) && txVisibility(t, viewer, accounts) !== 'hidden')
      .reduce<Record<string, number>>((acc, t) => {
        const m = t.date.slice(0, 7);
        acc[m] = (acc[m] ?? 0) + (fx.convert(scopeEntry(t, scope, accounts)!.amount, t.currency, currency, d) ?? 0);
        return acc;
      }, {});
    const rate = latestRate();
    return {
      month,
      scope,
      currency,
      summary,
      previous: { income: previous.income, contributions: previous.contributions, expense: previous.expense, net: previous.net, savings_rate: previous.savings_rate },
      budgets: budgetStatus(month, scope, viewer),
      accounts: scopeAccs,
      accounts_total: scopeAccs.reduce((a, b) => a + (b.converted ?? 0), 0),
      balances: balances(),
      recent,
      pending,
      upcoming_installments: Object.entries(upcoming).sort().slice(0, 6).map(([m, amount]) => ({ month: m, amount })),
      fx: rate,
      day_of_month: month === currentMonth() ? Number(d.slice(8, 10)) : null,
    };
  });

  app.get('/reports/summary', async (req) => {
    const scope = scopeQuery(req.query, req.userId);
    return monthSummary(monthQuery(req.query), { scope, currency: currencyQuery(req.query), viewer: req.userId, real: bool((req.query as { real?: string }).real) });
  });

  app.get('/reports/trend', async (req) => {
    const scope = scopeQuery(req.query, req.userId);
    const { from, to } = rangeQuery(req.query);
    return trend(from, to, { scope, currency: currencyQuery(req.query), viewer: req.userId, real: bool((req.query as { real?: string }).real) });
  });

  app.get('/reports/yearly', async (req) => {
    const scope = scopeQuery(req.query, req.userId);
    const year = Number((req.query as { year?: string }).year ?? currentMonth().slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'Año inválido');
    const t = trend(`${year}-01`, `${year}-12`, { scope, currency: currencyQuery(req.query), viewer: req.userId, real: bool((req.query as { real?: string }).real) });
    const totals = t.rows.reduce(
      (acc, r) => {
        acc.income += r.income;
        acc.contributions += r.contributions;
        acc.expense += r.expense;
        for (const [k, v] of Object.entries(r.categories)) acc.categories[k] = (acc.categories[k] ?? 0) + v;
        return acc;
      },
      { income: 0, contributions: 0, expense: 0, categories: {} as Record<string, number> },
    );
    const net = totals.income + totals.contributions - totals.expense;
    const base = totals.income + Math.max(0, totals.contributions);
    return { year, ...t, totals: { ...totals, net, savings_rate: base > 0 ? Math.round((net / base) * 1000) / 10 : null } };
  });

  app.get('/reports/net-worth', async (req) => {
    const scope = scopeQuery(req.query, req.userId);
    const { from, to } = rangeQuery(req.query);
    return netWorth(from, to, { scope, currency: currencyQuery(req.query), viewer: req.userId });
  });

  app.get('/reports/per-person', async (req) => {
    const { from, to } = rangeQuery(req.query, 1);
    const users = loadUsers();
    const rows = perPerson(from, to, { currency: currencyQuery(req.query), viewer: req.userId });
    // A partner who keeps their dashboard private only shows their shared-expense figures.
    return rows.map((r) => {
      const u = users.find((x) => x.id === r.user_id)!;
      return r.user_id === req.userId || u.share_dashboard ? r : { ...r, personal: null, income: null, total: null };
    });
  });

  app.get('/reports/merchants', async (req) => {
    const scope = scopeQuery(req.query, req.userId);
    const { from, to } = rangeQuery(req.query, 3);
    return merchants(from, to, { scope, currency: currencyQuery(req.query), viewer: req.userId });
  });

  app.get('/reports/inflation', async (req) => {
    const scope = scopeQuery(req.query, req.userId);
    return inflationReport(monthQuery(req.query), { scope, viewer: req.userId });
  });

  // ---- Who owes whom (Splitwise-style) ----
  app.get('/balances', async (req) => {
    const accounts = loadAccounts();
    const shared = fetchTxs()
      .filter((t) => (t.is_shared || t.is_settlement) && t.status === 'confirmed' && t.date <= today() && txVisibility(t, req.userId, accounts) !== 'hidden')
      .slice(0, 100)
      .map((t) => presentTx(t, req.userId, accounts));
    return { balances: balances(), activity: shared };
  });

  // Records a settle-up payment between two people's accounts.
  app.post('/balances/settle', async (req) => {
    const s = parse(
      z.object({ from_account_id: z.number().int(), to_account_id: z.number().int(), amount: z.number().int().positive(), date: z.string().refine(isValidDate).optional(), note: z.string().max(200).optional() }),
      req.body,
    );
    const accounts = loadAccounts();
    const from = accounts.get(s.from_account_id);
    const to = accounts.get(s.to_account_id);
    if (!from || !to || from.owner_id == null || to.owner_id == null || from.owner_id === to.owner_id) {
      throw new HttpError(400, 'Elegí una cuenta personal de quien paga y otra de quien recibe.');
    }
    if (from.owner_id !== req.userId && to.owner_id !== req.userId) throw new HttpError(403, 'Solo podés registrar pagos en los que participás.');
    const tx = createTx(
      { type: 'transfer', date: s.date ?? today(), amount: s.amount, account_id: from.id, to_account_id: to.id, description: s.note || 'Saldar deudas', tags: [], is_shared: false, is_private: false, is_settlement: true },
      req.userId,
    );
    return presentTx(tx, req.userId, accounts);
  });

  // ---- Exchange rates and CPI ----
  app.get('/fx', async (req) => {
    const q = req.query as { from?: string; to?: string };
    const rows = db()
      .prepare('SELECT * FROM fx_rates WHERE date >= ? AND date <= ? ORDER BY date DESC')
      .all(q.from ?? addMonthsToMonth(currentMonth(), -2) + '-01', q.to ?? '9999-12-31');
    return { latest: latestRate(), rows };
  });

  app.post('/fx', async (req) => {
    const r = parse(z.object({ date: z.string().refine(isValidDate), buy: z.number().positive(), sell: z.number().positive() }), req.body);
    upsertRate(r.date, r.buy, r.sell, 'manual');
    return { ok: true };
  });

  app.post('/fx/refresh', async () => refreshRates());

  app.get('/cpi', async () => {
    const cpi = loadCpi();
    return { latest_month: cpi.latestMonth, rows: db().prepare('SELECT * FROM cpi_monthly ORDER BY month DESC LIMIT 36').all() };
  });

  app.post('/cpi', async (req) => {
    const r = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), pct: z.number().min(-50).max(100) }), req.body);
    db()
      .prepare(`INSERT INTO cpi_monthly (month, pct, source) VALUES (?, ?, 'manual') ON CONFLICT(month) DO UPDATE SET pct = excluded.pct, source = 'manual'`)
      .run(r.month, r.pct);
    return { ok: true };
  });

  app.post('/cpi/refresh', async () => refreshCpi());
}
