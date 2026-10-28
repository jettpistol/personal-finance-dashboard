import { db } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from './http.js';
import { addMonthsToMonth, currentMonth, daysInMonth, today } from './dates.js';
import { getTx, loadAccounts, type Tx } from './domain.js';
import { formatMoney, type Currency } from './money.js';
import { notify } from './notify.js';
import { logAction } from './audit.js';
import { own, presentLoan, recordLoanReturn, type LoanRow, type ReturnRow } from './loans.js';

// Pendientes: things you have to do yourself each month (Pagos: move savings, pay someone back)
// and money people owe you on a schedule (Cobros: Deudores loans with dates). Each month expects an
// amount; what's missing rolls over to the next month and extra lowers it. A movement with the
// exact amount is linked on its own; a smaller one needs a reason.

export type Commitment = {
  id: number;
  owner_id: number;
  kind: 'savings' | 'owe';
  title: string;
  person: string | null;
  amount: number;
  currency: Currency;
  account_id: number | null;
  day: number;
  start_month: string;
  months: number | null;
  active: number;
  created_at: string;
};

type Payment = { id: number; commitment_id: number; month: string; transaction_id: number | null; amount: number; date: string; reason: string | null; auto: number };

export type Period = { month: string; due: string; expected: number; paid: number; remaining: number; status: 'done' | 'partial' | 'overdue' | 'pending'; payments: Payment[] };

export type PendingItem = {
  key: string;
  source: 'commitment' | 'loan';
  id: number;
  kind: 'savings' | 'owe' | 'collect';
  owner_id: number;
  title: string;
  person: string | null;
  currency: Currency;
  account_id: number | null;
  due: string;
  expected: number;
  paid: number;
  remaining: number;
  carried: number;
  status: Period['status'];
  finished: boolean;
  history: Period[];
};

const dueDate = (month: string, day: number) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`;
};

/** Month by month: expected (base plus what rolled over), paid and what's left. */
export function commitmentPeriods(c: Commitment, payments: Payment[], now = today()): Period[] {
  const last = c.months ? addMonthsToMonth(c.start_month, c.months - 1) : null;
  const end = last && last < currentMonth() ? last : currentMonth();
  const periods: Period[] = [];
  let carry = 0;
  for (let m = c.start_month; m <= end; m = addMonthsToMonth(m, 1)) {
    const mine = payments.filter((p) => p.month === m);
    const expected = Math.max(0, c.amount + carry);
    const paid = mine.reduce((s, p) => s + p.amount, 0);
    const remaining = expected - paid;
    const due = dueDate(m, c.day);
    const status: Period['status'] = remaining <= 0 ? 'done' : paid > 0 ? 'partial' : due < now ? 'overdue' : 'pending';
    periods.push({ month: m, due, expected, paid, remaining: Math.max(0, remaining), status, payments: mine });
    carry = remaining;
  }
  return periods;
}

function commitmentItem(c: Commitment, payments: Payment[]): PendingItem | null {
  const history = commitmentPeriods(c, payments.filter((p) => p.commitment_id === c.id));
  const open = history.at(-1);
  if (!open) return null;
  const ended = !!c.months && addMonthsToMonth(c.start_month, c.months - 1) <= open.month;
  // A partly paid month that is already over still shows as overdue: the rest is late.
  const status = open.status === 'partial' && open.due < today() ? 'overdue' : open.status;
  return {
    key: `c${c.id}`,
    source: 'commitment',
    id: c.id,
    kind: c.kind,
    owner_id: c.owner_id,
    title: c.title,
    person: c.person,
    currency: c.currency,
    account_id: c.account_id,
    due: open.due,
    expected: open.expected,
    paid: open.paid,
    remaining: open.remaining,
    carried: open.expected - c.amount,
    status,
    finished: ended && open.remaining <= 0,
    history: history.reverse(),
  };
}

function loanItem(loan: LoanRow, returns: ReturnRow[]): PendingItem | null {
  const v = presentLoan(loan, returns);
  if (loan.kind !== 'money' || loan.closed_on || !v.schedule.length) return null;
  const now = today();
  const next = v.next_installment;
  if (!next) return null;
  // Everything already due, or the next installment if nothing is late yet.
  const due = v.schedule.filter((i) => i.remaining > 0 && i.due <= now);
  const amount = due.length ? due.reduce((s, i) => s + i.remaining, 0) : next.remaining;
  const installment = due.length ? due[0] : next;
  const history: Period[] = v.schedule.map((i) => ({
    month: i.due.slice(0, 7),
    due: i.due,
    expected: i.amount,
    paid: i.paid,
    remaining: i.remaining,
    status: i.remaining <= 0 ? 'done' : i.paid > 0 ? 'partial' : i.due < now ? 'overdue' : 'pending',
    payments: [],
  }));
  return {
    key: `l${loan.id}`,
    source: 'loan',
    id: loan.id,
    kind: 'collect',
    owner_id: loan.owner_id,
    title: loan.item || (v.schedule.length > 1 ? `Préstamo en ${v.schedule.length} cuotas` : 'Préstamo'),
    person: loan.person,
    currency: loan.currency,
    account_id: null,
    due: installment.due,
    expected: due.length ? amount : next.amount,
    paid: due.length ? 0 : next.paid,
    remaining: amount,
    carried: due.length > 1 ? amount - due.at(-1)!.remaining : 0,
    status: installment.due < now ? 'overdue' : installment.paid > 0 ? 'partial' : 'pending',
    finished: false,
    history: history.reverse(),
  };
}

/** Pagos (savings, debts you pay) or Cobros (money owed to you). */
export const sideOf = (kind: PendingItem['kind']): 'pay' | 'collect' => (kind === 'collect' ? 'collect' : 'pay');

export type CompletedItem = { key: string; source: 'commitment' | 'loan'; id: number; kind: PendingItem['kind']; title: string; person: string | null; currency: Currency; total: number; completed_on: string; how: 'paid' | 'forgiven' };

/**
 * What's fully done: commitments whose last month is paid, and loans with dates that were
 * returned or forgiven. Newest first.
 */
export function completedItems(userId: number): CompletedItem[] {
  const out: CompletedItem[] = [];
  const commitments = db().prepare('SELECT * FROM commitments WHERE owner_id = ? AND months IS NOT NULL').all(userId) as Commitment[];
  const payments = db().prepare('SELECT * FROM commitment_payments ORDER BY date').all() as Payment[];
  for (const c of commitments) {
    const item = commitmentItem(c, payments);
    if (!item?.finished) continue;
    const mine = payments.filter((p) => p.commitment_id === c.id);
    out.push({ key: `c${c.id}`, source: 'commitment', id: c.id, kind: c.kind, title: c.title, person: c.person, currency: c.currency, total: mine.reduce((s, p) => s + p.amount, 0), completed_on: mine.at(-1)?.date ?? item.due, how: 'paid' });
  }
  const loans = db()
    .prepare(`SELECT * FROM loans WHERE owner_id = ? AND kind = 'money' AND closed_on IS NOT NULL AND (first_due IS NOT NULL OR due_on IS NOT NULL)`)
    .all(userId) as LoanRow[];
  const returns = db().prepare('SELECT * FROM loan_returns').all() as ReturnRow[];
  for (const l of loans) {
    const v = presentLoan(l, returns);
    out.push({ key: `l${l.id}`, source: 'loan', id: l.id, kind: 'collect', title: l.item || 'Préstamo', person: l.person, currency: l.currency, total: v.returned, completed_on: l.closed_on!, how: l.closed_reason === 'forgiven' ? 'forgiven' : 'paid' });
  }
  return out.sort((a, b) => (a.completed_on < b.completed_on ? 1 : -1));
}

/** Everything a user is responsible for, most urgent first. */
export function pendingItems(userId: number | null): PendingItem[] {
  const commitments = db()
    .prepare(`SELECT * FROM commitments WHERE active = 1 ${userId === null ? '' : 'AND owner_id = ?'}`)
    .all(...(userId === null ? [] : [userId])) as Commitment[];
  const payments = db().prepare('SELECT * FROM commitment_payments ORDER BY date').all() as Payment[];
  const loans = db()
    .prepare(`SELECT * FROM loans WHERE kind = 'money' AND closed_on IS NULL AND (first_due IS NOT NULL OR due_on IS NOT NULL) ${userId === null ? '' : 'AND owner_id = ?'}`)
    .all(...(userId === null ? [] : [userId])) as LoanRow[];
  const returns = db().prepare('SELECT * FROM loan_returns').all() as ReturnRow[];
  const rank = { overdue: 0, partial: 1, pending: 2, done: 3 } as const;
  return [...commitments.map((c) => commitmentItem(c, payments)), ...loans.map((l) => loanItem(l, returns))]
    .filter((i): i is PendingItem => !!i)
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.due < b.due ? -1 : 1));
}

export function getCommitment(id: number, viewer: number): Commitment {
  const c = db().prepare('SELECT * FROM commitments WHERE id = ? AND owner_id = ?').get(id, viewer) as Commitment | undefined;
  if (!c) throw new HttpError(404, 'Compromiso no encontrado');
  return c;
}

/** How much of a movement counts towards a commitment, in its currency (null if it can't count). */
function contribution(c: Commitment, tx: Tx): number | null {
  if (tx.status !== 'confirmed') return null;
  const accounts = loadAccounts();
  if (c.kind === 'savings') {
    if (tx.type !== 'transfer' || tx.to_account_id == null || tx.to_account_id !== c.account_id) return null;
    const dest = accounts.get(tx.to_account_id);
    return dest?.currency === c.currency ? (tx.to_amount ?? tx.amount) : null;
  }
  if (tx.type !== 'expense' && tx.type !== 'transfer') return null;
  if (tx.currency !== c.currency) return null;
  if (c.account_id && tx.account_id !== c.account_id) return null;
  return tx.amount;
}

/** Links a movement to a commitment's open month. A smaller amount needs a reason. */
export function linkToCommitment(c: Commitment, tx: Tx, reason: string | null, auto = false) {
  const amount = contribution(c, tx);
  if (amount === null) {
    throw new HttpError(
      400,
      c.kind === 'savings' ? `Tiene que ser una transferencia hacia la cuenta del ahorro, en ${c.currency}.` : `Tiene que ser un gasto o una transferencia en ${c.currency}.`,
    );
  }
  if (db().prepare('SELECT 1 FROM commitment_payments WHERE transaction_id = ? UNION SELECT 1 FROM loan_returns WHERE transaction_id = ?').get(tx.id, tx.id))
    throw new HttpError(409, 'Ese movimiento ya está vinculado.');
  const payments = db().prepare('SELECT * FROM commitment_payments WHERE commitment_id = ?').all(c.id) as Payment[];
  const open = commitmentPeriods(c, payments).at(-1);
  if (!open) throw new HttpError(400, 'Este compromiso todavía no empezó.');
  if (amount < open.remaining && !reason?.trim()) throw new HttpError(400, 'Es un pago parcial: escribí por qué no se pagó todo.', 'reason');
  db()
    .prepare('INSERT INTO commitment_payments (commitment_id, month, transaction_id, amount, date, reason, auto) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(c.id, open.month, tx.id, amount, tx.date, reason?.trim() || null, auto ? 1 : 0);
}

/**
 * Links a movement to one pending item (from Registrar or from picking an existing movement).
 * Partial amounts need a reason (field "reason"). Throws a readable error if it can't count.
 */
export function linkPending(viewer: number, source: string, id: number, tx: Tx, reason: string | null) {
  if (source === 'commitment') return linkToCommitment(getCommitment(id, viewer), tx, reason);
  if (source !== 'loan') throw new HttpError(404, 'No encontrado');
  const loan = own(id, viewer);
  if (tx.type !== 'income') throw new HttpError(400, 'Tiene que ser un ingreso: la plata que te devolvieron.');
  if (tx.status !== 'confirmed') throw new HttpError(400, 'El movimiento tiene que estar confirmado.');
  if (tx.currency !== loan.currency) throw new HttpError(400, `Tiene que ser en ${loan.currency}, la moneda del préstamo.`);
  if (db().prepare('SELECT 1 FROM loan_returns WHERE transaction_id = ? UNION SELECT 1 FROM commitment_payments WHERE transaction_id = ?').get(tx.id, tx.id))
    throw new HttpError(409, 'Ese movimiento ya está vinculado.');
  try {
    recordLoanReturn(loan, { date: tx.date, amount: tx.amount, note: reason?.trim() || null, transaction_id: tx.id });
  } catch (e) {
    // The loan calls it "note"; for the form it's the same reason field.
    if (e instanceof HttpError && e.field === 'note') throw new HttpError(e.status, e.message, 'reason');
    throw e;
  }
}

/**
 * After a movement is saved: if it has exactly the amount a commitment or a loan installment is
 * waiting for (same currency, right account), link it. Never throws.
 */
export function autoLink(txId: number) {
  try {
    const tx = getTx(txId);
    if (!tx || tx.status !== 'confirmed') return;
    if (db().prepare('SELECT 1 FROM commitment_payments WHERE transaction_id = ? UNION SELECT 1 FROM loan_returns WHERE transaction_id = ?').get(tx.id, tx.id)) return;
    const owner = loadAccounts().get(tx.account_id)?.owner_id ?? null;
    const responsible = new Set([owner, tx.created_by].filter((x): x is number => x != null));
    for (const item of pendingItems(null)) {
      if (!responsible.has(item.owner_id) || item.remaining <= 0) continue;
      if (item.source === 'commitment') {
        const c = db().prepare('SELECT * FROM commitments WHERE id = ?').get(item.id) as Commitment;
        const amount = contribution(c, tx);
        if (amount === null || (amount !== item.remaining && amount !== c.amount)) continue;
        linkToCommitment(c, tx, amount < item.remaining ? 'Pago del monto mensual (lo anterior queda pendiente)' : null, true);
        logAction({
          userId: tx.created_by,
          section: 'Pendientes',
          action: 'vincular',
          summary: `Vinculó automáticamente ${formatMoney(amount, c.currency)} a «${c.title}» (monto exacto)`,
          entity: 'commitment',
          entityId: c.id,
          details: { transaction_id: tx.id, amount, remaining_before: item.remaining },
          // Pendientes are each person's own: so is their log.
          privateTo: item.owner_id,
        });
        return;
      }
      // Money that came back from a loan: an income in the lender's account.
      if (tx.type !== 'income' || tx.currency !== item.currency || owner !== item.owner_id) continue;
      const loan = db().prepare('SELECT * FROM loans WHERE id = ?').get(item.id) as LoanRow;
      const installment = presentLoan(loan, db().prepare('SELECT * FROM loan_returns WHERE loan_id = ?').all(loan.id) as ReturnRow[]).next_installment;
      if (tx.amount !== item.remaining && tx.amount !== installment?.remaining) continue;
      recordLoanReturn(loan, { date: tx.date, amount: tx.amount, note: tx.amount < item.remaining ? 'Cuota cobrada (lo anterior queda pendiente)' : null, transaction_id: tx.id });
      logAction({
        userId: tx.created_by,
        section: 'Pendientes',
        action: 'vincular',
        summary: `Vinculó automáticamente el cobro de ${formatMoney(tx.amount, loan.currency)} de ${loan.person} a «${item.title}» (monto exacto)`,
        entity: 'loan',
        entityId: loan.id,
        details: { transaction_id: tx.id, amount: tx.amount, remaining_before: item.remaining },
        privateTo: item.owner_id,
      });
      return;
    }
  } catch (e) {
    console.error('autoLink failed', e);
  }
}

/** The local hour in the household's timezone. */
function localHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: config.timezone }).format(now));
}

/**
 * Chases whoever is responsible for anything due and unpaid: every day from 8 to 18, at most
 * once per 4-hour slot (around 8, 12 and 16), by the bell and email, until it's done.
 */
export async function sendPendingReminders(now = new Date()) {
  const hour = localHour(now);
  if (hour < 8 || hour >= 18) return;
  const slot = `${today(now)}:${Math.floor((hour - 8) / 4)}`;
  const seen = db().prepare('INSERT OR IGNORE INTO reminders_sent (key, sent_at) VALUES (?, ?)');
  for (const item of pendingItems(null)) {
    if (item.remaining <= 0 || item.due > today(now)) continue;
    if (!seen.run(`${item.key}:${slot}`, now.toISOString()).changes) continue;
    const what =
      item.kind === 'savings' ? `Pasá ${formatMoney(item.remaining, item.currency)} a tu ahorro` : item.kind === 'owe' ? `Pagale ${formatMoney(item.remaining, item.currency)} a ${item.person ?? 'quien corresponde'}` : `${item.person} te debe ${formatMoney(item.remaining, item.currency)}`;
    await notify({
      kind: 'pending',
      users: [item.owner_id],
      title: `Pendiente: ${item.title}`,
      body: `${what}. ${item.due < today(now) ? `Venció el ${item.due.split('-').reverse().slice(0, 2).join('/')}.` : 'Vence hoy.'}`,
      link: '/pendientes',
    });
  }
}
