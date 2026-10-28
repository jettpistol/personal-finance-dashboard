import { describe, expect, it } from 'vitest';
import { cpiPublishedOn, loanSchedule } from '../src/lib/loan-schedule.js';

// Lent 10 July, 3 monthly installments of $ 100 (in July pesos) from 10 October, tied to inflation.
const loan = { amount: 300_00, interest_rate: 0, installments: 3, first_due: '2026-10-10', due_on: null, lent_on: '2026-07-10', indexed: 1 };
const cpi = new Map([
  ['2026-07', 2],
  ['2026-08', 3],
  ['2026-09', 4],
  ['2026-10', 5],
  ['2026-11', 6],
]);

describe('loans tied to inflation', () => {
  it('a month counts from the 15th of the next one', () => {
    expect(cpiPublishedOn('2026-09')).toBe('2026-10-15');
    expect(cpiPublishedOn('2026-12')).toBe('2027-01-15');
  });

  it('applies the CPI from the loan to the month before each installment, carrying late months to the next one', () => {
    const s = loanSchedule(loan, 0, cpi, '2026-10-20');
    // 10 Oct: July and August were out (September's came on the 15th): 100 × 1,02 × 1,03.
    expect(s[0]).toMatchObject({ due: '2026-10-10', amount: 105_06 });
    // 10 Nov: July to September (October's isn't out yet) = 1,092624, plus September for the first one: 100 × (1,092624 − 1,0506).
    expect(s[1]).toMatchObject({ due: '2026-11-10', amount: Math.round(10_926.24 + 420.24) });
    // 10 Dec: the same known months; nothing left to carry.
    expect(s[2]).toMatchObject({ due: '2026-12-10', amount: 109_26 });
  });

  it('adds a final adjustment for CPI published after the last installment', () => {
    // On 20 Dec, October's CPI (out 15 Nov) and November's (out 15 Dec) are known.
    const s = loanSchedule(loan, 0, cpi, '2026-12-20');
    expect(s).toHaveLength(4);
    expect(s[3]).toMatchObject({ adjustment: true, due: '2026-12-20' });
    expect(s[3].amount).toBeGreaterThan(0);
  });

  it('keeps the plan fixed without inflation, and handles weeks and days', () => {
    const fixed = loanSchedule({ ...loan, indexed: 0 }, 0, cpi, '2026-12-20');
    expect(fixed.map((i) => i.amount)).toEqual([100_00, 100_00, 100_00]);
    const weekly = loanSchedule({ ...loan, indexed: 0, first_due: '2026-10-01', period_unit: 'week', period_count: 2 }, 0);
    expect(weekly.map((i) => i.due)).toEqual(['2026-10-01', '2026-10-15', '2026-10-29']);
    const daily = loanSchedule({ ...loan, indexed: 0, first_due: '2026-10-01', period_unit: 'day', period_count: 10 }, 0);
    expect(daily.map((i) => i.due)).toEqual(['2026-10-01', '2026-10-11', '2026-10-21']);
    // Every 2 months, day 31 falls on the month's last day.
    const bimonthly = loanSchedule({ ...loan, indexed: 0, first_due: '2026-08-31', period_count: 2 }, 0);
    expect(bimonthly.map((i) => i.due)).toEqual(['2026-08-31', '2026-10-31', '2026-12-31']);
  });
});
