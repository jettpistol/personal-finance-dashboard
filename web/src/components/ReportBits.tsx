import type { ReactNode } from 'react';
import { Alert, Card, Group, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconArrowDownRight, IconArrowUpRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { money, pct } from '../lib/format';
import type { Currency } from '../lib/types';

// Small building blocks shared by the Reports and Month review pages.

/** Charts work in units; the API returns cents. */
export const units = (cents: number | null | undefined) => (cents == null ? 0 : cents / 100);

/** Formatter for chart axes/tooltips that receive units. */
export const unitFormatter = (currency: Currency, compact = false) => (v: number) => money(Math.round(v * 100), currency, { compact });

export function change(cur: number, prev: number): number | null {
  return prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
}

/**
 * Percentage change with an arrow. `goodWhenUp` decides the color:
 * more income is good, more spending is bad.
 */
export function Delta({ value, goodWhenUp, suffix, size = 'xs' }: { value: number | null | undefined; goodWhenUp: boolean; suffix?: string; size?: 'xs' | 'sm' }) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <Text size={size} c="dimmed">
        —
      </Text>
    );
  }
  const up = value > 0;
  const good = Math.abs(value) < 0.05 ? null : up === goodWhenUp;
  const color = good === null ? 'dimmed' : good ? 'teal.7' : 'red.7';
  const Icon = up ? IconArrowUpRight : IconArrowDownRight;
  return (
    <Group gap={2} wrap="nowrap">
      <Icon size={14} color={`var(--mantine-color-${good === null ? 'gray-6' : good ? 'teal-7' : 'red-7'})`} />
      <Text size={size} c={color} className="num" fw={600}>
        {pct(value, 1, true)}
      </Text>
      {suffix && (
        <Text size={size} c="dimmed">
          {suffix}
        </Text>
      )}
    </Group>
  );
}

export function Kpi({ label, value, hint, children }: { label: string; value: ReactNode; hint?: string; children?: ReactNode }) {
  const body = (
    <Card padding="md">
      <Text size="sm" c="var(--pfd-ink-2)" fw={650}>
        {label}
      </Text>
      <Text fz={22} fw={800} className="num" mt={4}>
        {value}
      </Text>
      {children}
    </Card>
  );
  return hint ? (
    <Tooltip label={hint} multiline w={260} withArrow>
      {body}
    </Tooltip>
  ) : (
    body
  );
}

export function MissingRatesAlert({ show }: { show: boolean | undefined }) {
  if (!show) return null;
  return (
    <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mb="md">
      Faltan cotizaciones del dólar para algunos días, así que hay montos que no se pudieron convertir. Cargalas en{' '}
      <Text component={Link} to="/ajustes" inherit fw={600} c="yellow.9">
        Ajustes
      </Text>
      .
    </Alert>
  );
}

/** Real % colored by meaning: positive = spending grew faster than prices (red). */
export function RealPct({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <Text size="sm" c="dimmed" ta="right">—</Text>;
  const color = Math.abs(value) < 0.05 ? 'dimmed' : value > 0 ? 'red.7' : 'teal.7';
  return (
    <Text size="sm" c={color} fw={600} className="num" ta="right">
      {pct(value, 1, true)}
    </Text>
  );
}

export function Empty({ children = 'Todavía no hay datos para este período.' }: { children?: ReactNode }) {
  return (
    <Text c="dimmed" size="sm" ta="center" py="xl">
      {children}
    </Text>
  );
}
