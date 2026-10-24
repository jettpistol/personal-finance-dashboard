import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Input,
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
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconAlertCircle, IconCheck, IconEdit, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/app-state';
import { date, fromCents, money, toCents, today } from '../lib/format';
import { categoryLabel, errorFields, FieldError, notifyError, notifyOk, useAccounts, useCategories, useRefreshData, useSettings, useTags } from '../lib/queries';
import type { Currency, Recurring, SplitMethod, TxList } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { AccountSelect, CategorySelect, MoneyInput } from '../components/inputs';
import { HeroAmount } from '../components/HeroAmount';
import { SplitEditor, splitProblem } from '../components/SplitEditor';

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
      <Stack>
        <PendingAlert />
        <TemplatesSection onEdit={setEditing} />
      </Stack>
      {editing && <RecurringModal recurring={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/**
 * Each due date leaves a pending movement to confirm with the real amount (bills vary month
 * to month). They only show up as an alert when there are some; the list opens on demand.
 */
function PendingAlert() {
  const pending = useQuery({
    queryKey: ['transactions', 'pending'],
    queryFn: () => api.get<TxList>(`/transactions${qs({ status: 'pending', page_size: 100 })}`),
  });
  const [open, setOpen] = useState(false);
  const count = pending.data?.items.length ?? 0;
  useEffect(() => {
    if (!count) setOpen(false);
  }, [count]);
  if (!count) return null;
  return (
    <>
      <Alert color="yellow" icon={<IconAlertCircle size={16} />} p="xs">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text size="sm">
            {count === 1 ? 'Hay 1 recurrente vencido para confirmar con el monto real.' : `Hay ${count} recurrentes vencidos para confirmar con el monto real.`}
          </Text>
          <Button size="xs" variant="default" onClick={() => setOpen(true)}>
            Revisar
          </Button>
        </Group>
      </Alert>
      <Modal opened={open} onClose={() => setOpen(false)} title={<Text fw={700}>Para confirmar</Text>} size="lg" fullScreen={window.innerWidth < 600}>
        <PendingList items={pending.data?.items ?? []} />
      </Modal>
    </>
  );
}

function PendingList({ items }: { items: TxList['items'] }) {
  const { openTx } = useApp();
  const refresh = useRefreshData();
  const cats = useCategories();
  const accounts = useAccounts();
  const [amounts, setAmounts] = useState<Record<number, number | string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    setAmounts((prev) => {
      const next = { ...prev };
      for (const t of items) if (next[t.id] === undefined) next[t.id] = fromCents(t.amount);
      return next;
    });
  }, [items]);

  const confirm = async (id: number) => {
    setBusy(id);
    try {
      await api.post(`/transactions/${id}/confirm`, {
        amount: toCents(amounts[id]),
      });
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

  return (
    <Stack gap="xs">
      {items.map((t) => (
        <Group key={t.id} justify="space-between" wrap="wrap" gap="xs" p="xs" style={{ border: '1px solid var(--pfd-rule)' }}>
          <div style={{ minWidth: 180, flex: 1 }}>
            <Text fw={500} size="sm">
              {t.description}
            </Text>
            <Text size="xs" c="dimmed">
              {date(t.date)} · {t.type === 'income' ? 'Ingreso' : categoryLabel(cats.data, t.category_id)} ·{' '}
              {accounts.data?.find((a) => a.id === t.account_id)?.name ?? 'Cuenta privada'}
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
            <Button
              size="xs"
              color="teal"
              leftSection={<IconCheck size={14} />}
              loading={busy === t.id}
              disabled={!t.can_edit || toCents(amounts[t.id]) <= 0}
              onClick={() => confirm(t.id)}
            >
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
  );
}

function TemplatesSection({ onEdit }: { onEdit: (r: Recurring) => void }) {
  const refresh = useRefreshData();
  const cats = useCategories();
  const accounts = useAccounts();
  const list = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.get<Recurring[]>('/recurring'),
  });

  const toggle = async (r: Recurring) => {
    try {
      await api.put(`/recurring/${r.id}`, {
        ...payloadFrom(r),
        active: !r.active,
      });
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
      {!list.data?.length ? (
        <Text c="dimmed" size="sm">
          Todavía no hay recurrentes. Agregá el alquiler, los servicios o las suscripciones.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          {/* Fixed columns: toggling "Activo" changes "Próximo" but never moves the rest. */}
          <Table verticalSpacing="xs" layout="fixed">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Descripción</Table.Th>
                <Table.Th ta="right" w={150}>
                  Monto estimado
                </Table.Th>
                <Table.Th w={130}>Frecuencia</Table.Th>
                <Table.Th w={130}>Próximo</Table.Th>
                <Table.Th w={190}>Cuenta</Table.Th>
                <Table.Th w={70}>Activo</Table.Th>
                <Table.Th w={84} />
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
                  <Table.Td
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {accounts.data?.find((a) => a.id === r.account_id)?.name ?? '—'}
                  </Table.Td>
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
  const { users, me, currency: viewCurrency } = useApp();
  const accounts = useAccounts();
  const settings = useSettings();
  const tags = useTags();
  const refresh = useRefreshData();
  const [saving, setSaving] = useState(false);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [currency, setCurrency] = useState<Currency>(recurring?.currency ?? viewCurrency);
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
  const clearBad = (field: string) =>
    setBad((b) => {
      if (!b.has(field)) return b;
      const next = new Set(b);
      next.delete(field);
      return next;
    });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    clearBad(k);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const account = accounts.data?.find((a) => a.id === form.account_id);
  const income = form.type === 'income';

  // The account follows the currency: keep it if it matches, else take the first joint (or own) one in that currency.
  useEffect(() => {
    if (!accounts.data || account?.currency === currency) return;
    const usable = accounts.data.filter((a) => !a.archived && a.currency === currency && (a.can_edit || !a.is_private));
    const pick = usable.find((a) => a.owner_id === null) ?? usable.find((a) => a.owner_id === me.id) ?? usable[0];
    setForm((f) => ({ ...f, account_id: pick?.id ?? null }));
  }, [accounts.data, account?.currency, currency, me.id]);

  const fail = (e: unknown) => {
    setBad(new Set(errorFields(e)));
    notifyError(e);
  };

  const save = async () => {
    if (!(toCents(form.amount) > 0)) return fail(new FieldError('Ingresá el monto estimado.', ['amount']));
    if (!form.description.trim())
      return fail(new FieldError(income ? 'Escribí una descripción (por ejemplo «Sueldo»).' : 'Escribí una descripción (por ejemplo «Alquiler»).', ['description']));
    if (!form.account_id) return fail(new FieldError(`Elegí una cuenta en ${currency}.`, ['account_id']));
    const splitIssue = form.is_shared ? splitProblem(form.split_method, form.split_values, users, toCents(form.amount), currency) : null;
    if (splitIssue) return fail(new FieldError(splitIssue, ['split']));
    setSaving(true);
    const split = !form.is_shared
      ? null
      : form.split_method === 'default' || form.split_method === 'equal'
        ? { method: form.split_method }
        : {
            method: form.split_method,
            values: users.map((u) => ({
              user_id: u.id,
              value: form.split_method === 'exact' ? toCents(form.split_values[u.id] ?? 0) : Number(form.split_values[u.id] ?? 0),
            })),
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
      is_shared: form.is_shared,
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
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{recurring ? 'Editar recurrente' : 'Nuevo recurrente'}</Text>} size="lg" fullScreen={window.innerWidth < 600}>
      <Stack gap="sm">
        <HeroAmount
          label="Monto estimado"
          caption="Monto estimado · lo ajustás al confirmar"
          type={form.type}
          value={form.amount}
          onChange={(v) => set('amount', v)}
          currency={currency}
          onCurrencyChange={(c) => {
            clearBad('account_id');
            setCurrency(c);
          }}
          error={bad.has('amount')}
        />
        <SegmentedControl
          fullWidth
          value={form.type}
          onChange={(v) =>
            setForm((f) => ({
              ...f,
              type: v as Form['type'],
              category_id: null,
            }))
          }
          data={[
            { value: 'expense', label: 'Gasto' },
            { value: 'income', label: 'Ingreso' },
          ]}
        />
        <TextInput
          label="Descripción"
          placeholder={income ? 'Ej: Sueldo, Alquiler que cobrás, Freelance' : 'Ej: Alquiler, Internet, Netflix'}
          value={form.description}
          onChange={(e) => set('description', e.currentTarget.value)}
          error={bad.has('description')}
          required
        />
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <AccountSelect
            label="Cuenta"
            value={form.account_id}
            onChange={(v) => set('account_id', v)}
            currency={currency}
            nothingFoundMessage={`No hay cuentas en ${currency}`}
            placeholder={`Cuentas en ${currency}`}
            writableOnly
            required
            error={bad.has('account_id')}
          />
          <CategorySelect label="Categoría" kind={form.type} value={form.category_id} onChange={(v) => set('category_id', v)} error={bad.has('category_id')} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, xs: 3 }}>
          <Input.Wrapper label="Frecuencia">
            <Group gap={6} wrap="nowrap">
              <NumberInput aria-label="Cada cuántos" min={1} max={24} w={56} hideControls value={form.interval} onChange={(v) => set('interval', v)} error={bad.has('interval')} />
              <Select
                aria-label="Unidad"
                style={{ flex: 1 }}
                value={form.frequency}
                onChange={(v) => set('frequency', (v ?? 'monthly') as Form['frequency'])}
                allowDeselect={false}
                data={[
                  {
                    value: 'weekly',
                    label: Number(form.interval) === 1 ? 'semana' : 'semanas',
                  },
                  {
                    value: 'monthly',
                    label: Number(form.interval) === 1 ? 'mes' : 'meses',
                  },
                  {
                    value: 'yearly',
                    label: Number(form.interval) === 1 ? 'año' : 'años',
                  },
                ]}
              />
            </Group>
          </Input.Wrapper>
          <DateInput
            label={income ? 'Próximo cobro' : 'Próximo vencimiento'}
            valueFormat="DD/MM/YYYY"
            value={form.next_date}
            onChange={(v) => v && set('next_date', v)}
            error={bad.has('next_date')}
            required
          />
          <DateInput label="Hasta (opcional)" valueFormat="DD/MM/YYYY" value={form.end_date} onChange={(v) => set('end_date', v)} error={bad.has('end_date')} clearable />
        </SimpleGrid>

        <Stack gap={6}>
          <Switch label={income ? 'Ingreso compartido' : 'Gasto compartido'} checked={form.is_shared} onChange={(e) => set('is_shared', e.currentTarget.checked)} />
          <Collapse in={form.is_shared}>
            <SplitEditor
              method={form.split_method}
              values={form.split_values}
              onChange={(m, v) => {
                clearBad('split');
                setForm((f) => ({ ...f, split_method: m, split_values: v }));
              }}
              users={users}
              total={toCents(form.amount)}
              currency={currency}
              defaultSplit={settings.data?.default_split}
              invalid={bad.has('split')}
            />
          </Collapse>
        </Stack>
        {account && account.owner_id !== null && !form.is_shared && (
          <Switch label="Privado" description="Tu pareja no verá estos movimientos." checked={form.is_private} onChange={(e) => set('is_private', e.currentTarget.checked)} />
        )}
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label={income ? 'Quién paga' : 'Comercio'} value={form.merchant} onChange={(e) => set('merchant', e.currentTarget.value)} />
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
