import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { budgetStatus, currentBaseMonth } from '../lib/budgets.js';
import { accountBalances, loadAccounts, loadUsers, parseScope, scopeVisible, type Scope } from '../lib/domain.js';
import { addMonthsToMonth, currentMonth, isValidDate, monthsBetween, today } from '../lib/dates.js';
import { loadConverter } from '../lib/fx.js';
import { categoryTotals } from '../lib/reports.js';
import { idParam, monthQuery, parse, scopeQuery } from './util.js';
import { removeStoredFile } from '../lib/undo.js';

const scopeField = z.string().refine((s) => parseScope(s) !== null, 'Ámbito inválido');

const budgetSchema = z.object({
  category_id: z.number().int(),
  scope: scopeField,
  amount: z.number().int().min(0),
  currency: z.enum(['ARS', 'USD']).default('ARS'),
});

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'El enlace tiene que empezar con http:// o https://');

// Empty text fields from the form mean "none".
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const goalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  target_amount: z.number().int().positive(),
  currency: z.enum(['ARS', 'USD']).default('ARS'),
  deadline: z.string().refine(isValidDate, 'Fecha inválida').nullish(),
  account_id: z.number().int().nullish(),
  scope: scopeField.default('household'),
  color: z.string().max(20).nullish(),
  archived: z.boolean().default(false),
  url: z.preprocess(blankToNull, httpUrl.nullish()),
  notes: z.preprocess(blankToNull, z.string().trim().max(500).nullish()),
  priority: z.enum(['high', 'medium', 'low']).nullish(),
});

// Goal pictures live next to the receipts, under DATA_DIR/goals (random file names, shared by all profiles).
const goalsDir = () => path.join(config.dataDir, 'goals');
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Inside an undoable action the picture goes to the trash first, so Deshacer can bring it back.
const removeGoalImage = (file: string | null | undefined) => {
  if (file) removeStoredFile(path.join(goalsDir(), path.basename(file)));
};

function assertScopeWritable(scope: Scope, viewer: number) {
  if (scope !== 'household' && scope !== `user:${viewer}`) throw new HttpError(403, 'Solo podés editar tus propios presupuestos y objetivos.');
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
        `INSERT INTO budgets (category_id, scope, amount, currency, base_month) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(category_id, scope) DO UPDATE SET amount = excluded.amount, currency = excluded.currency, base_month = excluded.base_month`,
      )
      .run(b.category_id, b.scope, b.amount, b.currency, currentBaseMonth());
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

  // Averages spending of the last three months as a starting point for budgets.
  app.post('/budgets/suggest', async (req) => {
    const { scope } = parse(z.object({ scope: scopeField }), req.body);
    assertScopeWritable(scope as Scope, req.userId);
    const months = [1, 2, 3].map((i) => addMonthsToMonth(currentMonth(), -i));
    const totals = months.map((m) => categoryTotals(m, scope as Scope, 'ARS', req.userId));
    const avg = new Map<number, number>();
    for (const t of totals) for (const [cat, v] of t) avg.set(cat, (avg.get(cat) ?? 0) + v / months.length);
    return [...avg.entries()].filter(([id]) => id > 0).map(([category_id, amount]) => ({ category_id, amount: Math.round(amount / 100) * 100 }));
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
      image_file: string | null;
    })[];
    const contrib = db().prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM goal_contributions WHERE goal_id = ?');
    return goals
      .filter((g) => scopeVisible(g.scope as Scope, req.userId, users))
      .map(({ image_file, ...g }) => {
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
          // Changes whenever the picture is replaced, so the browser cache never shows the old one.
          image_version: image_file ? path.parse(image_file).name : null,
        };
      });
  });

  const goalValues = (g: z.infer<typeof goalSchema>) => [
    g.name, g.target_amount, g.currency, g.deadline ?? null, g.account_id ?? null, g.scope, g.color ?? null, g.archived ? 1 : 0,
    g.url ?? null, g.notes ?? null, g.priority ?? null,
  ];

  app.post('/goals', async (req) => {
    const g = parse(goalSchema, req.body);
    assertScopeWritable(g.scope as Scope, req.userId);
    const id = db()
      .prepare('INSERT INTO goals (name, target_amount, currency, deadline, account_id, scope, color, archived, url, notes, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(...goalValues(g)).lastInsertRowid;
    return { id: Number(id) };
  });

  // Goals are writable by the viewer when they belong to the household or to the viewer.
  const visibleGoal = (id: number, viewer: number) => {
    const g = db().prepare('SELECT scope, image_file FROM goals WHERE id = ?').get(id) as { scope: Scope; image_file: string | null } | undefined;
    if (!g || !scopeVisible(g.scope, viewer, loadUsers())) throw new HttpError(404, 'Objetivo no encontrado');
    return g;
  };
  const writableGoal = (id: number, viewer: number) => {
    const g = visibleGoal(id, viewer);
    assertScopeWritable(g.scope, viewer);
    return g;
  };

  app.put('/goals/:id', async (req) => {
    const id = idParam(req.params);
    writableGoal(id, req.userId);
    const g = parse(goalSchema, req.body);
    assertScopeWritable(g.scope as Scope, req.userId);
    db()
      .prepare('UPDATE goals SET name = ?, target_amount = ?, currency = ?, deadline = ?, account_id = ?, scope = ?, color = ?, archived = ?, url = ?, notes = ?, priority = ? WHERE id = ?')
      .run(...goalValues(g), id);
    return { ok: true };
  });

  app.delete('/goals/:id', async (req) => {
    const id = idParam(req.params);
    const g = writableGoal(id, req.userId);
    db().prepare('DELETE FROM goals WHERE id = ?').run(id);
    removeGoalImage(g.image_file);
    return { ok: true };
  });

  // ---- Goal picture (same visibility as the goal; only editable goals take a new one) ----
  app.post('/goals/:id/image', async (req) => {
    const id = idParam(req.params);
    const g = writableGoal(id, req.userId);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Falta el archivo');
    const ext = IMAGE_TYPES[file.mimetype];
    if (!ext) throw new HttpError(400, 'Solo imágenes (JPG, PNG, WEBP).');
    const data = await file.toBuffer();
    if (data.length > config.maxReceiptBytes) throw new HttpError(400, 'La imagen supera los 3 MB.');
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.mkdirSync(goalsDir(), { recursive: true });
    fs.writeFileSync(path.join(goalsDir(), name), data);
    db().prepare('UPDATE goals SET image_file = ? WHERE id = ?').run(name, id);
    removeGoalImage(g.image_file);
    return { ok: true, image_version: path.parse(name).name };
  });

  app.get('/goals/:id/image', async (req, reply) => {
    const id = idParam(req.params);
    const g = visibleGoal(id, req.userId);
    const file = g.image_file ? path.join(goalsDir(), path.basename(g.image_file)) : null;
    if (!file || !fs.existsSync(file)) throw new HttpError(404, 'Sin imagen');
    const types: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    reply.header('content-type', types[file.split('.').pop()!] ?? 'application/octet-stream');
    reply.header('cache-control', 'private, max-age=86400');
    return reply.send(fs.createReadStream(file));
  });

  app.delete('/goals/:id/image', async (req) => {
    const id = idParam(req.params);
    const g = writableGoal(id, req.userId);
    db().prepare('UPDATE goals SET image_file = NULL WHERE id = ?').run(id);
    removeGoalImage(g.image_file);
    return { ok: true };
  });

  app.get('/goals/:id/contributions', async (req) => {
    const id = idParam(req.params);
    visibleGoal(id, req.userId);
    return db().prepare('SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC').all(id);
  });

  app.post('/goals/:id/contributions', async (req) => {
    const goalId = idParam(req.params);
    writableGoal(goalId, req.userId);
    const c = parse(z.object({ date: z.string().refine(isValidDate), amount: z.number().int(), note: z.string().max(200).nullish() }), req.body);
    const id = db()
      .prepare('INSERT INTO goal_contributions (goal_id, date, amount, note, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(goalId, c.date, c.amount, c.note ?? null, req.userId).lastInsertRowid;
    return { id: Number(id) };
  });

  app.delete('/goals/:goalId/contributions/:id', async (req) => {
    const goalId = idParam({ id: (req.params as { goalId: string }).goalId });
    writableGoal(goalId, req.userId);
    db().prepare('DELETE FROM goal_contributions WHERE id = ? AND goal_id = ?').run(idParam(req.params), goalId);
    return { ok: true };
  });
}
