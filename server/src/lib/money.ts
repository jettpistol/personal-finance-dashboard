export type Currency = 'ARS' | 'USD';
export const CURRENCIES: Currency[] = ['ARS', 'USD'];

/** Amounts are stored as integer cents. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Splits `total` cents across `weights` so the parts always add up to `total` exactly.
 * Remainders go to the largest fractional parts first.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('weights must add up to more than zero');
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.trunc(r));
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) }))
    .sort((a, b) => b.frac - a.frac);
  const step = remainder > 0 ? 1 : -1;
  for (let k = 0; remainder !== 0; k = (k + 1) % order.length) {
    parts[order[k].i] += step;
    remainder -= step;
  }
  return parts;
}

export function formatMoney(cents: number, currency: Currency): string {
  const n = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  return currency === 'USD' ? `US$ ${n}` : `$ ${n}`;
}
