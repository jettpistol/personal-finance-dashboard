import { Fragment, useState } from 'react';
import { NumberInput, Select, Stack, Text } from '@mantine/core';
import { allocateEqual, fromCents, money, toCents } from '../lib/format';
import type { Currency, SplitMethod, User } from '../lib/types';
import { MoneyInput } from './inputs';

type Values = Record<number, number | string>;

/** Whether the household's default split gives everyone the same part. */
export function defaultSplitIsEqual(cfg: Record<string, number> | undefined, users: User[]): boolean {
  const weights = users.map((u) => Number(cfg?.[u.id] ?? 0));
  return !weights.some((w) => w > 0) || weights.every((w) => Math.abs(w - weights[0]) < 0.01);
}

/** Label for the household's default split: names only matter when the parts are not equal. */
export function defaultSplitLabel(cfg: Record<string, number> | undefined, users: User[]): string {
  if (defaultSplitIsEqual(cfg, users)) return users.length === 2 ? 'Cincuenta-cincuenta' : 'Partes iguales';
  return `Por defecto (${users.map((u) => `${u.display_name} ${Number(cfg?.[u.id] ?? 0)}%`).join(' / ')})`;
}

/** The problem with the current split, or null when it adds up. `total` is in cents. */
export function splitProblem(method: SplitMethod, values: Values, users: User[], total: number, currency?: Currency): string | null {
  if (method === 'percent') {
    const sum = users.reduce((a, u) => a + Number(values[u.id] || 0), 0);
    return Math.abs(sum - 100) < 0.01 ? null : `Los porcentajes tienen que sumar 100% (ahora suman ${String(Math.round(sum * 100) / 100).replace('.', ',')}%).`;
  }
  if (method === 'exact') {
    const sum = users.reduce((a, u) => a + toCents(values[u.id] || 0), 0);
    if (sum === total) return null;
    const diff = total - sum;
    return `Los montos tienen que sumar el total: ${diff > 0 ? 'faltan' : 'sobran'} ${money(Math.abs(diff), currency)}.`;
  }
  return null;
}

/**
 * Split editor for shared expenses. Percentages start at equal parts and, with two people,
 * editing one fills the other with the rest, so the split always adds up. The error only
 * shows after the person has touched a box.
 */
export function SplitEditor({
  method,
  values,
  onChange,
  users,
  total,
  currency,
  defaultSplit,
  invalid,
}: {
  method: SplitMethod;
  values: Values;
  onChange: (method: SplitMethod, values: Values) => void;
  users: User[];
  total: number;
  currency?: Currency;
  defaultSplit: Record<string, number> | undefined;
  /** Set by the form when saving failed on the split, to show the problem untouched. */
  invalid?: boolean;
}) {
  const [touched, setTouched] = useState(false);

  const pickMethod = (m: SplitMethod) => {
    setTouched(false);
    if (m === 'percent') {
      const parts = allocateEqual(10000, users.length).map((p) => p / 100);
      onChange(m, Object.fromEntries(users.map((u, i) => [u.id, parts[i]])));
    } else if (m === 'exact') {
      const parts = allocateEqual(total, users.length).map(fromCents);
      onChange(m, Object.fromEntries(users.map((u, i) => [u.id, parts[i]])));
    } else {
      onChange(m, {});
    }
  };

  // With two people the other box takes the remainder; with more, the last other box does.
  const editValue = (uid: number, raw: number | string) => {
    setTouched(true);
    const next: Values = { ...values, [uid]: raw };
    const others = users.filter((u) => u.id !== uid);
    if (others.length && raw !== '' && !Number.isNaN(Number(raw))) {
      const fill = others[others.length - 1];
      const rest = others.slice(0, -1);
      if (method === 'percent') {
        const used = Number(raw) + rest.reduce((a, u) => a + Number(next[u.id] || 0), 0);
        next[fill.id] = Math.max(0, Math.round((100 - used) * 100) / 100);
      } else {
        const used = toCents(raw) + rest.reduce((a, u) => a + toCents(next[u.id] || 0), 0);
        next[fill.id] = fromCents(Math.max(0, total - used));
      }
    }
    onChange(method, next);
  };

  const problem = touched || invalid ? splitProblem(method, values, users, total, currency) : null;

  return (
    <Stack gap="xs">
      <Select
        label="División"
        value={method}
        onChange={(v) => pickMethod((v ?? 'default') as SplitMethod)}
        allowDeselect={false}
        data={[
          { value: 'default', label: defaultSplitLabel(defaultSplit, users) },
          // "Partes iguales" only adds something when the default split is not already equal.
          ...(defaultSplitIsEqual(defaultSplit, users) && method !== 'equal' ? [] : [{ value: 'equal', label: 'Partes iguales' }]),
          { value: 'percent', label: 'Porcentajes' },
          { value: 'exact', label: 'Montos exactos' },
        ]}
      />
      {(method === 'percent' || method === 'exact') && (
        <>
          <div className="pfd-split-rows">
            {users.map((u) => (
              <Fragment key={u.id}>
                <Text size="sm" component="label" htmlFor={`split-${u.id}`}>
                  {u.display_name}
                </Text>
                {method === 'percent' ? (
                  <NumberInput
                    id={`split-${u.id}`}
                    w={84}
                    suffix="%"
                    min={0}
                    max={100}
                    decimalSeparator=","
                    hideControls
                    value={values[u.id] ?? ''}
                    onChange={(v) => editValue(u.id, v)}
                    error={!!problem}
                  />
                ) : (
                  <MoneyInput id={`split-${u.id}`} w={160} currency={currency} value={values[u.id] ?? ''} onChange={(v) => editValue(u.id, v)} error={!!problem} />
                )}
              </Fragment>
            ))}
          </div>
          {problem && (
            <Text size="xs" c="red.8" role="alert">
              {problem}
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}
