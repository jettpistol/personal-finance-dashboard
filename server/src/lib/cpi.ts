import { db } from '../db/index.js';
import { config } from '../config.js';

// Monthly CPI (INDEC IPC, % change vs previous month). Used to restate past ARS amounts
// in today's pesos and to compare spending growth with inflation.

type CpiRow = { month: string; pct: number };

export class CpiIndex {
  private levels = new Map<string, number>();
  readonly months: string[];
  readonly pct = new Map<string, number>();

  constructor(rows: CpiRow[]) {
    const sorted = [...rows].sort((a, b) => (a.month < b.month ? -1 : 1));
    this.months = sorted.map((r) => r.month);
    let level = 100;
    for (const r of sorted) {
      level *= 1 + r.pct / 100;
      this.levels.set(r.month, level);
      this.pct.set(r.month, r.pct);
    }
  }

  get latestMonth(): string | null {
    return this.months.at(-1) ?? null;
  }

  /** Price level at the end of `month`. Months after the last published one reuse the latest level. */
  level(month: string): number | null {
    if (!this.months.length) return null;
    if (this.levels.has(month)) return this.levels.get(month)!;
    // Before the first published month there is no data; treat it as the base level.
    if (month < this.months[0]) return 100;
    // Not yet published (or a gap): use the closest earlier month.
    const prev = this.months.findLast((m) => m <= month)!;
    return this.levels.get(prev)!;
  }

  /** Multiplier that converts pesos of `month` into pesos of `base`. */
  factor(month: string, base: string): number {
    const a = this.level(month);
    const b = this.level(base);
    if (!a || !b) return 1;
    return b / a;
  }

  /** Accumulated inflation between the end of `from` and the end of `to`, as a percentage. */
  between(from: string, to: string): number | null {
    const a = this.level(from);
    const b = this.level(to);
    if (!a || !b) return null;
    return (b / a - 1) * 100;
  }
}

export function loadCpi(): CpiIndex {
  return new CpiIndex(db().prepare('SELECT month, pct FROM cpi_monthly').all() as CpiRow[]);
}

/** Parses argentinadatos.com's /v1/finanzas/indices/inflacion response. */
export function parseCpi(json: unknown): CpiRow[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((r) => typeof r?.valor === 'number' && /^\d{4}-\d{2}/.test(r?.fecha))
    .map((r) => ({ month: (r.fecha as string).slice(0, 7), pct: r.valor as number }));
}

export async function refreshCpi(): Promise<{ ok: boolean; inserted: number; error?: string }> {
  try {
    const res = await fetch(config.cpiUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${config.cpiUrl} answered ${res.status}`);
    const rows = parseCpi(await res.json());
    const insert = db().prepare(
      `INSERT INTO cpi_monthly (month, pct, source) VALUES (?, ?, 'indec')
       ON CONFLICT(month) DO UPDATE SET pct = excluded.pct WHERE cpi_monthly.source != 'manual'`,
    );
    let inserted = 0;
    db().transaction(() => {
      for (const r of rows) inserted += insert.run(r.month, r.pct).changes;
    })();
    return { ok: true, inserted };
  } catch (e) {
    return { ok: false, inserted: 0, error: (e as Error).message };
  }
}
