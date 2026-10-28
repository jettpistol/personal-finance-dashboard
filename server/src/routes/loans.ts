import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { isValidDate, today } from '../lib/dates.js';
import { loadCpi } from '../lib/cpi.js';
import { loanSchedule, type LoanTerms } from '../lib/loan-schedule.js';
import { closeIfPaid, own, presentLoan, recordLoanReturn, type LoanRow, type ReturnRow } from '../lib/loans.js';
import { idParam, parse } from './util.js';

// Deudores: what you lent to whom (money or things), what came back, and what is still out.
// Standalone for now: loans don't touch accounts, balances or reports. Each user only sees their own.

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
    // Monthly interest (percent) and installments; fixed once the loan exists.
    interest_rate: z.number().min(0).max(50).nullish(),
    installments: z.number().int().min(1).max(60).nullish(),
    first_due: dateStr.nullish(),
    // Installments every N days, weeks or months (default: every month).
    period_unit: z.enum(['day', 'week', 'month']).nullish(),
    period_count: z.number().int().min(1).max(365).nullish(),
    // Tied to inflation: installments follow the CPI (the rate, if any, comes on top).
    indexed: z.boolean().nullish(),
  })
  .superRefine((l, ctx) => {
    if (l.kind === 'money' && !l.amount) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Indicá cuánto prestaste.' });
    if (l.kind === 'item' && !l.item) ctx.addIssue({ code: 'custom', path: ['item'], message: 'Indicá qué prestaste.' });
    if (l.due_on && l.due_on < l.lent_on) ctx.addIssue({ code: 'custom', path: ['due_on'], message: 'La fecha de devolución no puede ser anterior al préstamo.' });
    if (l.kind === 'item' && (l.interest_rate || (l.installments ?? 1) > 1)) ctx.addIssue({ code: 'custom', path: ['installments'], message: 'Los objetos no llevan interés ni cuotas.' });
    if (l.kind === 'item' && l.indexed) ctx.addIssue({ code: 'custom', path: ['indexed'], message: 'Los objetos no se ajustan por inflación.' });
    if ((l.interest_rate || l.indexed || (l.installments ?? 1) > 1) && !l.first_due) ctx.addIssue({ code: 'custom', path: ['first_due'], message: 'Indicá cuándo vence la primera cuota.' });
    if (l.first_due && l.first_due <= l.lent_on) ctx.addIssue({ code: 'custom', path: ['first_due'], message: 'La primera cuota tiene que ser después del préstamo.' });
  });

const returnSchema = z.object({
  date: dateStr.default(() => today()),
  amount: z.number().int().positive().nullish(),
  note: z.string().trim().max(300).nullish(),
  transaction_id: z.number().int().nullish(),
});

export default async function loanRoutes(app: FastifyInstance) {
  app.get('/loans', async (req) => {
    const loans = db().prepare('SELECT * FROM loans WHERE owner_id = ? ORDER BY closed_on IS NOT NULL, lent_on DESC, id DESC').all(req.userId) as LoanRow[];
    const returns = db()
      .prepare('SELECT r.* FROM loan_returns r JOIN loans l ON l.id = r.loan_id WHERE l.owner_id = ?')
      .all(req.userId) as ReturnRow[];
    return loans.map((l) => presentLoan(l, returns));
  });

  // A starting point for the interest: last month's inflation, so the money keeps its value.
  app.get('/loans/suggested-rate', async () => {
    const cpi = loadCpi();
    const month = cpi.latestMonth;
    return { month, monthly: month ? cpi.pct.get(month)! : null };
  });

  // What the plan would look like, for the form (CPI as published today). Nothing is saved.
  app.get('/loans/preview', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
    const terms: LoanTerms = {
      amount: num(q.amount),
      interest_rate: num(q.interest_rate),
      installments: num(q.installments),
      first_due: q.first_due && isValidDate(q.first_due) ? q.first_due : null,
      due_on: null,
      lent_on: q.lent_on && isValidDate(q.lent_on) ? q.lent_on : today(),
      period_unit: (['day', 'week', 'month'] as const).find((u) => u === q.period_unit) ?? null,
      period_count: num(q.period_count),
      indexed: q.indexed === '1',
    };
    if (!terms.amount || !terms.first_due || terms.first_due <= terms.lent_on) return { installments: [] };
    const plan = loanSchedule(terms, 0, terms.indexed ? loadCpi().pct : undefined, today());
    return { installments: plan.map(({ n, due, amount }) => ({ n, due, amount })) };
  });

  app.post('/loans', async (req) => {
    const l = parse(loanSchema, req.body);
    const scheduled = l.kind === 'money' && !!l.first_due;
    const terms = scheduled
      ? {
          interest_rate: l.interest_rate ?? 0,
          installments: l.installments ?? 1,
          first_due: l.first_due!,
          period_unit: l.period_unit && l.period_unit !== 'month' ? l.period_unit : null,
          period_count: l.period_count && l.period_count > 1 ? l.period_count : null,
          indexed: l.indexed ? 1 : 0,
        }
      : null;
    // Without inflation the amounts are known now; with it, they're worked out as the CPI comes out.
    const plan = terms ? loanSchedule({ amount: l.amount ?? 0, lent_on: l.lent_on, due_on: null, ...terms, indexed: 0 }, 0) : [];
    const id = db()
      .prepare(
        'INSERT INTO loans (owner_id, person, kind, item, amount, currency, lent_on, due_on, notes, interest_rate, installments, first_due, total, period_unit, period_count, indexed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        req.userId,
        l.person,
        l.kind,
        l.kind === 'item' ? l.item : l.item || null,
        l.kind === 'money' ? l.amount : null,
        l.currency,
        l.lent_on,
        plan.length ? plan.at(-1)!.due : (l.due_on ?? null),
        l.notes || null,
        terms?.interest_rate ?? null,
        terms?.installments ?? null,
        terms?.first_due ?? null,
        plan.length && !terms?.indexed ? plan.reduce((t, i) => t + i.amount, 0) : null,
        terms?.period_unit ?? null,
        terms?.period_count ?? null,
        terms?.indexed ?? 0,
      ).lastInsertRowid;
    return { id: Number(id) };
  });

  app.put('/loans/:id', async (req) => {
    const loan = own(idParam(req.params), req.userId);
    const l = parse(loanSchema, req.body);
    // Interest and installments are agreed once: amount, currency, dates and terms can't change afterwards.
    if (loan.first_due) {
      const changed =
        l.kind !== loan.kind || l.amount !== loan.amount || l.currency !== loan.currency || l.lent_on !== loan.lent_on ||
        (l.interest_rate ?? 0) !== (loan.interest_rate ?? 0) || (l.installments ?? 1) !== (loan.installments ?? 1) || (l.first_due ?? null) !== loan.first_due ||
        (l.period_unit && l.period_unit !== 'month' ? l.period_unit : null) !== loan.period_unit ||
        ((l.period_count ?? 1) > 1 ? l.period_count : null) !== loan.period_count ||
        (l.indexed ? 1 : 0) !== (loan.indexed ? 1 : 0);
      if (changed) throw new HttpError(400, 'El interés, la inflación y las cuotas quedaron fijos al crear el préstamo: solo se pueden cambiar la persona, el motivo y las notas.', 'interest_rate');
      db().prepare('UPDATE loans SET person = ?, item = ?, notes = ? WHERE id = ?').run(l.person, l.item || null, l.notes || null, loan.id);
      return { ok: true };
    }
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
      recordLoanReturn(loan, { date: r.date, amount: r.amount, note: r.note, transaction_id: r.transaction_id });
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
      const returns = db().prepare('SELECT * FROM loan_returns WHERE loan_id = ?').all(loan.id) as ReturnRow[];
      const forgiven = presentLoan(loan, returns).outstanding ?? 0;
      db().prepare(`UPDATE loans SET closed_on = ?, closed_reason = 'forgiven' WHERE id = ?`).run(today(), loan.id);
      return { ok: true, forgiven };
    }
    return { ok: true };
  });
}
