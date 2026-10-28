import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { addDays, today } from '../lib/dates.js';
import { accountVisible, fetchTxs, getTx, loadAccounts, presentTx, txVisibility } from '../lib/domain.js';
import { completedItems, getCommitment, linkPending, pendingItems, sideOf } from '../lib/commitments.js';
import { idParam, parse } from './util.js';

// Pendientes: what each person still has to pay (Pagos) or collect (Cobros). Each user only sees
// what they're responsible for.

const commitmentSchema = z
  .object({
    kind: z.enum(['savings', 'owe']),
    title: z.string().trim().min(1).max(80),
    person: z.string().trim().max(80).nullish(),
    amount: z.number().int().positive(),
    currency: z.enum(['ARS', 'USD']),
    account_id: z.number().int().nullish(),
    day: z.number().int().min(1).max(31),
    start_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido'),
    months: z.number().int().min(1).max(240).nullish(),
    active: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    if (c.kind === 'savings' && !c.account_id) ctx.addIssue({ code: 'custom', path: ['account_id'], message: 'Elegí la cuenta de ahorro.' });
    if (c.kind === 'owe' && !c.person) ctx.addIssue({ code: 'custom', path: ['person'], message: 'Indicá a quién le pagás.' });
  });

const linkSchema = z.object({ transaction_id: z.number().int(), reason: z.string().trim().max(300).nullish() });

export default async function pendingRoutes(app: FastifyInstance) {
  app.get('/pending', async (req) => pendingItems(req.userId));

  // Counters: what's late or due today, for Pagos and Cobros (the sidebar shows the sum).
  app.get('/pending/summary', async (req) => {
    const items = pendingItems(req.userId).filter((i) => i.remaining > 0 && i.due <= today());
    const pay = items.filter((i) => sideOf(i.kind) === 'pay').length;
    return { due: items.length, overdue: items.filter((i) => i.status === 'overdue').length, pay, collect: items.length - pay };
  });

  app.get('/pending/completed', async (req) => completedItems(req.userId));

  const checkAccount = (c: z.infer<typeof commitmentSchema>, viewer: number) => {
    if (!c.account_id) return;
    const a = loadAccounts().get(c.account_id);
    if (!a || !accountVisible(a, viewer) || a.archived) throw new HttpError(400, 'Cuenta inválida.', 'account_id');
    if (a.currency !== c.currency) throw new HttpError(400, `La cuenta tiene que estar en ${c.currency}.`, 'account_id');
  };

  app.post('/commitments', async (req) => {
    const c = parse(commitmentSchema, req.body);
    checkAccount(c, req.userId);
    const id = db()
      .prepare('INSERT INTO commitments (owner_id, kind, title, person, amount, currency, account_id, day, start_month, months, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.userId, c.kind, c.title, c.person || null, c.amount, c.currency, c.account_id ?? null, c.day, c.start_month, c.months ?? null, c.active ? 1 : 0).lastInsertRowid;
    return { id: Number(id) };
  });

  app.put('/commitments/:id', async (req) => {
    const existing = getCommitment(idParam(req.params), req.userId);
    const c = parse(commitmentSchema, req.body);
    checkAccount(c, req.userId);
    db()
      .prepare('UPDATE commitments SET kind = ?, title = ?, person = ?, amount = ?, currency = ?, account_id = ?, day = ?, start_month = ?, months = ?, active = ? WHERE id = ?')
      .run(c.kind, c.title, c.person || null, c.amount, c.currency, c.account_id ?? null, c.day, c.start_month, c.months ?? null, c.active ? 1 : 0, existing.id);
    return { ok: true };
  });

  app.delete('/commitments/:id', async (req) => {
    const c = getCommitment(idParam(req.params), req.userId);
    db().prepare('DELETE FROM commitments WHERE id = ?').run(c.id);
    return { ok: true };
  });

  app.get('/commitments/:id', async (req) => getCommitment(idParam(req.params), req.userId));

  // Movements of the last 90 days that could pay this item: same currency, not linked yet, exact amounts first.
  app.get('/pending/:source/:id/candidates', async (req) => {
    const { source } = req.params as { source: string };
    const id = idParam(req.params);
    const item = pendingItems(req.userId).find((i) => i.source === source && i.id === id);
    if (!item) throw new HttpError(404, 'No encontrado');
    const accounts = loadAccounts();
    const linked = new Set(
      (db().prepare('SELECT transaction_id AS id FROM commitment_payments WHERE transaction_id IS NOT NULL UNION SELECT transaction_id FROM loan_returns WHERE transaction_id IS NOT NULL').all() as { id: number }[]).map(
        (r) => r.id,
      ),
    );
    const rows = fetchTxs({ from: addDays(today(), -90), status: 'confirmed' }).filter((t) => {
      if (linked.has(t.id) || txVisibility(t, req.userId, accounts) !== 'full') return false;
      if (item.kind === 'collect') return t.type === 'income' && t.currency === item.currency;
      if (item.kind === 'savings') return t.type === 'transfer' && t.to_account_id === item.account_id;
      return (t.type === 'expense' || t.type === 'transfer') && t.currency === item.currency && (!item.account_id || t.account_id === item.account_id);
    });
    const value = (t: (typeof rows)[number]) => (item.kind === 'savings' ? (t.to_amount ?? t.amount) : t.amount);
    rows.sort((a, b) => Math.abs(value(a) - item.remaining) - Math.abs(value(b) - item.remaining) || (a.date < b.date ? 1 : -1));
    return rows.slice(0, 30).map((t) => ({ ...presentTx(t, req.userId, accounts), value: value(t) }));
  });

  app.post('/pending/:source/:id/link', async (req) => {
    const { source } = req.params as { source: string };
    const id = idParam(req.params);
    const { transaction_id, reason } = parse(linkSchema, req.body);
    const tx = getTx(transaction_id);
    if (!tx || txVisibility(tx, req.userId, loadAccounts()) !== 'full') throw new HttpError(404, 'Movimiento no encontrado');
    linkPending(req.userId, source, id, tx, reason ?? null);
    return { ok: true };
  });

  // A payment typed by hand (no movement), e.g. paid in cash from outside the app. Same rules.
  app.post('/pending/commitment/:id/payments', async (req) => {
    const c = getCommitment(idParam(req.params), req.userId);
    const { amount, date, reason } = parse(z.object({ amount: z.number().int().positive(), date: z.string().default(() => today()), reason: z.string().trim().max(300).nullish() }), req.body);
    const item = pendingItems(req.userId).find((i) => i.source === 'commitment' && i.id === c.id);
    if (!item) throw new HttpError(400, 'Este compromiso todavía no empezó.');
    if (amount < item.remaining && !reason) throw new HttpError(400, 'Es un pago parcial: escribí por qué no se pagó todo.', 'reason');
    db()
      .prepare('INSERT INTO commitment_payments (commitment_id, month, transaction_id, amount, date, reason) VALUES (?, ?, NULL, ?, ?, ?)')
      .run(c.id, item.history[0].month, amount, date, reason || null);
    return { ok: true };
  });

  app.delete('/pending/payments/:id', async (req) => {
    const id = idParam(req.params);
    const row = db().prepare('SELECT p.id FROM commitment_payments p JOIN commitments c ON c.id = p.commitment_id WHERE p.id = ? AND c.owner_id = ?').get(id, req.userId);
    if (!row) throw new HttpError(404, 'Pago no encontrado');
    db().prepare('DELETE FROM commitment_payments WHERE id = ?').run(id);
    return { ok: true };
  });
}
