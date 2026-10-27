import { addMonths, monthsBetween } from './dates.js';
import { allocate } from './money.js';

// What a loan has to come back as: one or more installments, with interest if it was agreed.
// With a monthly rate r and n installments the payment is the usual fixed one (French system):
// P * r / (1 - (1 + r)^-n). Without interest the principal is split in equal parts.

export type Installment = { n: number; due: string; amount: number; paid: number; remaining: number };

/**
 * Fixed installment amounts (cents) for a principal at a monthly rate (percent) over n months.
 * A single payment accrues compound interest for the months until it is due.
 */
export function installmentAmounts(principal: number, monthlyRatePct: number, n: number, monthsToFirst = 1): number[] {
  const r = monthlyRatePct / 100;
  if (n <= 1) return [Math.round(principal * Math.pow(1 + r, Math.max(1, monthsToFirst)))];
  if (!r) return allocate(principal, Array(n).fill(1));
  const payment = (principal * r) / (1 - Math.pow(1 + r, -n));
  const each = Math.round(payment);
  return Array.from({ length: n }, () => each);
}

/** The installments of a money loan, with returns applied to the oldest first. */
export function loanSchedule(
  loan: { amount: number | null; interest_rate: number | null; installments: number | null; first_due: string | null; due_on: string | null; lent_on: string },
  returned: number,
): Installment[] {
  const principal = loan.amount ?? 0;
  const n = loan.installments ?? 1;
  const first = loan.first_due ?? loan.due_on;
  if (!first) return [];
  const amounts = installmentAmounts(principal, loan.interest_rate ?? 0, n, monthsBetween(loan.lent_on.slice(0, 7), first.slice(0, 7)));
  const day = Number(first.slice(8, 10));
  let left = returned;
  return amounts.map((amount, i) => {
    const paid = Math.min(amount, Math.max(0, left));
    left -= paid;
    return { n: i + 1, due: addMonths(first, i, day), amount, paid, remaining: amount - paid };
  });
}
