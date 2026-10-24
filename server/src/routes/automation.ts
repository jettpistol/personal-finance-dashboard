import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { accountVisible, fetchTxs, loadAccounts, txVisibility } from '../lib/domain.js';
import { applyRules, loadRules, ruleMatches, type Rule } from '../lib/rules.js';
import { generateDueRecurring, type Recurring } from '../lib/recurring.js';
import { assertWritable, splitSchema } from '../lib/transactions.js';
import { isValidDate } from '../lib/dates.js';
import { idParam, parse } from './util.js';

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  priority: z.number().int().default(0),
  match_type: z.enum(['contains', 'starts_with', 'equals', 'regex']),
  pattern: z.string().min(1).max(200),
  account_id: z.number().int().nullish(),
  amount_min: z.number().int().nullish(),
  amount_max: z.number().int().nullish(),
  set_type: z.enum(['expense', 'income', 'transfer']).nullish(),
  set_category_id: z.number().int().nullish(),
  set_merchant: z.string().max(120).nullish(),
  set_to_account_id: z.number().int().nullish(),
  set_shared: z.boolean().nullish(),
  set_tags: z.array(z.string()).nullish(),
  active: z.boolean().default(true),
});

const recurringSchema = z.object({
  description: z.string().trim().min(1).max(200),
  type: z.enum(['expense', 'income']),
  amount: z.number().int().positive(),
  account_id: z.number().int(),
  category_id: z.number().int().nullish(),
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(24).default(1),
  next_date: z.string().refine(isValidDate, 'Fecha inválida'),
  end_date: z.string().refine(isValidDate, 'Fecha inválida').nullish(),
  merchant: z.string().max(120).nullish(),
  notes: z.string().max(2000).nullish(),
  tags: z.array(z.string()).default([]),
  is_shared: z.boolean().default(false),
  split: splitSchema.nullish(),
  is_private: z.boolean().default(false),
  active: z.boolean().default(true),
});

function ruleRow(r: z.infer<typeof ruleSchema>) {
  if (r.match_type === 'regex') {
    try {
      new RegExp(r.pattern);
    } catch {
      throw new HttpError(400, 'La expresión regular no es válida.');
    }
  }
  return [
    r.name, r.priority, r.match_type, r.pattern, r.account_id ?? null, r.amount_min ?? null, r.amount_max ?? null,
    r.set_type ?? null, r.set_category_id ?? null, r.set_merchant || null, r.set_to_account_id ?? null,
    r.set_shared == null ? null : r.set_shared ? 1 : 0, r.set_tags?.length ? JSON.stringify(r.set_tags) : null, r.active ? 1 : 0,
  ];
}

const RULE_COLS = 'name, priority, match_type, pattern, account_id, amount_min, amount_max, set_type, set_category_id, set_merchant, set_to_account_id, set_shared, set_tags, active';

export default async function automationRoutes(app: FastifyInstance) {
  // ---- Categorisation rules ----
  app.get('/rules', async () =>
    (db().prepare('SELECT * FROM rules ORDER BY priority DESC, id').all() as Rule[]).map((r) => ({ ...r, set_tags: r.set_tags ? JSON.parse(r.set_tags) : [] })),
  );

  app.post('/rules', async (req) => {
    const r = parse(ruleSchema, req.body);
    const id = db().prepare(`INSERT INTO rules (${RULE_COLS}) VALUES (${RULE_COLS.split(',').map(() => '?').join(',')})`).run(...ruleRow(r)).lastInsertRowid;
    return { id: Number(id) };
  });

  app.put('/rules/:id', async (req) => {
    const id = idParam(req.params);
    const r = parse(ruleSchema, req.body);
    const sets = RULE_COLS.split(', ').map((c) => `${c} = ?`).join(', ');
    const res = db().prepare(`UPDATE rules SET ${sets} WHERE id = ?`).run(...ruleRow(r), id);
    if (!res.changes) throw new HttpError(404, 'Regla no encontrada');
    return { ok: true };
  });

  app.delete('/rules/:id', async (req) => {
    db().prepare('DELETE FROM rules WHERE id = ?').run(idParam(req.params));
    return { ok: true };
  });

  // Shows which existing transactions a (possibly unsaved) rule would match.
  app.post('/rules/test', async (req) => {
    const r = parse(ruleSchema, req.body);
    const rule = { id: 0, ...r, account_id: r.account_id ?? null, amount_min: r.amount_min ?? null, amount_max: r.amount_max ?? null } as unknown as Rule;
    const accounts = loadAccounts();
    const matches = fetchTxs()
      .filter((t) => (t.type === 'expense' || t.type === 'income') && txVisibility(t, req.userId, accounts) === 'full')
      .filter((t) => ruleMatches(rule, { description: t.description, amount: t.type === 'expense' ? -t.amount : t.amount, account_id: t.account_id }))
      .slice(0, 50)
      .map((t) => ({ id: t.id, date: t.date, description: t.description, amount: t.amount, currency: t.currency, category_id: t.category_id }));
    return { matches };
  });

  // Applies the rules' categories to existing uncategorised transactions.
  app.post('/rules/apply', async (req) => {
    const rules = loadRules();
    const accounts = loadAccounts();
    let changed = 0;
    const upd = db().prepare(`UPDATE transactions SET category_id = ?, merchant = COALESCE(?, merchant), updated_at = datetime('now') WHERE id = ?`);
    db().transaction(() => {
      for (const t of fetchTxs()) {
        if (t.category_id != null || (t.type !== 'expense' && t.type !== 'income')) continue;
        if (txVisibility(t, req.userId, accounts) !== 'full') continue;
        const patch = applyRules(rules, { description: t.description, amount: t.type === 'expense' ? -t.amount : t.amount, account_id: t.account_id });
        if (patch?.category_id == null) continue;
        const kind = db().prepare('SELECT kind FROM categories WHERE id = ?').get(patch.category_id) as { kind: string } | undefined;
        if (kind?.kind !== t.type) continue;
        upd.run(patch.category_id, patch.merchant ?? null, t.id);
        changed++;
      }
    })();
    return { changed };
  });

  // ---- Recurring transactions ----
  app.get('/recurring', async (req) => {
    const accounts = loadAccounts();
    const rows = db().prepare('SELECT * FROM recurring ORDER BY active DESC, next_date').all() as Recurring[];
    return rows
      .filter((r) => {
        const a = accounts.get(r.account_id);
        return a && accountVisible(a, req.userId) && !(r.is_private && a.owner_id !== req.userId);
      })
      .map((r) => ({ ...r, tags: JSON.parse(r.tags), split: r.split ? JSON.parse(r.split) : null, currency: accounts.get(r.account_id)!.currency }));
  });

  const writeRecurring = (r: z.infer<typeof recurringSchema>, viewer: number) => {
    const account = loadAccounts().get(r.account_id);
    if (!account || !accountVisible(account, viewer)) throw new HttpError(400, 'Cuenta inválida');
    assertWritable(account, viewer);
    return [
      r.description, r.type, r.amount, r.account_id, r.category_id ?? null, r.frequency, r.interval, r.next_date,
      Number(r.next_date.slice(8, 10)), r.end_date ?? null, r.merchant ?? null, r.notes ?? null, JSON.stringify(r.tags),
      r.is_shared && r.type === 'expense' ? 1 : 0, r.split ? JSON.stringify(r.split) : null, r.is_private ? 1 : 0, r.active ? 1 : 0,
    ];
  };
  const REC_COLS = 'description, type, amount, account_id, category_id, frequency, interval, next_date, day_of_month, end_date, merchant, notes, tags, is_shared, split, is_private, active';

  app.post('/recurring', async (req) => {
    const r = parse(recurringSchema, req.body);
    const values = writeRecurring(r, req.userId);
    const id = db()
      .prepare(`INSERT INTO recurring (${REC_COLS}, created_by) VALUES (${REC_COLS.split(',').map(() => '?').join(',')}, ?)`)
      .run(...values, req.userId).lastInsertRowid;
    await generateDueRecurring();
    return { id: Number(id) };
  });

  app.put('/recurring/:id', async (req) => {
    const id = idParam(req.params);
    const r = parse(recurringSchema, req.body);
    const values = writeRecurring(r, req.userId);
    const sets = REC_COLS.split(', ').map((c) => `${c} = ?`).join(', ');
    const res = db().prepare(`UPDATE recurring SET ${sets} WHERE id = ?`).run(...values, id);
    if (!res.changes) throw new HttpError(404, 'Recurrente no encontrado');
    await generateDueRecurring();
    return { ok: true };
  });

  app.delete('/recurring/:id', async (req) => {
    const id = idParam(req.params);
    db().transaction(() => {
      // Pending occurrences go with it; confirmed ones stay as history.
      db().prepare(`DELETE FROM transactions WHERE recurring_id = ? AND status = 'pending'`).run(id);
      db().prepare('DELETE FROM recurring WHERE id = ?').run(id);
    })();
    return { ok: true };
  });

  app.post('/recurring/run', async () => ({ created: await generateDueRecurring() }));
}
