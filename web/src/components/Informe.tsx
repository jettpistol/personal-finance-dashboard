import type { ReactNode } from 'react';
import { SegmentedControl, Tooltip } from '@mantine/core';
import { pct } from '../lib/format';
import type { Currency } from '../lib/types';

// Pieces of the "informe" vocabulary shared across pages: signed variations,
// the nominal / real switch and the source line under figures.

/** Real change from a nominal change and the CPI over the same period (both in %). */
export function realChange(nominal: number | null | undefined, cpi: number | null | undefined): number | null {
  if (nominal == null || cpi == null || !Number.isFinite(nominal)) return null;
  return ((1 + nominal / 100) / (1 + cpi / 100) - 1) * 100;
}

export function percentChange(cur: number, prev: number): number | null {
  return prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
}

/** A signed percentage colored by whether the move is good (more income) or bad (more spending). */
export function Variation({ value, goodWhenUp, digits = 1 }: { value: number | null | undefined; goodWhenUp: boolean; digits?: number }) {
  if (value == null || !Number.isFinite(value)) return <span style={{ color: 'var(--pfd-ink-2)' }}>—</span>;
  // Anything that rounds to zero at the shown precision reads as no change (never "-0%").
  const flat = Math.abs(value) < 0.5 * 10 ** -digits;
  const cls = flat ? undefined : value > 0 === goodWhenUp ? 'pfd-up' : 'pfd-down';
  return (
    <span className={`num ${cls ?? ''}`} style={flat ? { color: 'var(--pfd-ink-2)' } : undefined}>
      {flat ? pct(0, digits) : pct(value, digits, true)}
    </span>
  );
}

export type Measure = 'nominal' | 'real';

/** The signature switch: read a chart in pesos of each month or in pesos of today (CPI). */
export function NominalRealSwitch({ value, onChange, currency }: { value: Measure; onChange: (m: Measure) => void; currency: Currency }) {
  const disabled = currency !== 'ARS';
  const control = (
    <SegmentedControl
      size="xs"
      value={disabled ? 'nominal' : value}
      onChange={(v) => onChange(v as Measure)}
      disabled={disabled}
      data={[
        { value: 'nominal', label: 'Nominal' },
        { value: 'real', label: 'Real (IPC)' },
      ]}
      aria-label="Nominal o ajustado por inflación"
    />
  );
  return disabled ? (
    <Tooltip label="El ajuste por inflación (IPC) aplica a montos en pesos" withArrow>
      <span>{control}</span>
    </Tooltip>
  ) : (
    control
  );
}

/** "Fuente:" line under a figure or chart, naming where the numbers come from. */
export function Source({ children }: { children: ReactNode }) {
  return <div className="pfd-source">Fuente: {children}</div>;
}

export function sourceText(currency: Currency, opts: { cpiMonth?: string | null; real?: boolean } = {}) {
  const parts = ['movimientos registrados'];
  if (currency === 'USD') parts.push('dólar BNA del día de cada movimiento');
  if (opts.real) parts.push(`IPC INDEC${opts.cpiMonth ? ` (último publicado: ${opts.cpiMonth})` : ''}`);
  return parts.join(' · ');
}
