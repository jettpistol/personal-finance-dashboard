import { z } from 'zod';
import { db } from '../db/index.js';

// Fees a platform charged on a movement (Mercado Pago today; any wallet, broker or processor later).
// The movement's amount is what really moved, net of fees: these rows don't change any balance,
// they only say how much of the movement went to the platform, for Reportes → Comisiones.

export const FEE_KINDS = ['fee', 'financing', 'shipping', 'tax', 'other'] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

export const FEE_LABELS: Record<FeeKind, string> = {
  fee: 'Comisión',
  financing: 'Financiación',
  shipping: 'Envío',
  tax: 'Impuestos',
  other: 'Otro cargo',
};

export const feeSchema = z.object({
  platform: z.string().trim().min(1).max(40),
  kind: z.enum(FEE_KINDS),
  amount: z.number().int().positive(),
});
export type Fee = z.infer<typeof feeSchema>;

export const feesSchema = z.array(feeSchema).max(10);

/** Replaces a movement's fees. */
export function writeFees(txId: number, fees: Fee[]) {
  db().prepare('DELETE FROM tx_fees WHERE transaction_id = ?').run(txId);
  const ins = db().prepare('INSERT INTO tx_fees (transaction_id, platform, kind, amount) VALUES (?, ?, ?, ?)');
  for (const f of fees) ins.run(txId, f.platform, f.kind, f.amount);
}

/** Adds fees to a movement, skipping any platform that already has fees recorded on it. */
export function addFees(txId: number, fees: Fee[]) {
  const has = db().prepare('SELECT 1 FROM tx_fees WHERE transaction_id = ? AND platform = ? LIMIT 1');
  const ins = db().prepare('INSERT INTO tx_fees (transaction_id, platform, kind, amount) VALUES (?, ?, ?, ?)');
  const skip = new Set(fees.filter((f) => has.get(txId, f.platform)).map((f) => f.platform));
  for (const f of fees) if (!skip.has(f.platform)) ins.run(txId, f.platform, f.kind, f.amount);
}

/** Fees of many movements at once, by movement id. */
export function feesByTx(ids: number[]): Map<number, Fee[]> {
  const out = new Map<number, Fee[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db()
      .prepare(`SELECT transaction_id, platform, kind, amount FROM tx_fees WHERE transaction_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id`)
      .all(...chunk) as (Fee & { transaction_id: number })[];
    for (const { transaction_id, ...f } of rows) {
      if (!out.has(transaction_id)) out.set(transaction_id, []);
      out.get(transaction_id)!.push(f);
    }
  }
  return out;
}

/** Platform names already used, for the form's suggestions. */
export function feePlatforms(): string[] {
  return (db().prepare('SELECT DISTINCT platform FROM tx_fees ORDER BY platform').all() as { platform: string }[]).map((r) => r.platform);
}
