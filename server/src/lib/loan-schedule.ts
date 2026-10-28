import { addDays, addMonths, addMonthsToMonth, monthsBetween } from './dates.js';
import { allocate } from './money.js';

// What a loan has to come back as: one or more installments, with interest if it was agreed.
// With a rate r per installment period and n installments the payment is the usual fixed one
// (French system): P * r / (1 - (1 + r)^-n). Without interest the principal is split in equal parts.
//
// Installments fall every N months (the default, 1), weeks or days from the first one.
//
// A loan tied to inflation keeps those amounts in pesos of the month it was lent and multiplies
// each installment by the CPI of the months from the loan up to the month before it's due (lent in
// October, due in January: October, November and December). A month's CPI comes out around the
// 15th of the next month; whatever wasn't published by an installment's due date is added to the
// next installment once it is (or to a final adjustment after the last one).

export type Installment = { n: number; due: string; amount: number; paid: number; remaining: number; adjustment?: boolean };
export type PeriodUnit = 'day' | 'week' | 'month';

/** Monthly CPI in percent by month, as far as it's published. */
export type CpiSource = Map<string, number>;

/** When a month's CPI is taken as known: the 15th of the following month. */
export const cpiPublishedOn = (month: string) => `${addMonthsToMonth(month, 1)}-15`;

/** Length of one installment period, in months (a week is 7/30 of a month). */
export function periodMonths(unit: PeriodUnit | null | undefined, count: number | null | undefined): number {
  const c = Math.max(1, count ?? 1);
  return unit === 'day' ? c / 30 : unit === 'week' ? (7 * c) / 30 : c;
}

/** Due date of installment i (0-based) from the first one. */
export function dueDate(first: string, i: number, unit: PeriodUnit | null | undefined, count: number | null | undefined): string {
  const c = Math.max(1, count ?? 1);
  if (unit === 'day') return addDays(first, i * c);
  if (unit === 'week') return addDays(first, i * 7 * c);
  return addMonths(first, i * c, Number(first.slice(8, 10)));
}

/**
 * Fixed installment amounts (cents) for a principal at a monthly rate (percent) over n periods of
 * `period` months each. A single payment accrues compound interest for the months until it is due.
 */
export function installmentAmounts(principal: number, monthlyRatePct: number, n: number, monthsToFirst = 1, period = 1): number[] {
  const monthly = monthlyRatePct / 100;
  if (n <= 1) return [Math.round(principal * Math.pow(1 + monthly, Math.max(1, monthsToFirst)))];
  const r = Math.pow(1 + monthly, period) - 1;
  if (!r) return allocate(principal, Array(n).fill(1));
  const payment = (principal * r) / (1 - Math.pow(1 + r, -n));
  const each = Math.round(payment);
  return Array.from({ length: n }, () => each);
}

/** CPI factor for the months [from, to] (inclusive) whose index was published by `asOf`. */
function factor(cpi: CpiSource, from: string, to: string, asOf: string): number {
  let f = 1;
  for (let m = from; m <= to; m = addMonthsToMonth(m, 1)) {
    const pct = cpi.get(m);
    if (pct !== undefined && cpiPublishedOn(m) <= asOf) f *= 1 + pct / 100;
  }
  return f;
}

export type LoanTerms = {
  amount: number | null;
  interest_rate: number | null;
  installments: number | null;
  first_due: string | null;
  due_on: string | null;
  lent_on: string;
  period_unit?: PeriodUnit | null;
  period_count?: number | null;
  indexed?: number | boolean | null;
};

/**
 * What each installment is worth today. For an indexed loan, also whether some month it depends
 * on hasn't been published yet (the amounts can still grow).
 */
export function loanAmounts(loan: LoanTerms, cpi: CpiSource = new Map(), today = new Date().toISOString().slice(0, 10)) {
  const principal = loan.amount ?? 0;
  const n = loan.installments ?? 1;
  const first = loan.first_due ?? loan.due_on;
  if (!first) return { dues: [] as string[], amounts: [] as number[], pendingCpi: false };
  const unit = loan.period_unit ?? 'month';
  const dues = Array.from({ length: n }, (_, i) => dueDate(first, i, unit, loan.period_count));
  const base = installmentAmounts(principal, loan.interest_rate ?? 0, n, monthsBetween(loan.lent_on.slice(0, 7), first.slice(0, 7)), periodMonths(unit, loan.period_count));
  if (!loan.indexed) return { dues, amounts: base, pendingCpi: false };

  const from = loan.lent_on.slice(0, 7);
  const lastMonth = (due: string) => addMonthsToMonth(due.slice(0, 7), -1);
  // Each installment is set with what's published when it falls due (today, for future ones).
  const asOf = dues.map((d) => (d < today ? d : today));
  const amounts = base.map((b, i) => {
    let amount = b * factor(cpi, from, lastMonth(dues[i]), asOf[i]);
    // Inflation of earlier installments that came out after they were due is collected now.
    if (i > 0) for (let j = 0; j < i; j++) amount += base[j] * (factor(cpi, from, lastMonth(dues[j]), asOf[i]) - factor(cpi, from, lastMonth(dues[j]), asOf[i - 1]));
    return Math.round(amount);
  });
  // After the last installment: what was published later becomes one final adjustment.
  const last = asOf.at(-1)!;
  let extra = 0;
  if (last < today) for (let j = 0; j < n; j++) extra += base[j] * (factor(cpi, from, lastMonth(dues[j]), today) - factor(cpi, from, lastMonth(dues[j]), last));
  const pendingCpi = dues.some((d) => {
    for (let m = from; m <= lastMonth(d); m = addMonthsToMonth(m, 1)) if (!cpi.has(m) || cpiPublishedOn(m) > today) return true;
    return false;
  });
  if (Math.round(extra) > 0) {
    amounts.push(Math.round(extra));
    dues.push(today > dues.at(-1)! ? today : dues.at(-1)!);
  }
  return { dues, amounts, pendingCpi, adjustment: Math.round(extra) > 0 };
}

/** The installments of a money loan, with returns applied to the oldest first. */
export function loanSchedule(loan: LoanTerms, returned: number, cpi?: CpiSource, today?: string): Installment[] {
  const { dues, amounts, adjustment } = loanAmounts(loan, cpi, today) as ReturnType<typeof loanAmounts> & { adjustment?: boolean };
  let left = returned;
  return amounts.map((amount, i) => {
    const paid = Math.min(amount, Math.max(0, left));
    left -= paid;
    return { n: i + 1, due: dues[i], amount, paid, remaining: amount - paid, ...(adjustment && i === amounts.length - 1 ? { adjustment: true } : {}) };
  });
}
