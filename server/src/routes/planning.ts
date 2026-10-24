import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { budgetStatus, indexBudgetsByCpi } from '../lib/budgets.js';
import { accountBalances, loadAccounts, loadUsers, parseScope, scopeVisible, type Scope } from '../lib/domain.js';
import { addMonthsToMonth, currentMonth, isValidDate, monthsBetween, today } from '../lib/dates.js';
import { loadConverter } from '../lib/fx.js';
import { categoryTotals } from '../lib/reports.js';
import { idParam, monthQuery, parse, scopeQuery } from './util.js';

const scopeField = z.string().refine((s) => parseScope(s) !== null, 'Ámbito inválido');

const budgetSchema = z.object({
  category_id: z.number().int(),
  scope: scopeField,
  amount: z.number().int().min(0),
  currency: z.enum(['ARS', 'USD']).default('ARS'),
});

const goalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  target_amount: z.number().int().positive(),
  currency: z.enum(['ARS', 'USD']).default('ARS'),
  deadline: z.string().refine(isValidDate, 'Fecha inválida').nullish(),
  account_id: z.number().int().nullish(),
  scope: scopeField.default('household'),
  color: z.string().max(20).nullish(),
  archived: z.boolean().default(false),
});

function assertScopeWritable(scope: Scope, viewer: number) {
  if (scope !== 'household' && scope !== `user:${viewer}`) throw new HttpError(403, 'Solo podés editar tus propios presupuestos y metas.');
}

export default async function planningRoutes(app: FastifyInstance) {
  // ---- Budgets ----
  app.get('/budgets', async (req) => {
    const scope = scopeQuery(req.query, req.userId);
    const month = monthQuery(req.query);
    return budgetStatus(month, scope, req.userId);
  });

  app.put('/budgets', async (req) => {
    const b = parse(budgetSchema, req.body);
    assertScopeWritable(b.scope as Scope, req.userId);
    const cat = db().prepare('SELECT kind FROM categories WHERE id = ?').get(b.category_id) as { kind: string } | undefined;
    if (cat?.kind !== 'expense') throw new HttpError(400, 'Solo se presupuestan categorías de gasto.');
    db()
      .prepare(
        `INSERT INTO budgets (category_id, scope, amount, currency) VALUES (?, ?, ?, ?)
         ON CONFLICT(category_id, scope) DO UPDATE SET amount = excluded.amount, currency = excluded.currency`,
      )
      .run(b.category_id, b.scope, b.amount, b.currency);
    return { ok: true };
  });

  app.delete('/budgets/:id', async (req) => {
    const id = idParam(req.params);
    const b = db().prepare('SELECT scope FROM budgets WHERE id = ?').get(id) as { scope: Scope } | undefined;
    if (!b) throw new HttpError(404, 'Presupuesto no encontrado');
    assertScopeWritable(b.scope, req.userId);
    db().prepare('DELETE FROM budgets WHERE id = ?').run(id);
    return { ok: true };
  });

  app.post('/budgets/index-cpi', async (req) => {
    const { scope } = parse(z.object({ scope: scopeField }), req.body);
    assertScopeWritable(scope as Scope, req.userId);
    return indexBudgetsByCpi(scope as Scope);
  });

  // Copies spending of the previous month as a starting point for budgets with no amount yet.
  app.post('/budgets/suggest', async (req) => {
    const { scope } = parse(z.object({ scope: scopeField }), req.body);
    assertScopeWritable(scope as Scope, req.userId);
    const months = [1, 2, 3].map((i) => addMonthsToMonth(currentMonth(), -i));
    const totals = months.map((m) => categoryTotals(m, scope as Scope, 'ARS', req.userId));
    const avg = new Map<number, number>();
    for (const t of totals) for (const [cat, v] of t) avg.set(cat, (avg.get(cat) ?? 0) + v / months.length);
    return [...avg.entries()].map(([category_id, amount]) => ({ category_id, amount: Math.round(amount / 100) * 100 }));
  });

  // ---- Goals ----
  app.get('/goals', async (req) => {
    const users = loadUsers();
    const accounts = loadAccounts();
    const balances = accountBalances(accounts);
    const fx = loadConverter();
    const goals = db().prepare('SELECT * FROM goals ORDER BY archived, deadline IS NULL, deadline, id').all() as (z.infer<typeof goalSchema> & {
      id: number;
      account_id: number | null;
    })[];
    const contrib = db().prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM goal_contributions WHERE goal_id = ?');
    return goals
      .filter((g) => scopeVisible(g.scope as Scope, req.userId, users))
      .map((g) => {
        const account = g.account_id ? accounts.get(g.account_id) : undefined;
        const saved = account
          ? (fx.convert(balances.get(account.id) ?? 0, account.currency, g.currency, today()) ?? 0)
          : (contrib.get(g.id) as { s: number }).s;
        const remaining = Math.max(0, g.target_amount - saved);
        const monthsLeft = g.deadline ? Math.max(1, monthsBetween(currentMonth(), g.deadline.slice(0, 7)) + 1) : null;
        return {
          ...g,
          saved,
          pct: Math.min(100, Math.round((saved / g.target_amount) * 1000) / 10),
          remaining,
          months_left: monthsLeft,
          monthly_needed: monthsLeft ? Math.ceil(remaining / monthsLeft) : null,
          account_name: account?.name ?? null,
        };
      });
  });

  const goalValues = (g: z.infer<typeof goalSchema>) => [
    g.name, g.target_amount, g.currency, g.deadline ?? null, g.account_id ?? null, g.scope, g.color ?? null, g.archived ? 1 : 0,
  ];

  app.post('/goals', async (req) => {
    const g = parse(goalSchema, req.body);
    assertScopeWritable(g.scope as Scope, req.userId);
    const id = db()
      .prepare('INSERT INTO goals (name, target_amount, currency, deadline, account_id, scope, color, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(...goalValues(g)).lastInsertRowid;
    return { id: Number(id) };
  });

  app.put('/goals/:id', async (req) => {
    const id = idParam(req.params);
    const g = parse(goalSchema, req.body);
    assertScopeWritable(g.scope as Scope, req.userId);
    db()
      .prepare('UPDATE goals SET name = ?, target_amount = ?, currency = ?, deadline = ?, account_id = ?, scope = ?, color = ?, archived = ? WHERE id = ?')
      .run(...goalValues(g), id);
    return { ok: true };
  });

  app.delete('/goals/:id', async (req) => {
    db().prepare('DELETE FROM goals WHERE id = ?').run(idParam(req.params));
    return { ok: true };
  });

  app.get('/goals/:id/contributions', async (req) =>
    db().prepare('SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC').all(idParam(req.params)),
  );

  app.post('/goals/:id/contributions', async (req) => {
    const goalId = idParam(req.params);
    const c = parse(z.object({ date: z.string().refine(isValidDate), amount: z.number().int(), note: z.string().max(200).nullish() }), req.body);
    const id = db()
      .prepare('INSERT INTO goal_contributions (goal_id, date, amount, note, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(goalId, c.date, c.amount, c.note ?? null, req.userId).lastInsertRowid;
    return { id: Number(id) };
  });

  app.delete('/goals/:goalId/contributions/:id', async (req) => {
    db().prepare('DELETE FROM goal_contributions WHERE id = ?').run(idParam(req.params));
    return { ok: true };
  });
}
