import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconCheck, IconEdit, IconInfoCircle, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/app-state';
import { date, fromCents, money, toCents, today } from '../lib/format';
import { categoryLabel, notifyError, notifyOk, useAccounts, useCategories, useRefreshData, useSettings, useTags } from '../lib/queries';
import type { Recurring, SplitMethod, TxList } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { AccountSelect, CategorySelect, MoneyInput } from '../components/inputs';

const FREQ: Record<Recurring['frequency'], [string, string]> = {
  weekly: ['Semanal', 'semanas'],
  monthly: ['Mensual', 'meses'],
  yearly: ['Anual', 'años'],
};

function freqLabel(r: Pick<Recurring, 'frequency' | 'interval'>) {
  return r.interval > 1 ? `Cada ${r.interval} ${FREQ[r.frequency][1]}` : FREQ[r.frequency][0];
}

export function RecurringPage() {
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Recurrentes"
        description="Alquiler, servicios, suscripciones y sueldos que se repiten."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Nuevo recurrente
          </Button>
        }
      />
      <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />} mb="md">
        Cada vez que vence se crea un movimiento pendiente que tenés que confirmar con el monto real. Los pendientes no cuentan en los totales hasta que los confirmás.
      </Alert>
      <Stack>
        <PendingSection />
        <TemplatesSection onEdit={setEditing} />
      </Stack>
      {editing && <RecurringModal recurring={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PendingSection() {
  const { openTx } = useApp();
  const refresh = useRefreshData();
  const cats = useCategories();
  const accounts = useAccounts();
  const pending = useQuery({ queryKey: ['transactions', 'pending'], queryFn: () => api.get<TxList>(`/transactions${qs({ status: 'pending', page_size: 100 })}`) });
  const [amounts, setAmounts] = useState<Record<number, number | string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!pending.data) return;
    setAmounts((prev) => {
      const next = { ...prev };
      for (const t of pending.data.items) if (next[t.id] === undefined) next[t.id] = fromCents(t.amount);
      return next;
    });
  }, [pending.data]);

  const confirm = async (id: number) => {
    setBusy(id);
    try {
      await api.post(`/transactions/${id}/confirm`, { amount: toCents(amounts[id]) });
      notifyOk('Movimiento confirmado');
      refresh();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const discard = (id: number, description: string) =>
    modals.openConfirmModal({
      title: 'Descartar pendiente',
      children: <Text size="sm">Se elimina «{description}» de este período. El recurrente sigue activo.</Text>,
      labels: { confirm: 'Descartar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/transactions/${id}`);
          refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const items = pending.data?.items ?? [];
  return (
    <Card>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Para confirmar</Title>
        {items.length > 0 && <Badge color="yellow">{items.length}</Badge>}
      </Group>
      {!items.length ? (
        <Text c="dimmed" size="sm">
          No hay movimientos pendientes. 🎉
        </Text>
      ) : (
        <Stack gap="xs">
          {items.map((t) => (
            <Group key={t.id} justify="space-between" wrap="wrap" gap="xs" p="xs" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
              <div style={{ minWidth: 180, flex: 1 }}>
                <Text fw={500} size="sm">
                  {t.description}
                </Text>
                <Text size="xs" c="dimmed">
                  {date(t.date)} · {t.type === 'income' ? 'Ingreso' : categoryLabel(cats.data, t.category_id)} · {accounts.data?.find((a) => a.id === t.account_id)?.name ?? 'Cuenta privada'}
                  {t.is_shared ? ' · compartido' : ''}
                </Text>
              </div>
              <Group gap="xs" wrap="nowrap">
                <MoneyInput
                  size="xs"
                  w={140}
                  currency={t.currency}
                  aria-label="Monto real"
                  value={amounts[t.id] ?? ''}
                  onChange={(v) => setAmounts((a) => ({ ...a, [t.id]: v }))}
                  disabled={!t.can_edit}
                />
                <Button size="xs" color="teal" leftSection={<IconCheck size={14} />} loading={busy === t.id} disabled={!t.can_edit || toCents(amounts[t.id]) <= 0} onClick={() => confirm(t.id)}>
                  Confirmar
                </Button>
                <ActionIcon variant="subtle" aria-label="Editar" onClick={() => openTx({ id: t.id })}>
                  <IconEdit size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="red" aria-label="Descartar" disabled={!t.can_edit} onClick={() => discard(t.id, t.description)}>
                  <IconX size={16} />
                </ActionIcon>
              </Group>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}

function TemplatesSection({ onEdit }: { onEdit: (r: Recurring) => void }) {
  const refresh = useRefreshData();
  const cats = useCategories();
  const accounts = useAccounts();
  const list = useQuery({ queryKey: ['recurring'], queryFn: () => api.get<Recurring[]>('/recurring') });

  const toggle = async (r: Recurring) => {
    try {
      await api.put(`/recurring/${r.id}`, { ...payloadFrom(r), active: !r.active });
      refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  const remove = (r: Recurring) =>
    modals.openConfirmModal({
      title: 'Eliminar recurrente',
      children: <Text size="sm">Se elimina «{r.description}» y sus pendientes sin confirmar. Los movimientos ya confirmados quedan en el historial.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/recurring/${r.id}`);
          refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  return (
    <Card>
      <Title order={4} mb="sm">
        Recurrentes configurados
      </Title>
      {!list.data?.length ? (
        <Text c="dimmed" size="sm">
          Todavía no hay recurrentes. Agregá el alquiler, los servicios o las suscripciones.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Descripción</Table.Th>
                <Table.Th ta="right">Monto estimado</Table.Th>
                <Table.Th>Frecuencia</Table.Th>
                <Table.Th>Próximo</Table.Th>
                <Table.Th>Cuenta</Table.Th>
                <Table.Th>Activo</Table.Th>
                <Table.Th w={80} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data.map((r) => (
                <Table.Tr key={r.id} opacity={r.active ? 1 : 0.5}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text size="sm" fw={500}>
                        {r.description}
                      </Text>
                      {!!r.is_shared && (
                        <Badge size="xs" variant="light" color="grape">
                          Compartido
                        </Badge>
                      )}
                      {r.type === 'income' && (
                        <Badge size="xs" variant="light" color="teal">
                          Ingreso
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {categoryLabel(cats.data, r.category_id)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" className="num">
                    {money(r.amount, r.currency)}
                  </Table.Td>
                  <Table.Td>{freqLabel(r)}</Table.Td>
                  <Table.Td className="num">
                    {r.active ? date(r.next_date) : '—'}
                    {r.end_date && (
                      <Text size="xs" c="dimmed">
                        hasta {date(r.end_date)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{accounts.data?.find((a) => a.id === r.account_id)?.name ?? '—'}</Table.Td>
                  <Table.Td>
                    <Switch size="xs" aria-label="Activo" checked={!!r.active} onChange={() => toggle(r)} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <ActionIcon variant="subtle" aria-label="Editar" onClick={() => onEdit(r)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => remove(r)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

function payloadFrom(r: Recurring) {
  return {
    description: r.description,
    type: r.type,
    amount: r.amount,
    account_id: r.account_id,
    category_id: r.category_id,
    frequency: r.frequency,
    interval: r.interval,
    next_date: r.next_date,
    end_date: r.end_date,
    merchant: r.merchant,
    notes: r.notes,
    tags: r.tags,
    is_shared: !!r.is_shared,
    split: r.split,
    is_private: !!r.is_private,
    active: !!r.active,
  };
}

type Form = {
  description: string;
  type: 'expense' | 'income';
  amount: number | string;
  account_id: number | null;
  category_id: number | null;
  frequency: Recurring['frequency'];
  interval: number | string;
  next_date: string;
  end_date: string | null;
  merchant: string;
  notes: string;
  tags: string[];
  is_shared: boolean;
  split_method: SplitMethod;
  split_values: Record<number, number | string>;
  is_private: boolean;
  active: boolean;
};

function RecurringModal({ recurring, onClose }: { recurring: Recurring | null; onClose: () => void }) {
  const { users, me } = useApp();
  const accounts = useAccounts();
  const settings = useSettings();
  const tags = useTags();
  const refresh = useRefreshData();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Form>(() => {
    const values: Record<number, number> = {};
    for (const v of recurring?.split?.values ?? []) values[v.user_id] = recurring?.split?.method === 'exact' ? fromCents(v.value) : v.value;
    return {
      description: recurring?.description ?? '',
      type: recurring?.type ?? 'expense',
      amount: recurring ? fromCents(recurring.amount) : '',
      account_id: recurring?.account_id ?? null,
      category_id: recurring?.category_id ?? null,
      frequency: recurring?.frequency ?? 'monthly',
      interval: recurring?.interval ?? 1,
      next_date: recurring?.next_date ?? today(),
      end_date: recurring?.end_date ?? null,
      merchant: recurring?.merchant ?? '',
      notes: recurring?.notes ?? '',
      tags: recurring?.tags ?? [],
      is_shared: !!recurring?.is_shared,
      split_method: recurring?.split?.method ?? 'default',
      split_values: values,
      is_private: !!recurring?.is_private,
      active: recurring ? !!recurring.active : true,
    };
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const account = accounts.data?.find((a) => a.id === form.account_id);

  useEffect(() => {
    if (recurring || form.account_id || !accounts.data?.length) return;
    const a = accounts.data.find((x) => x.owner_id === null && !x.archived) ?? accounts.data.find((x) => x.owner_id === me.id && !x.archived);
    if (a) setForm((f) => ({ ...f, account_id: a.id }));
  }, [accounts.data, recurring, form.account_id, me.id]);

  const defaultSplitLabel = useMemo(() => {
    const cfg = settings.data?.default_split ?? {};
    const hasCfg = Object.values(cfg).some((v) => v > 0);
    return users.map((u) => `${u.display_name} ${hasCfg ? (cfg[u.id] ?? 0) : Math.round(100 / users.length)}%`).join(' / ');
  }, [settings.data, users]);

  const splitSum = users.reduce((a, u) => a + Number(form.split_values[u.id] ?? 0), 0);

  const save = async () => {
    if (!form.account_id) return notifyError(new Error('Elegí una cuenta.'));
    setSaving(true);
    const shared = form.type === 'expense' && form.is_shared;
    const split = !shared
      ? null
      : form.split_method === 'default' || form.split_method === 'equal'
        ? { method: form.split_method }
        : {
            method: form.split_method,
            values: users.map((u) => ({ user_id: u.id, value: form.split_method === 'exact' ? toCents(form.split_values[u.id] ?? 0) : Number(form.split_values[u.id] ?? 0) })),
          };
    const body = {
      description: form.description,
      type: form.type,
      amount: toCents(form.amount),
      account_id: form.account_id,
      category_id: form.category_id,
      frequency: form.frequency,
      interval: Number(form.interval || 1),
      next_date: form.next_date,
      end_date: form.end_date || null,
      merchant: form.merchant || null,
      notes: form.notes || null,
      tags: form.tags,
      is_shared: shared,
      split,
      is_private: form.is_private,
      active: form.active,
    };
    try {
      if (recurring) await api.put(`/recurring/${recurring.id}`, body);
      else await api.post('/recurring', body);
      notifyOk('Recurrente guardado');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{recurring ? 'Editar recurrente' : 'Nuevo recurrente'}</Text>} size="lg" fullScreen={window.innerWidth < 600}>
      <Stack gap="sm">
        <SegmentedControl
          fullWidth
          value={form.type}
          onChange={(v) => setForm((f) => ({ ...f, type: v as Form['type'], category_id: null }))}
          data={[
            { value: 'expense', label: 'Gasto' },
            { value: 'income', label: 'Ingreso' },
          ]}
        />
        <TextInput label="Descripción" placeholder="Ej: Alquiler, Internet, Netflix" value={form.description} onChange={(e) => set('description', e.currentTarget.value)} required />
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <MoneyInput label="Monto estimado" description="Lo ajustás al confirmar cada mes" currency={account?.currency} value={form.amount} onChange={(v) => set('amount', v)} required />
          <AccountSelect label="Cuenta" value={form.account_id} onChange={(v) => set('account_id', v)} writableOnly required />
        </SimpleGrid>
        <CategorySelect label="Categoría" kind={form.type} value={form.category_id} onChange={(v) => set('category_id', v)} />
        <SimpleGrid cols={{ base: 2, xs: 4 }}>
          <Select
            label="Frecuencia"
            value={form.frequency}
            onChange={(v) => set('frequency', (v ?? 'monthly') as Form['frequency'])}
            allowDeselect={false}
            data={[
              { value: 'weekly', label: 'Semanal' },
              { value: 'monthly', label: 'Mensual' },
              { value: 'yearly', label: 'Anual' },
            ]}
          />
          <NumberInput label="Cada" min={1} max={24} value={form.interval} onChange={(v) => set('interval', v)} suffix={` ${FREQ[form.frequency][1]}`} />
          <DateInput label="Próximo vencimiento" valueFormat="DD/MM/YYYY" value={form.next_date} onChange={(v) => v && set('next_date', v)} required />
          <DateInput label="Hasta (opcional)" valueFormat="DD/MM/YYYY" value={form.end_date} onChange={(v) => set('end_date', v)} clearable />
        </SimpleGrid>

        {form.type === 'expense' && (
          <Stack gap={6}>
            <Switch label="Gasto compartido" checked={form.is_shared} onChange={(e) => set('is_shared', e.currentTarget.checked)} />
            <Collapse in={form.is_shared}>
              <Stack gap="xs" pl="md">
                <Select
                  label="División"
                  value={form.split_method}
                  onChange={(v) => set('split_method', (v ?? 'default') as SplitMethod)}
                  allowDeselect={false}
                  data={[
                    { value: 'default', label: `Por defecto (${defaultSplitLabel})` },
                    { value: 'equal', label: 'Partes iguales' },
                    { value: 'percent', label: 'Porcentajes' },
                    { value: 'exact', label: 'Montos exactos' },
                  ]}
                />
                {(form.split_method === 'percent' || form.split_method === 'exact') && (
                  <>
                    <SimpleGrid cols={users.length}>
                      {users.map((u) =>
                        form.split_method === 'percent' ? (
                          <NumberInput key={u.id} label={u.display_name} suffix="%" min={0} max={100} decimalSeparator="," value={form.split_values[u.id] ?? ''} onChange={(v) => set('split_values', { ...form.split_values, [u.id]: v })} />
                        ) : (
                          <MoneyInput key={u.id} label={u.display_name} currency={account?.currency} value={form.split_values[u.id] ?? ''} onChange={(v) => set('split_values', { ...form.split_values, [u.id]: v })} />
                        ),
                      )}
                    </SimpleGrid>
                    <Text size="xs" c="dimmed">
                      {form.split_method === 'percent'
                        ? `Suma: ${splitSum}% (debe ser 100%)`
                        : `Suma: ${money(toCents(splitSum), account?.currency)}. Si el monto real cambia al confirmar, se reparte en la misma proporción.`}
                    </Text>
                  </>
                )}
              </Stack>
            </Collapse>
          </Stack>
        )}
        {account && account.owner_id !== null && !form.is_shared && (
          <Switch label="Privado" description="Tu pareja no verá estos movimientos." checked={form.is_private} onChange={(e) => set('is_private', e.currentTarget.checked)} />
        )}
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Comercio" value={form.merchant} onChange={(e) => set('merchant', e.currentTarget.value)} />
          <TagsInput label="Etiquetas" data={tags.data ?? []} value={form.tags} onChange={(v) => set('tags', v)} clearable />
        </SimpleGrid>
        <Textarea label="Notas" autosize minRows={1} value={form.notes} onChange={(e) => set('notes', e.currentTarget.value)} />
        <Switch label="Activo" checked={form.active} onChange={(e) => set('active', e.currentTarget.checked)} />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
