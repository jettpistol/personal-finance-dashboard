import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  RingProgress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconCash, IconDots, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/Layout';
import { AccountSelect, MoneyInput } from '../components/inputs';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import { MANTINE_COLORS, date, fromCents, money, toCents, today } from '../lib/format';
import { notifyError, notifyOk, useRefreshData } from '../lib/queries';
import type { Currency, Goal, Scope } from '../lib/types';

type Form = {
  name: string;
  target_amount: number | string;
  currency: Currency;
  deadline: string | null;
  account_id: number | null;
  scope: Scope;
  color: string | null;
  archived: boolean;
};

function GoalModal({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { me, scope } = useApp();
  const refresh = useRefreshData();
  const [form, setForm] = useState<Form>(() =>
    goal
      ? {
          name: goal.name,
          target_amount: fromCents(goal.target_amount),
          currency: goal.currency,
          deadline: goal.deadline,
          account_id: goal.account_id,
          scope: goal.scope,
          color: goal.color,
          archived: !!goal.archived,
        }
      : { name: '', target_amount: '', currency: 'ARS', deadline: null, account_id: null, scope: scope === `user:${me.id}` ? scope : 'household', color: 'teal', archived: false },
  );
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, target_amount: toCents(form.target_amount) };
      if (goal) await api.put(`/goals/${goal.id}`, body);
      else await api.post('/goals', body);
      notifyOk(goal ? 'Meta actualizada' : 'Meta creada');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{goal ? 'Editar meta' : 'Nueva meta de ahorro'}</Text>}>
      <Stack gap="sm">
        <TextInput label="Nombre" placeholder="Ej: Fondo de emergencia, Viaje 2027, Auto" value={form.name} onChange={(e) => set('name', e.currentTarget.value)} data-autofocus required />
        <SimpleGrid cols={2}>
          <MoneyInput label="Objetivo" currency={form.currency} value={form.target_amount} onChange={(v) => set('target_amount', v)} />
          <Select label="Moneda" value={form.currency} onChange={(v) => v && set('currency', v as Currency)} data={['ARS', 'USD']} allowDeselect={false} />
        </SimpleGrid>
        <DateInput label="Fecha límite" placeholder="Opcional" clearable value={form.deadline} onChange={(v) => set('deadline', v)} valueFormat="DD/MM/YYYY" minDate={today()} />
        <AccountSelect
          label="Cuenta vinculada"
          description="Si la vinculás, el progreso es el saldo de esa cuenta. Si no, registrás aportes a mano."
          placeholder="Sin vincular (aportes manuales)"
          clearable
          value={form.account_id}
          onChange={(v) => set('account_id', v)}
        />
        <Select
          label="Ámbito"
          value={form.scope}
          onChange={(v) => v && set('scope', v as Scope)}
          data={[
            { value: 'household', label: 'Hogar (de los dos)' },
            { value: `user:${me.id}`, label: 'Mía' },
          ]}
          allowDeselect={false}
        />
        <Select label="Color" value={form.color} onChange={(v) => set('color', v)} data={MANTINE_COLORS} clearable />
        {goal && <Switch label="Archivada" checked={form.archived} onChange={(e) => set('archived', e.currentTarget.checked)} />}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!form.name.trim() || toCents(form.target_amount) <= 0}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type Contribution = { id: number; goal_id: number; date: string; amount: number; note: string | null };

function ContributionsModal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const refresh = useRefreshData();
  const list = useQuery({ queryKey: ['goals', goal.id, 'contributions'], queryFn: () => api.get<Contribution[]>(`/goals/${goal.id}/contributions`) });
  const [day, setDay] = useState(today());
  const [amount, setAmount] = useState<number | string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setSaving(true);
    try {
      await api.post(`/goals/${goal.id}/contributions`, { date: day, amount: toCents(amount), note: note || null });
      setAmount('');
      setNote('');
      notifyOk('Aporte registrado');
      refresh();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.del(`/goals/${goal.id}/contributions/${id}`);
      refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Modal opened onClose={onClose} size="lg" title={<Text fw={700}>Aportes · {goal.name}</Text>}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, xs: 3 }}>
          <DateInput label="Fecha" value={day} onChange={(v) => v && setDay(v)} valueFormat="DD/MM/YYYY" />
          <MoneyInput label="Monto" description="Negativo para un retiro" currency={goal.currency} allowNegative value={amount} onChange={setAmount} />
          <TextInput label="Nota" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button onClick={add} loading={saving} disabled={!toCents(amount)} leftSection={<IconPlus size={14} />}>
            Registrar aporte
          </Button>
        </Group>
        {!list.data?.length ? (
          <Text c="dimmed" size="sm" ta="center" py="sm">
            Sin aportes todavía.
          </Text>
        ) : (
          <Table verticalSpacing={6}>
            <Table.Tbody>
              {list.data.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td w={100}>
                    <Text size="sm" c="dimmed">
                      {date(c.date, 'DD/MM/YY')}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{c.note || (c.amount < 0 ? 'Retiro' : 'Aporte')}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ta="right" className="num" c={c.amount < 0 ? 'red' : 'teal'}>
                      {money(c.amount, goal.currency, { sign: true })}
                    </Text>
                  </Table.Td>
                  <Table.Td w={40}>
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove(c.id)} aria-label="Eliminar aporte">
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Modal>
  );
}

function GoalCard({ g, onEdit, onContrib }: { g: Goal; onEdit: () => void; onContrib: () => void }) {
  const { me } = useApp();
  const refresh = useRefreshData();
  const editable = g.scope === 'household' || g.scope === `user:${me.id}`;
  const color = g.color ?? 'teal';
  const done = g.saved >= g.target_amount;

  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar meta',
      children: <Text size="sm">¿Eliminar «{g.name}» y sus aportes registrados?</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/goals/${g.id}`);
          refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  return (
    <Card opacity={g.archived ? 0.6 : 1}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text fw={700} lineClamp={1}>
            {g.name}
          </Text>
          <Group gap={4} mt={2}>
            <Badge size="xs" variant="light" color="gray">
              {g.scope === 'household' ? 'Hogar' : 'Personal'}
            </Badge>
            {g.account_name ? (
              <Badge size="xs" variant="outline" color="gray">
                {g.account_name}
              </Badge>
            ) : (
              <Badge size="xs" variant="outline" color="gray">
                Aportes manuales
              </Badge>
            )}
            {!!g.archived && <Badge size="xs">Archivada</Badge>}
          </Group>
        </div>
        {editable && (
          <Menu position="bottom-end" withArrow>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Acciones">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {!g.account_id && (
                <Menu.Item leftSection={<IconCash size={16} />} onClick={onContrib}>
                  Aportes
                </Menu.Item>
              )}
              <Menu.Item leftSection={<IconEdit size={16} />} onClick={onEdit}>
                Editar
              </Menu.Item>
              <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={remove}>
                Eliminar
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      <Group mt="md" wrap="nowrap" gap="md">
        <RingProgress
          size={96}
          thickness={10}
          roundCaps
          sections={[{ value: Math.max(0, Math.min(100, g.pct)), color: done ? 'teal' : color }]}
          label={
            <Text ta="center" fw={800} size="sm">
              {Math.round(g.pct)}%
            </Text>
          }
        />
        <div style={{ minWidth: 0 }}>
          <Text className="num" fw={800} fz="lg">
            {money(g.saved, g.currency)}
          </Text>
          <Text size="xs" c="dimmed" className="num">
            de {money(g.target_amount, g.currency)}
          </Text>
          {g.deadline && (
            <Text size="xs" c="dimmed" mt={4}>
              Para el {date(g.deadline)}
              {g.months_left != null && ` · ${g.months_left} ${g.months_left === 1 ? 'mes' : 'meses'}`}
            </Text>
          )}
        </div>
      </Group>

      <Text size="sm" mt="sm" c={done ? 'teal' : undefined}>
        {done
          ? '¡Meta cumplida! 🎉'
          : g.monthly_needed != null
            ? `Necesitás ahorrar ${money(g.monthly_needed, g.currency)} por mes`
            : `Faltan ${money(g.remaining, g.currency)}`}
      </Text>

      {editable && !g.account_id && !g.archived && (
        <Button mt="sm" size="compact-sm" variant="light" leftSection={<IconPlus size={12} />} onClick={onContrib}>
          Registrar aporte
        </Button>
      )}
    </Card>
  );
}

export function GoalsPage() {
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/goals') });
  const [editing, setEditing] = useState<Goal | null | 'new'>(null);
  const [contrib, setContrib] = useState<Goal | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = (goals.data ?? []).filter((g) => showArchived || !g.archived);

  return (
    <>
      <PageHeader
        title="Metas de ahorro"
        description="Fondo de emergencia, viajes, un futuro auto…"
        actions={
          <>
            <Switch size="sm" label="Mostrar archivadas" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              Nueva meta
            </Button>
          </>
        }
      />
      {goals.isLoading && <Text c="dimmed">Cargando…</Text>}
      {goals.data && !list.length && (
        <Card>
          <Text c="dimmed" ta="center">
            Todavía no hay metas. Creá una para seguir el progreso de un ahorro.
          </Text>
        </Card>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {list.map((g) => (
          <GoalCard key={g.id} g={g} onEdit={() => setEditing(g)} onContrib={() => setContrib(g)} />
        ))}
      </SimpleGrid>
      {editing && <GoalModal goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {contrib && <ContributionsModal goal={contrib} onClose={() => setContrib(null)} />}
    </>
  );
}
