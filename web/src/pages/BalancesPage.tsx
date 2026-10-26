import { useState } from 'react';
import { Alert, Avatar, Badge, Button, Card, Group, Modal, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconArrowRight, IconCheck, IconInfoCircle, IconPlus, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/Layout';
import { MoneyInput } from '../components/inputs';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import { date, fromCents, money, toCents, today } from '../lib/format';
import { notifyError, notifyOk, useAccounts, useRefreshData } from '../lib/queries';
import type { BalanceSummary, Currency, Tx } from '../lib/types';

type Settle = { from: number; to: number; amount: number; currency: Currency };

function SettleModal({ settle, onClose }: { settle: Settle; onClose: () => void }) {
  const { users } = useApp();
  const accounts = useAccounts();
  const refresh = useRefreshData();
  const options = (uid: number) =>
    (accounts.data ?? [])
      .filter((a) => a.owner_id === uid && a.currency === settle.currency && !a.archived)
      .map((a) => ({ value: String(a.id), label: a.name }));
  const fromOpts = options(settle.from);
  const toOpts = options(settle.to);
  const [fromId, setFromId] = useState<string | null>(fromOpts[0]?.value ?? null);
  const [toId, setToId] = useState<string | null>(toOpts[0]?.value ?? null);
  const [amount, setAmount] = useState<number | string>(fromCents(settle.amount));
  const [day, setDay] = useState<string>(today());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const name = (id: number) => users.find((u) => u.id === id)?.display_name ?? '?';

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/balances/settle', { from_account_id: Number(fromId), to_account_id: Number(toId), amount: toCents(amount), date: day, note: note || undefined });
      notifyOk('Pago registrado');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>Saldar deuda</Text>}>
      <Stack gap="sm">
        <Text size="sm">
          {name(settle.from)} le paga a {name(settle.to)}. Se registra como una transferencia entre sus cuentas personales y no cuenta como gasto.
        </Text>
        {(!fromOpts.length || !toOpts.length) && (
          <Alert color="yellow" icon={<IconInfoCircle size={16} />}>
            Cada uno necesita al menos una cuenta personal (no privada) en {settle.currency}. Podés crear una cuenta de efectivo si el pago fue en mano.
          </Alert>
        )}
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <Select label={`Sale de (${name(settle.from)})`} data={fromOpts} value={fromId} onChange={setFromId} allowDeselect={false} />
          <Select label={`Entra a (${name(settle.to)})`} data={toOpts} value={toId} onChange={setToId} allowDeselect={false} />
        </SimpleGrid>
        <SimpleGrid cols={2}>
          <MoneyInput label="Monto" currency={settle.currency} value={amount} onChange={setAmount} />
          <DateInput label="Fecha" value={day} onChange={(v) => v && setDay(v)} valueFormat="DD/MM/YYYY" />
        </SimpleGrid>
        <TextInput label="Nota" placeholder="Saldar deudas" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!fromId || !toId || toCents(amount) <= 0}>
            Registrar pago
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function SummaryCard({ b, onSettle }: { b: BalanceSummary; onSettle: (s: Settle) => void }) {
  const { me, users } = useApp();
  const name = (id: number) => users.find((u) => u.id === id)?.display_name ?? '?';
  return (
    <Card>
      <Group justify="space-between" mb="sm">
        <Badge variant="light">{b.currency}</Badge>
      </Group>
      {!b.settlements.length ? (
        <Group gap="sm">
          <IconCheck size={18} color="var(--pfd-up)" />
          <Text fw={700} fz="xl">
            Están a mano
          </Text>
        </Group>
      ) : (
        <Stack gap="md">
          {b.settlements.map((s, i) => {
            const text =
              s.from === me.id ? `Le debés a ${name(s.to)}` : s.to === me.id ? `${name(s.from)} te debe` : `${name(s.from)} le debe a ${name(s.to)}`;
            return (
              <Group key={i} justify="space-between" wrap="wrap">
                <div>
                  <Text c="dimmed" size="sm">
                    {text}
                  </Text>
                  <Text className="num" fw={800} fz={30} c={s.from === me.id ? 'red' : 'teal'}>
                    {money(s.amount, b.currency)}
                  </Text>
                </div>
                <Button onClick={() => onSettle({ ...s, currency: b.currency })}>Saldar</Button>
              </Group>
            );
          })}
        </Stack>
      )}
      <Group gap="lg" mt="md">
        {b.users.map((u) => (
          <Group key={u.user_id} gap={6}>
            <Avatar size="sm" radius="xl" color={users.find((x) => x.id === u.user_id)?.color}>
              {u.name.slice(0, 1)}
            </Avatar>
            <Text size="xs" c="dimmed">
              {u.name}: <span className="num">{money(u.net, b.currency, { sign: true })}</span>
            </Text>
          </Group>
        ))}
      </Group>
    </Card>
  );
}

export function BalancesPage() {
  const { users, me, openTx } = useApp();
  const q = useQuery({ queryKey: ['balances'], queryFn: () => api.get<{ balances: BalanceSummary[]; activity: Tx[] }>('/balances') });
  const [settle, setSettle] = useState<Settle | null>(null);
  const name = (id: number | null) => (id == null ? 'Cuenta común' : (users.find((u) => u.id === id)?.display_name ?? '?'));
  const other = (id: number | null) => users.find((u) => u.id !== id)?.id ?? null;

  return (
    <>
      <PageHeader
        title="Gastos compartidos"
        description="Quién pagó qué y cuánto se deben, al estilo Splitwise."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => openTx({ type: 'expense' })}>
            Agregar gasto compartido
          </Button>
        }
      />


      {q.isLoading && <Text c="dimmed">Cargando…</Text>}
      <SimpleGrid cols={{ base: 1, md: 2 }} mb="xl">
        {q.data?.balances.map((b) => <SummaryCard key={b.currency} b={b} onSettle={setSettle} />)}
        {q.data && !q.data.balances.length && (
          <Card>
            <Group gap="sm">
              <IconCheck size={18} color="var(--pfd-up)" />
              <div>
                <Text fw={700} fz="xl">
                  Están a mano
                </Text>
                <Text size="sm" c="dimmed">
                  Todavía no hay gastos compartidos pagados con cuentas personales.
                </Text>
              </div>
            </Group>
          </Card>
        )}
      </SimpleGrid>

      <Card>
        <Title order={4}>Actividad</Title>
        {!q.data?.activity.length ? (
          <Text c="dimmed" size="sm" ta="center" py="md">
            Sin gastos compartidos todavía.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={90}>Fecha</Table.Th>
                  <Table.Th>Descripción</Table.Th>
                  <Table.Th>Pagó / recibió</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                  {users.map((u) => (
                    <Table.Th key={u.id} ta="right">
                      {u.id === me.id ? 'Tu parte' : `Parte de ${u.display_name}`}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.activity.map((t) => {
                  const settlement = !!t.is_settlement;
                  return (
                    <Table.Tr key={t.id} className="clickable-row" onClick={() => openTx({ id: t.id })}>
                      <Table.Td>
                        <Text size="sm" c="dimmed" className="num">
                          {date(t.date, 'DD/MM/YY')}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <span style={{ display: "inline-flex", color: `var(--mantine-color-${settlement ? 'teal' : 'grape'}-7)` }}>{settlement ? <IconArrowRight size={12} /> : <IconUsers size={12} />}</span>
                          <Text size="sm" fw={500} lineClamp={1}>
                            {settlement ? `${name(t.owner_id)} le pagó a ${name(other(t.owner_id))}` : t.description || t.merchant || '(sin descripción)'}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{settlement ? name(t.owner_id) : name(t.paid_by)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ta="right" className="num" fw={600}>
                          {money(t.amount, t.currency)}
                        </Text>
                      </Table.Td>
                      {users.map((u) => (
                        <Table.Td key={u.id}>
                          <Text size="sm" ta="right" className="num" c="dimmed">
                            {settlement ? '—' : money(t.splits.find((s) => s.user_id === u.id)?.amount ?? 0, t.currency)}
                          </Text>
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      {settle && <SettleModal settle={settle} onClose={() => setSettle(null)} />}
    </>
  );
}
