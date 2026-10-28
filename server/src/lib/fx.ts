import { db, getSetting } from '../db/index.js';
import { config } from '../config.js';
import { today } from './dates.js';
import type { Currency } from './money.js';

// Exchange rates are BNA's official USD quote (ARS per 1 USD), one row per business day.
// Days without a quote (weekends, holidays) use the closest previous quote.

export type FxSide = 'sell' | 'buy' | 'avg';
type RateRow = { date: string; buy: number; sell: number; source: string };

export class Converter {
  private dates: string[];
  private values: number[];

  constructor(rows: RateRow[], side: FxSide) {
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
    this.dates = sorted.map((r) => r.date);
    this.values = sorted.map((r) => (side === 'buy' ? r.buy : side === 'sell' ? r.sell : (r.buy + r.sell) / 2));
  }

  get hasRates() {
    return this.dates.length > 0;
  }

  /** ARS per USD for a date, or null when no rate is known at all. */
  rate(date: string): number | null {
    if (!this.dates.length) return null;
    let lo = 0;
    let hi = this.dates.length - 1;
    if (date < this.dates[0]) return this.values[0];
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.dates[mid] <= date) lo = mid;
      else hi = mid - 1;
    }
    return this.values[lo];
  }

  /** Converts cents between currencies at the given date's rate. Returns null if no rate is available. */
  convert(cents: number, from: Currency, to: Currency, date: string): number | null {
    if (from === to) return cents;
    const r = this.rate(date);
    if (!r) return null;
    return from === 'USD' ? Math.round(cents * r) : Math.round(cents / r);
  }

  /** Same as convert, but falls back to 0 when no rate exists (callers flag missing rates separately). */
  convertOrZero(cents: number, from: Currency, to: Currency, date: string): number {
    return this.convert(cents, from, to, date) ?? 0;
  }
}

export function loadConverter(): Converter {
  const rows = db().prepare('SELECT date, buy, sell, source FROM fx_rates').all() as RateRow[];
  return new Converter(rows, getSetting<FxSide>('fx_side'));
}

export function upsertRate(date: string, buy: number, sell: number, source: string) {
  db()
    .prepare(
      `INSERT INTO fx_rates (date, buy, sell, source, fetched_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(date) DO UPDATE SET buy = excluded.buy, sell = excluded.sell, source = excluded.source, fetched_at = excluded.fetched_at`,
    )
    .run(date, buy, sell, source);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** Parses dolarapi.com's /v1/dolares/oficial response. */
export function parseLatest(json: unknown): RateRow | null {
  const j = json as { compra?: number; venta?: number; fechaActualizacion?: string };
  if (typeof j?.compra !== 'number' || typeof j?.venta !== 'number') return null;
  const date = j.fechaActualizacion ? today(new Date(j.fechaActualizacion)) : today();
  return { date, buy: j.compra, sell: j.venta, source: 'dolarapi' };
}

/** Parses argentinadatos.com's /v1/cotizaciones/dolares/oficial history. */
export function parseHistory(json: unknown): RateRow[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((r) => typeof r?.compra === 'number' && typeof r?.venta === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(r?.fecha))
    .map((r) => ({ date: r.fecha as string, buy: r.compra as number, sell: r.venta as number, source: 'argentinadatos' }));
}

export type RefreshResult = { ok: boolean; inserted: number; latest?: RateRow; errors: string[] };

export async function refreshRates(): Promise<RefreshResult> {
  const errors: string[] = [];
  let inserted = 0;
  let latest: RateRow | undefined;
  try {
    const history = parseHistory(await fetchJson(config.fxProviders.historyUrl));
    const insert = db().prepare(
      `INSERT INTO fx_rates (date, buy, sell, source) VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET buy = excluded.buy, sell = excluded.sell, source = excluded.source
       WHERE fx_rates.source != 'manual'`,
    );
    db().transaction(() => {
      for (const r of history) inserted += insert.run(r.date, r.buy, r.sell, r.source).changes;
    })();
  } catch (e) {
    errors.push(`Historial: ${(e as Error).message}`);
  }
  try {
    const row = parseLatest(await fetchJson(config.fxProviders.latestUrl));
    if (row) {
      const existing = db().prepare('SELECT source FROM fx_rates WHERE date = ?').get(row.date) as { source: string } | undefined;
      if (existing?.source !== 'manual') upsertRate(row.date, row.buy, row.sell, row.source);
      latest = row;
    }
  } catch (e) {
    errors.push(`Cotización del día: ${(e as Error).message}`);
  }
  return { ok: errors.length < 2, inserted, latest, errors };
}

export function latestRate(): RateRow | null {
  return (db().prepare('SELECT date, buy, sell, source FROM fx_rates ORDER BY date DESC LIMIT 1').get() as RateRow) ?? null;
}
