import { db } from '../db/index.js';
import { addDays, addMonths, today } from './dates.js';
import { normaliseTx, insertTx, type SplitInput } from './transactions.js';
import { notify } from './notify.js';
import { formatMoney } from './money.js';
import { loadAccounts } from './domain.js';

export type Recurring = {
  id: number;
  description: string;
  type: 'expense' | 'income';
  amount: number;
  account_id: number;
  category_id: number | null;
  frequency: 'weekly' | 'monthly' | 'yearly';
  interval: number;
  next_date: string;
  day_of_month: number;
  end_date: string | null;
  merchant: string | null;
  notes: string | null;
  tags: string;
  paid_by: number | null;
  is_shared: number;
  split: string | null;
  is_private: number;
  active: number;
  created_by: number;
};

export function advance(date: string, frequency: Recurring['frequency'], interval: number, anchorDay?: number): string {
  switch (frequency) {
    case 'weekly':
      return addDays(date, 7 * interval);
    case 'monthly':
      return addMonths(date, interval, anchorDay);
    case 'yearly':
      return addMonths(date, 12 * interval, anchorDay);
  }
}

/**
 * Creates a pending transaction for every due occurrence. Pending transactions don't count
 * in totals until someone confirms them (and adjusts the amount if the bill changed).
 */
export async function generateDueRecurring(asOf = today()): Promise<number> {
  const due = db().prepare('SELECT * FROM recurring WHERE active = 1 AND next_date <= ?').all(asOf) as Recurring[];
  let created = 0;
  const accounts = loadAccounts();
  for (const r of due) {
    let next = r.next_date;
    const newOnes: string[] = [];
    db().transaction(() => {
      while (next <= asOf && (!r.end_date || next <= r.end_date)) {
        const tx = normaliseTx(
          {
            type: r.type,
            status: 'pending',
            date: next,
            amount: r.amount,
            account_id: r.account_id,
            category_id: r.category_id,
            description: r.description,
            merchant: r.merchant,
            notes: r.notes,
            tags: JSON.parse(r.tags),
            is_shared: !!r.is_shared,
            split: r.split ? (JSON.parse(r.split) as SplitInput) : null,
            is_private: !!r.is_private,
          },
          r.created_by,
        );
        insertTx({ ...tx, recurring_id: r.id });
        newOnes.push(next);
        next = advance(next, r.frequency, r.interval, r.frequency === 'weekly' ? undefined : r.day_of_month);
      }
      const finished = r.end_date != null && next > r.end_date;
      db().prepare('UPDATE recurring SET next_date = ?, active = ? WHERE id = ?').run(next, finished ? 0 : 1, r.id);
    })();
    created += newOnes.length;
    if (newOnes.length) {
      const account = accounts.get(r.account_id);
      const recipients = account?.owner_id == null ? null : [account.owner_id];
      await notify({
        kind: 'recurring',
        users: recipients,
        title: `Para confirmar: ${r.description}`,
        body: `Se generó ${newOnes.length > 1 ? `${newOnes.length} movimientos` : 'un movimiento'} de ${formatMoney(r.amount, account?.currency ?? 'ARS')}. Confirmá el monto real.`,
        link: '/recurrentes',
      });
    }
  }
  return created;
}
