import { useMemo, useState, type ReactNode } from 'react';
import { Button, Checkbox, Group, Modal, Radio, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { date, money } from '../lib/format';
import { useAccounts } from '../lib/queries';
import type { Currency, Tx, TxList } from '../lib/types';

// Pick one or more existing movements. One list, used wherever a screen needs "which movement was
// it?": linking a payment in Pendientes today; settling up, returns in Deudores, confirming a
// recurring item or adding to an Objetivo later. See docs/dev/components.md.

/** A movement to pick. `value` is what it counts for here (e.g. the dollars a conversion delivered), if not its amount. */
export type PickerTx = Tx & { value?: number };

/** Loads movements from GET /transactions with the usual filters (for screens without their own endpoint). */
export const transactionsLoader =
  (filters: { from?: string; to?: string; type?: Tx['type']; account_id?: number; status?: 'confirmed' | 'pending'; q?: string }) => async () =>
    (await api.get<TxList>(`/transactions${qs({ ...filters, page_size: 200 })}`)).items as PickerTx[];

export interface MovementPickerProps {
  /** Cache key for the list (include whatever changes the list). */
  queryKey: unknown[];
  /** Where the movements come from: a screen's own endpoint, or transactionsLoader(...). */
  load: () => Promise<PickerTx[]>;
  /** One movement (radios) or several (checkboxes). */
  multiple?: boolean;
  value: number[];
  onChange: (ids: number[], picked: PickerTx[]) => void;
  /** What's being looked for: rows with exactly this amount are marked and listed first. */
  target?: { amount: number; currency: Currency };
  /** Extra condition on top of what `load` returns. */
  filter?: (t: PickerTx) => boolean;
  /** A text box to search by description, merchant or account. */
  searchable?: boolean;
  /** Shown when nothing can be picked. */
  empty?: ReactNode;
}

const valueOf = (t: PickerTx) => t.value ?? t.amount;

export function MovementPicker({ queryKey, load, multiple, value, onChange, target, filter, searchable, empty }: MovementPickerProps) {
  const q = useQuery({ queryKey, queryFn: load });
  const accounts = useAccounts();
  const [search, setSearch] = useState('');
  const accountName = (id: number | null) => accounts.data?.find((a) => a.id === id)?.name ?? '';

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (q.data ?? []).filter((t) => (!filter || filter(t)) && (!needle || [t.description, t.merchant, accountName(t.account_id)].some((f) => f?.toLowerCase().includes(needle))));
    if (!target) return list;
    // Exact amounts first, then the closest, newest first among equals.
    return [...list].sort((a, b) => Math.abs(valueOf(a) - target.amount) - Math.abs(valueOf(b) - target.amount) || (a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, search, filter, target?.amount, accounts.data]);

  const pick = (id: number, on: boolean) => {
    const ids = multiple ? (on ? [...value, id] : value.filter((x) => x !== id)) : on ? [id] : [];
    onChange(ids, (q.data ?? []).filter((t) => ids.includes(t.id)));
  };

  const row = (t: PickerTx) => {
    const checked = value.includes(t.id);
    const exact = !!target && valueOf(t) === target.amount;
    return (
      <label key={t.id} className="pfd-link-row" data-exact={exact || undefined} data-checked={checked || undefined}>
        {multiple ? (
          <Checkbox checked={checked} onChange={(e) => pick(t.id, e.currentTarget.checked)} aria-label={t.description} />
        ) : (
          <Radio value={String(t.id)} aria-label={t.description} />
        )}
        <Text size="sm" className="num" w={52} c="dimmed">
          {date(t.date, 'DD/MM')}
        </Text>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" lineClamp={1}>
            {t.description || t.merchant || '(sin descripción)'}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {accountName(t.account_id)}
            {t.to_account_id ? ` → ${accountName(t.to_account_id)}` : ''}
          </Text>
        </div>
        {exact && (
          <span className="pfd-tag" data-tone="gray">
            Exacto
          </span>
        )}
        <Text size="sm" className="num" fw={600}>
          {money(valueOf(t), target?.currency ?? t.currency)}
        </Text>
      </label>
    );
  };

  return (
    <Stack gap="xs">
      {searchable && (
        <TextInput size="xs" leftSection={<IconSearch size={14} />} placeholder="Buscar" value={search} onChange={(e) => setSearch(e.currentTarget.value)} aria-label="Buscar movimientos" />
      )}
      {q.isLoading && <Text c="dimmed">Buscando…</Text>}
      {q.data && !rows.length && <Text c="dimmed">{empty ?? 'No hay movimientos para elegir.'}</Text>}
      {rows.length > 0 &&
        (multiple ? (
          <Stack gap={0} className="pfd-link-list">
            {rows.map(row)}
          </Stack>
        ) : (
          <Radio.Group value={value[0] != null ? String(value[0]) : null} onChange={(v) => pick(Number(v), true)}>
            <Stack gap={0} className="pfd-link-list">
              {rows.map(row)}
            </Stack>
          </Radio.Group>
        ))}
    </Stack>
  );
}

export interface MovementPickerModalProps extends Omit<MovementPickerProps, 'value' | 'onChange'> {
  title: ReactNode;
  /** A line above the list, e.g. what's being paid. */
  intro?: ReactNode;
  confirmLabel: string;
  /** Runs with the picked movements; throw to keep the window open (the error is the caller's to show). */
  onConfirm: (picked: PickerTx[]) => Promise<void> | void;
  onClose: () => void;
  /** Extra fields under the list, given what's picked (e.g. "¿Por qué es parcial?"). */
  children?: (picked: PickerTx[]) => ReactNode;
}

/** The picker in its own window with Cancelar / confirm. */
export function MovementPickerModal({ title, intro, confirmLabel, onConfirm, onClose, children, ...picker }: MovementPickerModalProps) {
  const [picked, setPicked] = useState<PickerTx[]>([]);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(picked);
    } catch {
      /* the caller already said what went wrong */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} size="lg" centered title={<Text fw={700}>{title}</Text>}>
      <MovementPickerBody intro={intro} picker={picker} picked={picked} setPicked={setPicked}>
        {children?.(picked)}
      </MovementPickerBody>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={confirm} loading={busy} disabled={!picked.length}>
          {confirmLabel}
        </Button>
      </Group>
    </Modal>
  );
}

/** The picker with an intro line and extra fields, for screens that embed it in their own window. */
export function MovementPickerBody({
  intro,
  picker,
  picked,
  setPicked,
  children,
}: {
  intro?: ReactNode;
  picker: Omit<MovementPickerProps, 'value' | 'onChange'>;
  picked: PickerTx[];
  setPicked: (p: PickerTx[]) => void;
  children?: ReactNode;
}) {
  return (
    <Stack gap="sm">
      {intro && <Text size="sm">{intro}</Text>}
      <MovementPicker {...picker} value={picked.map((t) => t.id)} onChange={(_, txs) => setPicked(txs)} />
      {children}
    </Stack>
  );
}
