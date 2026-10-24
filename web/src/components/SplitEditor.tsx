import { useState } from 'react';
import { NumberInput, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { allocateEqual, fromCents, money, toCents } from '../lib/format';
import type { Currency, SplitMethod, User } from '../lib/types';
import { MoneyInput } from './inputs';

type Values = Record<number, number | string>;

/** Label for the household's default split: names only matter when the parts are not equal. */
export function defaultSplitLabel(cfg: Record<string, number> | undefined, users: User[]): string {
  const weights = users.map((u) => Number(cfg?.[u.id] ?? 0));
  const configured = weights.some((w) => w > 0);
  const equal = !configured || weights.every((w) => Math.abs(w - weights[0]) < 0.01);
  if (equal) return `Por defecto (${users.map(() => `${Math.round(100 / users.length)}%`).join(' / ')})`;
  return `Por defecto (${users.map((u, i) => `${u.display_name} ${weights[i]}%`).join(' / ')})`;
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
}: {
  method: SplitMethod;
  values: Values;
  onChange: (method: SplitMethod, values: Values) => void;
  users: User[];
  total: number;
  currency?: Currency;
  defaultSplit: Record<string, number> | undefined;
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

  const problem = touched ? splitProblem(method, values, users, total, currency) : null;

  return (
    <Stack gap="xs">
      <Select
        label="División"
        value={method}
        onChange={(v) => pickMethod((v ?? 'default') as SplitMethod)}
        allowDeselect={false}
        data={[
          { value: 'default', label: defaultSplitLabel(defaultSplit, users) },
          { value: 'equal', label: 'Partes iguales' },
          { value: 'percent', label: 'Porcentajes' },
          { value: 'exact', label: 'Montos exactos' },
        ]}
      />
      {(method === 'percent' || method === 'exact') && (
        <>
          <SimpleGrid cols={users.length}>
            {users.map((u) =>
              method === 'percent' ? (
                <NumberInput
                  key={u.id}
                  label={u.display_name}
                  suffix="%"
                  min={0}
                  max={100}
                  decimalSeparator=","
                  value={values[u.id] ?? ''}
                  onChange={(v) => editValue(u.id, v)}
                  error={!!problem}
                />
              ) : (
                <MoneyInput key={u.id} label={u.display_name} currency={currency} value={values[u.id] ?? ''} onChange={(v) => editValue(u.id, v)} error={!!problem} />
              ),
            )}
          </SimpleGrid>
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
