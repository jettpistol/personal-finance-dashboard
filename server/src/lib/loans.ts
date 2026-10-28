import { db } from '../db/index.js';
import { HttpError } from './http.js';
import { today } from './dates.js';
import { loanSchedule } from './loan-schedule.js';

// Loans in Deudores: what is owed back (with interest and installments when agreed) and returns.

export type LoanRow = {
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
  interest_rate: number | null;
  installments: number | null;
  first_due: string | null;
  total: number | null;
  created_at: string;
};
export type ReturnRow = { id: number; loan_id: number; date: string; amount: number | null; note: string | null; transaction_id: number | null };

/** Records a money return; a return smaller than what is due now needs a reason. Closes the loan when covered. */
export function recordLoanReturn(loan: LoanRow, r: { date: string; amount: number; note?: string | null; transaction_id?: number | null }) {
  const returns = db().prepare('SELECT * FROM loan_returns WHERE loan_id = ?').all(loan.id) as ReturnRow[];
  const view = presentLoan(loan, returns);
  const dueNow = view.next_installment?.remaining ?? view.outstanding ?? 0;
  if (r.amount < dueNow && !r.note) throw new HttpError(400, 'Es un pago parcial: escribí por qué no se devolvió todo.', 'note');
  db().prepare('INSERT INTO loan_returns (loan_id, date, amount, note, transaction_id) VALUES (?, ?, ?, ?, ?)').run(loan.id, r.date, r.amount, r.note || null, r.transaction_id ?? null);
  closeIfPaid(loan);
}

export function own(id: number, viewer: number): LoanRow {
  const loan = db().prepare('SELECT * FROM loans WHERE id = ? AND owner_id = ?').get(id, viewer) as LoanRow | undefined;
  if (!loan) throw new HttpError(404, 'Préstamo no encontrado');
  return loan;
}

/** What has to come back in total: the principal, plus interest when it was agreed. */
const owedTotal = (loan: Pick<LoanRow, 'amount' | 'total'>) => loan.total ?? loan.amount ?? 0;

export function presentLoan(loan: LoanRow, returns: ReturnRow[]) {
  const mine = returns.filter((r) => r.loan_id === loan.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const returned = mine.reduce((s, r) => s + (r.amount ?? 0), 0);
  const outstanding = loan.closed_on ? 0 : loan.kind === 'money' ? Math.max(0, owedTotal(loan) - returned) : null;
  const schedule = loan.kind === 'money' ? loanSchedule(loan, returned) : [];
  const next = loan.closed_on ? undefined : schedule.find((i) => i.remaining > 0);
  const dueDate = next?.due ?? loan.due_on;
  return {
    ...loan,
    returns: mine,
    returned,
    outstanding,
    schedule,
    next_installment: next ?? null,
    overdue: !loan.closed_on && !!dueDate && dueDate < today(),
  };
}

/** Closes a money loan once returns cover it. */
export function closeIfPaid(loan: LoanRow) {
  if (loan.kind !== 'money' || loan.closed_on) return;
  const { total } = db().prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM loan_returns WHERE loan_id = ?').get(loan.id) as { total: number };
  if (total >= owedTotal(loan)) {
    const last = db().prepare('SELECT MAX(date) AS d FROM loan_returns WHERE loan_id = ?').get(loan.id) as { d: string };
    db().prepare(`UPDATE loans SET closed_on = ?, closed_reason = 'returned' WHERE id = ?`).run(last.d ?? today(), loan.id);
  }
}
