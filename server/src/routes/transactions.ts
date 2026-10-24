import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { fetchTxs, getTx, loadAccounts, loadCategories, parseScope, presentTx, scopeEntry, txVisibility, type Tx } from '../lib/domain.js';
import {
  assertWritable,
  createInstallmentPlan,
  createTx,
  installmentSchema,
  normaliseTx,
  txInputSchema,
  updateTx,
} from '../lib/transactions.js';
import { checkBudgetAlerts } from '../lib/budgets.js';
import { applyRules, loadRules } from '../lib/rules.js';
import { today } from '../lib/dates.js';
import { bool, idParam, parse } from './util.js';

const listQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  account_id: z.coerce.number().int().optional(),
  category_id: z.coerce.number().int().optional(),
  uncategorized: z.string().optional(),
  type: z.enum(['expense', 'income', 'transfer', 'adjustment']).optional(),
  status: z.enum(['confirmed', 'pending']).optional(),
  q: z.string().max(100).optional(),
  tag: z.string().max(40).optional(),
  shared: z.string().optional(),
  scope: z.string().optional(),
  installments: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(50),
});

function editable(id: number, viewer: number): Tx {
  const tx = getTx(id);
  const accounts = loadAccounts();
  if (!tx || txVisibility(tx, viewer, accounts) === 'hidden') throw new HttpError(404, 'Movimiento no encontrado');
  if (txVisibility(tx, viewer, accounts) !== 'full') throw new HttpError(403, 'Este movimiento está en una cuenta privada de tu pareja.');
  assertWritable(accounts.get(tx.account_id)!, viewer);
  return tx;
}

function afterWrite(tx: Tx) {
  // Fire and forget: alerts must never fail the request.
  checkBudgetAlerts(tx).catch((e) => console.error('budget alert failed', e));
}

export default async function transactionRoutes(app: FastifyInstance) {
  app.get('/transactions', async (req) => {
    const q = parse(listQuery, req.query);
    const accounts = loadAccounts();
    const cats = loadCategories();
    const scope = q.scope ? parseScope(q.scope) : null;
    const needle = q.q?.toLowerCase().trim();
    let rows = fetchTxs({ from: q.from, to: q.to, status: q.status }).filter((t) => txVisibility(t, req.userId, accounts) !== 'hidden');
    rows = rows.filter((t) => {
      if (q.account_id && t.account_id !== q.account_id && t.to_account_id !== q.account_id) return false;
      if (q.category_id && t.category_id !== q.category_id && cats.get(t.category_id ?? -1)?.parent_id !== q.category_id) return false;
      if (bool(q.uncategorized) && (t.category_id !== null || (t.type !== 'expense' && t.type !== 'income'))) return false;
      if (q.type && t.type !== q.type) return false;
      if (q.shared !== undefined && !!t.is_shared !== bool(q.shared)) return false;
      if (bool(q.installments) && !t.installment_plan_id) return false;
      if (q.tag && !(JSON.parse(t.tags) as string[]).includes(q.tag)) return false;
      if (needle && ![t.description, t.merchant, t.notes].some((f) => f?.toLowerCase().includes(needle))) return false;
      if (scope && !scopeEntry({ ...t, status: 'confirmed' }, scope, accounts)) return false;
      return true;
    });
    const total = rows.length;
    let income = 0;
    let expense = 0;
    for (const t of rows) {
      if (t.status !== 'confirmed' || t.currency !== 'ARS') continue;
      if (t.type === 'income') income += t.amount;
      if (t.type === 'expense') expense += t.amount;
    }
    const pageRows = rows.slice((q.page - 1) * q.page_size, q.page * q.page_size);
    return { total, page: q.page, page_size: q.page_size, totals_ars: { income, expense }, items: pageRows.map((t) => presentTx(t, req.userId, accounts)) };
  });

  app.get('/transactions/:id', async (req) => {
    const id = idParam(req.params);
    const tx = getTx(id);
    const accounts = loadAccounts();
    if (!tx || txVisibility(tx, req.userId, accounts) === 'hidden') throw new HttpError(404, 'Movimiento no encontrado');
    return presentTx(tx, req.userId, accounts);
  });

  // Rule suggestion while typing a description in the form.
  app.post('/transactions/suggest', async (req) => {
    const { description, amount, account_id } = parse(
      z.object({ description: z.string(), amount: z.number().int().default(0), account_id: z.number().int().nullish() }),
      req.body,
    );
    const patch = applyRules(loadRules(), { description, amount, account_id: account_id ?? null });
    if (patch) return patch;
    // Fall back to the category used last time for the same description.
    const last = db()
      .prepare(`SELECT category_id, merchant FROM transactions WHERE lower(description) = lower(?) AND category_id IS NOT NULL ORDER BY date DESC LIMIT 1`)
      .get(description.trim()) as { category_id: number; merchant: string | null } | undefined;
    return last ? { category_id: last.category_id, merchant: last.merchant ?? undefined } : {};
  });

  app.post('/transactions', async (req) => {
    const input = parse(txInputSchema, req.body);
    const tx = createTx(input, req.userId);
    afterWrite(tx);
    return presentTx(tx, req.userId, loadAccounts());
  });

  app.post('/transactions/installments', async (req) => {
    const input = parse(installmentSchema, req.body);
    const planId = createInstallmentPlan(input, req.userId);
    const first = fetchTxs().find((t) => t.installment_plan_id === planId && t.installment_number === 1);
    if (first) afterWrite(first);
    return { plan_id: planId };
  });

  app.put('/transactions/:id', async (req) => {
    const id = idParam(req.params);
    const existing = editable(id, req.userId);
    const input = parse(txInputSchema, req.body);
    const next = normaliseTx(input, req.userId, existing);
    db().transaction(() => updateTx(id, next))();
    const tx = getTx(id)!;
    afterWrite(tx);
    return presentTx(tx, req.userId, loadAccounts());
  });

  app.post('/transactions/:id/confirm', async (req) => {
    const id = idParam(req.params);
    const existing = editable(id, req.userId);
    const { amount, date } = parse(z.object({ amount: z.number().int().positive().optional(), date: z.string().optional() }), req.body ?? {});
    const input = parse(txInputSchema, {
      ...existing,
      tags: JSON.parse(existing.tags),
      is_shared: !!existing.is_shared,
      is_private: !!existing.is_private,
      is_settlement: !!existing.is_settlement,
      split: existing.is_shared
        ? existing.split_method === 'default' || existing.split_method === 'equal'
          ? { method: existing.split_method }
          : { method: 'exact', values: existing.splits.map((s) => ({ user_id: s.user_id, value: s.amount })) }
        : null,
      status: 'confirmed',
      amount: amount ?? existing.amount,
      date: date ?? existing.date,
    });
    // An exact split only adds up for the original amount; rescale it when the amount changed.
    if (input.split?.method === 'exact' && input.amount !== existing.amount) {
      input.split = { method: 'percent', values: existing.splits.map((s) => ({ user_id: s.user_id, value: (s.amount / existing.amount) * 100 })) };
    }
    db().transaction(() => updateTx(id, normaliseTx(input, req.userId, existing)))();
    const tx = getTx(id)!;
    afterWrite(tx);
    return presentTx(tx, req.userId, loadAccounts());
  });

  app.delete('/transactions/:id', async (req) => {
    const id = idParam(req.params);
    const tx = editable(id, req.userId);
    const all = bool((req.query as { all_installments?: string }).all_installments);
    if (all && tx.installment_plan_id) {
      db().prepare('DELETE FROM installment_plans WHERE id = ?').run(tx.installment_plan_id);
    } else {
      db().prepare('DELETE FROM transactions WHERE id = ?').run(id);
    }
    if (tx.receipt_file) fs.rm(path.join(config.receiptsDir, tx.receipt_file), { force: true }, () => {});
    return { ok: true };
  });

  app.post('/transactions/bulk', async (req) => {
    const { ids, action, category_id } = parse(
      z.object({ ids: z.array(z.number().int()).min(1).max(1000), action: z.enum(['delete', 'categorize']), category_id: z.number().int().nullish() }),
      req.body,
    );
    const cats = loadCategories();
    let changed = 0;
    db().transaction(() => {
      for (const id of ids) {
        const tx = editable(id, req.userId);
        if (action === 'delete') {
          db().prepare('DELETE FROM transactions WHERE id = ?').run(id);
        } else {
          const cat = category_id == null ? null : cats.get(category_id);
          if (category_id != null && (!cat || cat.kind !== tx.type)) continue;
          db().prepare(`UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE id = ?`).run(category_id ?? null, id);
        }
        changed++;
      }
    })();
    return { changed };
  });

  app.get('/tags', async () => {
    const rows = db().prepare(`SELECT DISTINCT value FROM transactions, json_each(transactions.tags) ORDER BY value`).all() as { value: string }[];
    return rows.map((r) => r.value);
  });

  app.get('/installments/upcoming', async (req) => {
    const accounts = loadAccounts();
    const rows = fetchTxs({ from: today() })
      .filter((t) => t.installment_plan_id && t.date > today() && txVisibility(t, req.userId, accounts) !== 'hidden');
    const byMonth = new Map<string, { month: string; ARS: number; USD: number; count: number }>();
    for (const t of rows) {
      const m = t.date.slice(0, 7);
      const e = byMonth.get(m) ?? { month: m, ARS: 0, USD: 0, count: 0 };
      e[t.currency] += t.amount;
      e.count++;
      byMonth.set(m, e);
    }
    const plans = db()
      .prepare(
        `SELECT p.*, COUNT(t.id) AS remaining, MIN(t.date) AS next_date, SUM(t.amount) AS remaining_amount, MAX(t.currency) AS currency, MAX(t.account_id) AS account_id
         FROM installment_plans p JOIN transactions t ON t.installment_plan_id = p.id AND t.date > ?
         GROUP BY p.id ORDER BY next_date`,
      )
      .all(today()) as { account_id: number }[];
    return {
      by_month: [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
      plans: plans.filter((p) => {
        const a = accounts.get(p.account_id);
        return a && (a.owner_id === null || a.owner_id === req.userId || !a.is_private);
      }),
    };
  });

  // ---- Receipts ----
  app.post('/transactions/:id/receipt', async (req) => {
    const id = idParam(req.params);
    const tx = editable(id, req.userId);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Falta el archivo');
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) throw new HttpError(400, 'Solo imágenes (JPG, PNG, WEBP) o PDF.');
    const data = await file.toBuffer();
    if (data.length > config.maxReceiptBytes) throw new HttpError(400, 'El comprobante supera los 3 MB.');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[file.mimetype];
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.mkdirSync(config.receiptsDir, { recursive: true });
    fs.writeFileSync(path.join(config.receiptsDir, name), data);
    if (tx.receipt_file) fs.rm(path.join(config.receiptsDir, tx.receipt_file), { force: true }, () => {});
    db().prepare('UPDATE transactions SET receipt_file = ? WHERE id = ?').run(name, id);
    return { ok: true };
  });

  app.get('/transactions/:id/receipt', async (req, reply) => {
    const id = idParam(req.params);
    const tx = getTx(id);
    if (!tx || txVisibility(tx, req.userId, loadAccounts()) !== 'full' || !tx.receipt_file) throw new HttpError(404, 'Sin comprobante');
    const file = path.join(config.receiptsDir, path.basename(tx.receipt_file));
    if (!fs.existsSync(file)) throw new HttpError(404, 'Sin comprobante');
    const types: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
    reply.header('content-type', types[file.split('.').pop()!] ?? 'application/octet-stream');
    reply.header('cache-control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(file));
  });

  app.delete('/transactions/:id/receipt', async (req) => {
    const id = idParam(req.params);
    const tx = editable(id, req.userId);
    if (tx.receipt_file) fs.rm(path.join(config.receiptsDir, tx.receipt_file), { force: true }, () => {});
    db().prepare('UPDATE transactions SET receipt_file = NULL WHERE id = ?').run(id);
    return { ok: true };
  });
}
