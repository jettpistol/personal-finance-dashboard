import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { isValidDate, today } from '../lib/dates.js';
import { idParam, parse } from './util.js';

// Deudores: what you lent to whom (money or things), what came back, and what is still out.
// Standalone for now: loans don't touch accounts, balances or reports. Each user only sees their own.

type LoanRow = {
  id: number;
  owner_id: number;
  person: string;
  kind: 'money' | 'item';
  item: string | null;
  amount: number | null;
  currency: 'ARS' | 'USD';
  lent_on: string;
  due_on: string | null;
  notes: string | null;
  closed_on: string | null;
  closed_reason: 'returned' | 'forgiven' | null;
  created_at: string;
};
type ReturnRow = { id: number; loan_id: number; date: string; amount: number | null; note: string | null };

const dateStr = z.string().refine(isValidDate, 'Fecha inválida');

const loanSchema = z
  .object({
    person: z.string().trim().min(1).max(80),
    kind: z.enum(['money', 'item']),
    item: z.string().trim().max(200).nullish(),
    amount: z.number().int().positive().nullish(),
    currency: z.enum(['ARS', 'USD']).default('ARS'),
    lent_on: dateStr,
    due_on: dateStr.nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .superRefine((l, ctx) => {
    if (l.kind === 'money' && !l.amount) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Indicá cuánto prestaste.' });
    if (l.kind === 'item' && !l.item) ctx.addIssue({ code: 'custom', path: ['item'], message: 'Indicá qué prestaste.' });
    if (l.due_on && l.due_on < l.lent_on) ctx.addIssue({ code: 'custom', path: ['due_on'], message: 'La fecha de devolución no puede ser anterior al préstamo.' });
  });

const returnSchema = z.object({
  date: dateStr.default(() => today()),
  amount: z.number().int().positive().nullish(),
  note: z.string().max(300).nullish(),
});

function own(id: number, viewer: number): LoanRow {
  const loan = db().prepare('SELECT * FROM loans WHERE id = ? AND owner_id = ?').get(id, viewer) as LoanRow | undefined;
  if (!loan) throw new HttpError(404, 'Préstamo no encontrado');
  return loan;
}

function present(loan: LoanRow, returns: ReturnRow[]) {
  const mine = returns.filter((r) => r.loan_id === loan.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const returned = mine.reduce((s, r) => s + (r.amount ?? 0), 0);
  const outstanding = loan.closed_on ? 0 : loan.kind === 'money' ? Math.max(0, (loan.amount ?? 0) - returned) : null;
  return {
    ...loan,
    returns: mine,
    returned,
    outstanding,
    overdue: !loan.closed_on && !!loan.due_on && loan.due_on < today(),
  };
}

/** Closes a money loan once returns cover it. */
function closeIfPaid(loan: LoanRow) {
  if (loan.kind !== 'money' || loan.closed_on) return;
  const { total } = db().prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM loan_returns WHERE loan_id = ?').get(loan.id) as { total: number };
  if (total >= (loan.amount ?? 0)) {
    const last = db().prepare('SELECT MAX(date) AS d FROM loan_returns WHERE loan_id = ?').get(loan.id) as { d: string };
    db().prepare(`UPDATE loans SET closed_on = ?, closed_reason = 'returned' WHERE id = ?`).run(last.d ?? today(), loan.id);
  }
}

export default async function loanRoutes(app: FastifyInstance) {
  app.get('/loans', async (req) => {
    const loans = db().prepare('SELECT * FROM loans WHERE owner_id = ? ORDER BY closed_on IS NOT NULL, lent_on DESC, id DESC').all(req.userId) as LoanRow[];
    const returns = db()
      .prepare('SELECT r.* FROM loan_returns r JOIN loans l ON l.id = r.loan_id WHERE l.owner_id = ?')
      .all(req.userId) as ReturnRow[];
    return loans.map((l) => present(l, returns));
  });

  app.post('/loans', async (req) => {
    const l = parse(loanSchema, req.body);
    const id = db()
      .prepare('INSERT INTO loans (owner_id, person, kind, item, amount, currency, lent_on, due_on, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.userId, l.person, l.kind, l.kind === 'item' ? l.item : l.item || null, l.kind === 'money' ? l.amount : null, l.currency, l.lent_on, l.due_on ?? null, l.notes || null)
      .lastInsertRowid;
    return { id: Number(id) };
  });

  app.put('/loans/:id', async (req) => {
    const loan = own(idParam(req.params), req.userId);
    const l = parse(loanSchema, req.body);
    db()
      .prepare('UPDATE loans SET person = ?, kind = ?, item = ?, amount = ?, currency = ?, lent_on = ?, due_on = ?, notes = ? WHERE id = ?')
      .run(l.person, l.kind, l.kind === 'item' ? l.item : l.item || null, l.kind === 'money' ? l.amount : null, l.currency, l.lent_on, l.due_on ?? null, l.notes || null, loan.id);
    closeIfPaid({ ...loan, ...l, amount: l.amount ?? null } as LoanRow);
    return { ok: true };
  });

  app.delete('/loans/:id', async (req) => {
    const loan = own(idParam(req.params), req.userId);
    db().prepare('DELETE FROM loans WHERE id = ?').run(loan.id);
    return { ok: true };
  });

  // A return: part of the money (or all of it), or the item back.
  app.post('/loans/:id/returns', async (req) => {
    const loan = own(idParam(req.params), req.userId);
    if (loan.closed_on) throw new HttpError(400, 'Este préstamo ya está saldado.');
    const r = parse(returnSchema, req.body);
    if (loan.kind === 'money') {
      if (!r.amount) throw new HttpError(400, 'Indicá cuánto te devolvieron.', 'amount');
      db().prepare('INSERT INTO loan_returns (loan_id, date, amount, note) VALUES (?, ?, ?, ?)').run(loan.id, r.date, r.amount, r.note || null);
      closeIfPaid(loan);
    } else {
      db().prepare('INSERT INTO loan_returns (loan_id, date, amount, note) VALUES (?, ?, NULL, ?)').run(loan.id, r.date, r.note || null);
      db().prepare(`UPDATE loans SET closed_on = ?, closed_reason = 'returned' WHERE id = ?`).run(r.date, loan.id);
    }
    return { ok: true };
  });

  app.delete('/loans/:id/returns/:returnId', async (req) => {
    const loan = own(idParam(req.params), req.userId);
    const returnId = Number((req.params as { returnId: string }).returnId);
    db().prepare('DELETE FROM loan_returns WHERE id = ? AND loan_id = ?').run(returnId, loan.id);
    db().prepare(`UPDATE loans SET closed_on = NULL, closed_reason = NULL WHERE id = ? AND closed_reason = 'returned'`).run(loan.id);
    closeIfPaid({ ...loan, closed_on: null });
    return { ok: true };
  });

  // Forgive what's left, or reopen a closed loan.
  app.post('/loans/:id/close', async (req) => {
    const loan = own(idParam(req.params), req.userId);
    const { reason } = parse(z.object({ reason: z.enum(['forgiven', 'reopen']) }), req.body);
    if (reason === 'reopen') {
      db().prepare('UPDATE loans SET closed_on = NULL, closed_reason = NULL WHERE id = ?').run(loan.id);
      if (loan.kind === 'item') db().prepare('DELETE FROM loan_returns WHERE loan_id = ?').run(loan.id);
    } else {
      db().prepare(`UPDATE loans SET closed_on = ?, closed_reason = 'forgiven' WHERE id = ?`).run(today(), loan.id);
    }
    return { ok: true };
  });
}
