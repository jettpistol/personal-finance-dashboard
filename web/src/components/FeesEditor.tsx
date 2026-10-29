import { ActionIcon, Autocomplete, Button, Group, Select, Stack, Text } from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { FEE_KINDS, FEE_LABELS } from '../lib/fees';
import { fromCents, money, toCents } from '../lib/format';
import type { Currency, Fee, FeeKind } from '../lib/types';
import { MoneyInput } from './inputs';

export type FeeDraft = { platform: string; kind: FeeKind; amount: number | string };

export const feeDrafts = (fees: Fee[] | undefined): FeeDraft[] => (fees ?? []).map((f) => ({ ...f, amount: fromCents(f.amount) }));
export const feesPayload = (drafts: FeeDraft[]): Fee[] =>
  drafts.filter((f) => f.platform.trim() && toCents(f.amount) > 0).map((f) => ({ platform: f.platform.trim(), kind: f.kind, amount: toCents(f.amount) }));

/**
 * Fees a platform (Mercado Pago, a marketplace, a broker) took from this movement. They're already
 * inside its amount: they don't change any balance, they only show up in Reportes → Comisiones.
 */
export function FeesEditor({ value, onChange, currency, error }: { value: FeeDraft[]; onChange: (v: FeeDraft[]) => void; currency: Currency; error?: boolean }) {
  const platforms = useQuery({ queryKey: ['fee-platforms'], queryFn: () => api.get<string[]>('/fees/platforms'), staleTime: 5 * 60_000 });
  const known = [...new Set(['Mercado Pago', ...(platforms.data ?? [])])];
  const set = (i: number, patch: Partial<FeeDraft>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () => onChange([...value, { platform: value.at(-1)?.platform ?? 'Mercado Pago', kind: 'fee', amount: '' }]);

  if (!value.length)
    return (
      <Group>
        <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconPlus size={12} />} onClick={add}>
          Comisión
        </Button>
      </Group>
    );
  const total = feesPayload(value).reduce((s, f) => s + f.amount, 0);
  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text size="sm" fw={600}>
          Comisiones
        </Text>
        <Text size="xs" c="dimmed" className="num">
          Incluidas en el monto · {money(total, currency)}
        </Text>
      </Group>
      {value.map((f, i) => (
        <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
          <Autocomplete aria-label="Plataforma" placeholder="Plataforma" data={known} value={f.platform} onChange={(v) => set(i, { platform: v })} style={{ flex: 1.4 }} error={error && !f.platform.trim()} />
          <Select
            aria-label="Tipo"
            data={FEE_KINDS.map((k) => ({ value: k, label: FEE_LABELS[k] }))}
            value={f.kind}
            onChange={(v) => set(i, { kind: (v ?? 'fee') as FeeKind })}
            allowDeselect={false}
            style={{ flex: 1 }}
          />
          <MoneyInput aria-label="Monto de la comisión" value={f.amount} onChange={(v) => set(i, { amount: v })} style={{ flex: 1 }} error={error} />
          <ActionIcon variant="subtle" color="gray" mt={6} aria-label="Quitar comisión" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <IconX size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconPlus size={12} />} onClick={add}>
          Otra comisión
        </Button>
      </Group>
    </Stack>
  );
}
