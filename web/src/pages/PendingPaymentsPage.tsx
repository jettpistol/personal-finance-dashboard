import { useState } from 'react';
import { ActionIcon, Button, Card, Collapse, Group, Menu, Modal, NumberInput, Progress, Radio, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconChevronDown, IconChevronUp, IconDots, IconLink, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { AccountSelect, MoneyInput } from '../components/inputs';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import { currentMonth, date, fromCents, money, today, toCents } from '../lib/format';
import { errorFields, FieldError, notifyError, notifyOk, useAccounts } from '../lib/queries';
import type { Currency, Tx } from '../lib/types';

// Pagos pendientes: what you have to do yourself each month (savings, paying someone back) and
// money people owe you on a schedule (Deudores). Each month expects an amount; what's missing
// rolls over and extra lowers the next one. A movement with the exact amount settles it on its own.

type Period = { month: string; due: string; expected: number; paid: number; remaining: number; status: Status; payments: { id: number; amount: number; date: string; reason: string | null; transaction_id: number | null; auto: number }[] };
type Status = 'done' | 'partial' | 'overdue' | 'pending';
type Item = {
  key: string;
  source: 'commitment' | 'loan';
  id: number;
  kind: 'savings' | 'owe' | 'collect';
  title: string;
  person: string | null;
  currency: Currency;
  account_id: number | null;
  due: string;
  expected: number;
  paid: number;
  remaining: number;
  carried: number;
  status: Status;
  finished: boolean;
  history: Period[];
};
type Commitment = { id: number; kind: 'savings' | 'owe'; title: string; person: string | null; amount: number; currency: Currency; account_id: number | null; day: number; start_month: string; months: number | null; active: number };

const KIND: Record<Item['kind'], string> = { savings: 'Ahorro', owe: 'Deuda', collect: 'Te deben' };
const STATUS: Record<Status, { label: string; tone?: string }> = {
  overdue: { label: 'Vencido', tone: 'ocre' },
  partial: { label: 'Parcial', tone: 'ocre' },
  pending: { label: 'Pendiente' },
  done: { label: 'Al día', tone: 'gray' },
};

const usePending = () => useQuery({ queryKey: ['pending'], queryFn: () => api.get<Item[]>('/pending') });

/** "vence el 6 nov", "venció hace 3 días" */
function dueText(i: Item): string {
  if (i.remaining <= 0) return `Pagado · vencía el ${date(i.due, 'D MMM')}`;
  const days = Math.round((new Date(`${today()}T00:00:00`).getTime() - new Date(`${i.due}T00:00:00`).getTime()) / 86_400_000);
  if (days > 0) return `Venció el ${date(i.due, 'D MMM')} · hace ${days === 1 ? '1 día' : `${days} días`}`;
  if (days === 0) return 'Vence hoy';
  return `Vence el ${date(i.due, 'D MMM')}`;
}

export function PendingPaymentsPage() {
  const pending = usePending();
  const [editing, setEditing] = useState<Commitment | 'new' | null>(null);
  const [linking, setLinking] = useState<Item | null>(null);
  const items = pending.data ?? [];
  const open = items.filter((i) => i.remaining > 0);
  const late = open.filter((i) => i.status === 'overdue').length;

  return (
    <>
      <PageHeader
        title="Pagos pendientes"
        actions={
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
            Nuevo compromiso
          </Button>
        }
      />
      <SimpleGrid cols={{ base: 3 }} mb="lg">
        <Stat label="Vencidos" value={late} alert={late > 0} />
        <Stat label="Por hacer" value={open.length - late} />
        <Stat label="Al día" value={items.length - open.length} />
      </SimpleGrid>

      {pending.isLoading && <Text c="dimmed">Cargando…</Text>}
      {pending.data && !items.length && (
        <Card>
          <Text c="dimmed" ta="center">
            Nada pendiente. Creá un compromiso (por ejemplo, pasar US$ 200 al ahorro cada día 6) o anotá en Deudores un préstamo con fecha de devolución.
          </Text>
        </Card>
      )}
      <Stack>
        {items.map((i) => (
          <ItemCard key={i.key} item={i} onLink={() => setLinking(i)} onEdit={async () => setEditing(await api.get<Commitment>(`/commitments/${i.id}`))} />
        ))}
      </Stack>
      {editing && <CommitmentModal commitment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {linking && <LinkModal item={linking} onClose={() => setLinking(null)} />}
    </>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <Card padding="md">
      <Text size="xs" c="dimmed" fw={650}>
        {label}
      </Text>
      <Text className="num" fz={24} fw={800} c={alert ? 'red.8' : undefined}>
        {value}
      </Text>
    </Card>
  );
}

function ItemCard({ item: i, onLink, onEdit }: { item: Item; onLink: () => void; onEdit: () => void }) {
  const { openTx, me } = useApp();
  const accounts = useAccounts();
  const qc = useQueryClient();
  const [history, setHistory] = useState(false);
  const account = accounts.data?.find((a) => a.id === i.account_id);

  // Opens Nuevo movimiento ready to save: a transfer to the savings account, a payment, or the money that came back.
  const record = () => {
    const amount = fromCents(i.remaining);
    if (i.kind === 'savings') {
      const from = accounts.data?.find((a) => a.owner_id === me.id && a.currency === i.currency && a.id !== i.account_id && !a.archived);
      // No account in that currency to pay from: it's a conversion, so what's known is the amount to receive.
      if (from) openTx({ type: 'transfer', accountId: from.id, prefill: { amount, toAccountId: i.account_id ?? undefined, description: i.title } });
      else openTx({ type: 'transfer', prefill: { toAmount: amount, toAccountId: i.account_id ?? undefined, description: i.title } });
    } else if (i.kind === 'owe') {
      const from = accounts.data?.find((a) => a.owner_id === me.id && a.currency === i.currency && !a.archived);
      openTx({ type: 'expense', accountId: i.account_id ?? from?.id, prefill: { amount, description: `Pago a ${i.person}` } });
    } else {
      const to = accounts.data?.find((a) => a.owner_id === me.id && a.currency === i.currency && !a.archived);
      openTx({ type: 'income', accountId: to?.id, prefill: { amount, description: `Devolución de ${i.person}` } });
    }
  };

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) notifyOk(ok);
      qc.invalidateQueries({ queryKey: ['pending'] });
    } catch (e) {
      notifyError(e);
    }
  };
  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar compromiso',
      children: <Text size="sm">Se borra «{i.title}» y su historial. Los movimientos no cambian.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => act(() => api.del(`/commitments/${i.id}`)),
    });

  const st = STATUS[i.remaining <= 0 ? 'done' : i.status];
  return (
    <Card padding={0} className="pfd-pending" data-status={i.remaining <= 0 ? 'done' : i.status}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" p="md" gap="md">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <Title order={4} lineClamp={1}>
              {i.title}
            </Title>
            <span className="pfd-tag" data-tone={i.kind === 'collect' ? 'grape' : undefined}>
              {KIND[i.kind]}
            </span>
            <span className="pfd-tag" data-tone={st.tone}>
              {st.label}
            </span>
          </Group>
          <Text size="sm" c="dimmed">
            {i.kind === 'savings' && `A ${account?.name ?? 'la cuenta de ahorro'} · `}
            {i.kind === 'owe' && `A ${i.person} · `}
            {i.kind === 'collect' && `${i.person} · `}
            {dueText(i)}
          </Text>
          {i.remaining > 0 && (
            <>
              <Text className="num" fz={26} fw={800} mt={4} c={i.status === 'overdue' ? 'red.8' : undefined}>
                {money(i.remaining, i.currency)}
              </Text>
              <Text size="xs" c="dimmed" className="num">
                {i.paid > 0 && `Pagado ${money(i.paid, i.currency)} de ${money(i.expected, i.currency)}`}
                {i.paid > 0 && i.carried > 0 && ' · '}
                {i.carried > 0 && `incluye ${money(i.carried, i.currency)} del mes anterior`}
                {i.carried < 0 && `ya descontado ${money(-i.carried, i.currency)} que pagaste de más`}
              </Text>
              {i.paid > 0 && <Progress value={(i.paid / i.expected) * 100} size={6} mt={6} color="teal" aria-label="Pagado" />}
            </>
          )}
        </div>
        <Group gap={4} wrap="nowrap">
          {i.remaining > 0 && (
            <>
              <Button size="xs" onClick={record}>
                {i.kind === 'collect' ? 'Registrar cobro' : 'Registrar'}
              </Button>
              <Button size="xs" variant="default" leftSection={<IconLink size={13} />} onClick={onLink}>
                Vincular
              </Button>
            </>
          )}
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Más opciones">
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {i.source === 'commitment' ? (
                <>
                  <Menu.Item onClick={onEdit}>Editar</Menu.Item>
                  <Menu.Item color="red" onClick={remove}>
                    Eliminar
                  </Menu.Item>
                </>
              ) : (
                <Menu.Item component={Link} to="/deudores">
                  Ver en Deudores
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <button type="button" className="pfd-pending-toggle" onClick={() => setHistory((h) => !h)}>
        {history ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />} {history ? 'Ocultar historial' : 'Historial'}
      </button>
      <Collapse in={history}>
        <Table verticalSpacing={4} fz="sm">
          <Table.Tbody>
            {i.history.map((p) => (
              <Table.Tr key={p.month + p.due}>
                <Table.Td w={120}>{date(p.due, 'MMM YYYY')}</Table.Td>
                <Table.Td className="num" ta="right">
                  {money(p.paid, i.currency)} de {money(p.expected, i.currency)}
                </Table.Td>
                <Table.Td w={90}>
                  <span className="pfd-tag" data-tone={STATUS[p.status].tone}>
                    {STATUS[p.status].label}
                  </span>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {p.payments
                      .map((x) => `${date(x.date, 'D MMM')}: ${money(x.amount, i.currency)}${x.auto ? ' (automático)' : ''}${x.reason ? ` · «${x.reason}»` : ''}`)
                      .join(' — ')}
                  </Text>
                </Table.Td>
                <Table.Td w={40}>
                  {i.source === 'commitment' && p.payments.length > 0 && (
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Pagos del mes">
                          <IconDots size={14} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {p.payments.map((x) => (
                          <Menu.Item key={x.id} color="red" onClick={() => act(() => api.del(`/pending/payments/${x.id}`), 'Pago desvinculado')}>
                            Desvincular {money(x.amount, i.currency)} del {date(x.date, 'D MMM')}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Collapse>
    </Card>
  );
}

/** Pick an existing movement for this item; if it's less than what's due, say why. */
function LinkModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const candidates = useQuery({
    queryKey: ['pending', 'candidates', item.key],
    queryFn: () => api.get<(Tx & { value: number })[]>(`/pending/${item.source}/${item.id}/candidates`),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [bad, setBad] = useState(false);
  const [saving, setSaving] = useState(false);
  const tx = candidates.data?.find((t) => String(t.id) === picked);
  const partial = !!tx && tx.value < item.remaining;

  const save = async () => {
    if (!tx) return;
    if (partial && !reason.trim()) {
      setBad(true);
      return notifyError(new FieldError('Es un pago parcial: escribí por qué no se pagó todo.', ['reason']));
    }
    setSaving(true);
    try {
      await api.post(`/pending/${item.source}/${item.id}/link`, { transaction_id: tx.id, reason: reason.trim() || null });
      notifyOk('Movimiento vinculado');
      qc.invalidateQueries({ queryKey: ['pending'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    } catch (e) {
      setBad(errorFields(e).includes('reason') || errorFields(e).includes('note'));
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} size="lg" title={<Text fw={700}>Vincular un movimiento: {item.title}</Text>}>
      <Stack gap="sm">
        <Text size="sm">
          Faltan <b className="num">{money(item.remaining, item.currency)}</b>. Elegí el movimiento con el que se pagó (últimos 90 días, en {item.currency}).
        </Text>
        {candidates.isLoading && <Text c="dimmed">Buscando…</Text>}
        {candidates.data && !candidates.data.length && <Text c="dimmed">No hay movimientos que puedan corresponder. Usá «Registrar» para cargarlo.</Text>}
        <Radio.Group value={picked} onChange={setPicked}>
          <Stack gap={0} className="pfd-link-list">
            {candidates.data?.map((t) => (
              <label key={t.id} className="pfd-link-row" data-exact={t.value === item.remaining || undefined}>
                <Radio value={String(t.id)} aria-label={t.description} />
                <Text size="sm" className="num" w={64}>
                  {date(t.date, 'DD/MM')}
                </Text>
                <Text size="sm" style={{ flex: 1 }} lineClamp={1}>
                  {t.description || t.merchant || '(sin descripción)'}
                </Text>
                {t.value === item.remaining && (
                  <span className="pfd-tag" data-tone="gray">
                    Exacto
                  </span>
                )}
                <Text size="sm" className="num" fw={600}>
                  {money(t.value, item.currency)}
                </Text>
              </label>
            ))}
          </Stack>
        </Radio.Group>
        {partial && (
          <Textarea
            label="¿Por qué es parcial?"
            description="Lo que falta pasa al mes siguiente."
            autosize
            minRows={2}
            value={reason}
            onChange={(e) => {
              setBad(false);
              setReason(e.currentTarget.value);
            }}
            error={bad}
            required
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!tx}>
            Vincular
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function CommitmentModal({ commitment: c, onClose }: { commitment: Commitment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [kind, setKind] = useState<Commitment['kind']>(c?.kind ?? 'savings');
  const [title, setTitle] = useState(c?.title ?? '');
  const [person, setPerson] = useState(c?.person ?? '');
  const [amount, setAmount] = useState<number | string>(c ? fromCents(c.amount) : '');
  const [currency, setCurrency] = useState<Currency>(c?.currency ?? 'USD');
  const [accountId, setAccountId] = useState<number | null>(c?.account_id ?? null);
  const [day, setDay] = useState<number | string>(c?.day ?? 6);
  const [start, setStart] = useState<string>(`${c?.start_month ?? currentMonth()}-01`);
  const [months, setMonths] = useState<number | string>(c?.months ?? '');
  const [bad, setBad] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const fail = (e: unknown) => {
      setBad(errorFields(e));
      notifyError(e);
    };
    if (!title.trim()) return fail(new FieldError('Poné un nombre, por ejemplo «Ahorro en dólares».', ['title']));
    if (!(toCents(amount) > 0)) return fail(new FieldError('Indicá el monto de cada mes.', ['amount']));
    if (kind === 'savings' && !accountId) return fail(new FieldError('Elegí la cuenta de ahorro.', ['account_id']));
    if (kind === 'owe' && !person.trim()) return fail(new FieldError('Indicá a quién le pagás.', ['person']));
    setSaving(true);
    const body = {
      kind,
      title,
      person: kind === 'owe' ? person : null,
      amount: toCents(amount),
      currency,
      account_id: accountId,
      day: Number(day),
      start_month: start.slice(0, 7),
      months: months === '' ? null : Number(months),
      active: true,
    };
    try {
      if (c) await api.put(`/commitments/${c.id}`, body);
      else await api.post('/commitments', body);
      notifyOk('Compromiso guardado');
      qc.invalidateQueries({ queryKey: ['pending'] });
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{c ? 'Editar compromiso' : 'Nuevo compromiso'}</Text>}>
      <Stack gap="sm">
        <SegmentedControl
          fullWidth
          value={kind}
          onChange={(v) => setKind(v as Commitment['kind'])}
          data={[
            { value: 'savings', label: 'Ahorro mensual' },
            { value: 'owe', label: 'Deuda que pago' },
          ]}
        />
        <TextInput
          label="Nombre"
          placeholder={kind === 'savings' ? 'Ej: Ahorro en dólares' : 'Ej: Préstamo de papá'}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          error={bad.includes('title')}
          required
          data-autofocus
        />
        {kind === 'owe' && <TextInput label="¿A quién?" value={person} onChange={(e) => setPerson(e.currentTarget.value)} error={bad.includes('person')} required />}
        <Group gap="sm" wrap="nowrap" align="flex-end">
          <MoneyInput label="Cada mes" currency={currency} value={amount} onChange={setAmount} error={bad.includes('amount')} required style={{ flex: 1 }} />
          <Select
            w={96}
            aria-label="Moneda"
            data={['ARS', 'USD']}
            value={currency}
            onChange={(v) => {
              if (!v) return;
              setCurrency(v as Currency);
              if (accounts.data?.find((a) => a.id === accountId)?.currency !== v) setAccountId(null);
            }}
            allowDeselect={false}
          />
        </Group>
        <AccountSelect
          label={kind === 'savings' ? 'Cuenta de ahorro (destino)' : 'Pagás desde (opcional)'}
          currency={currency}
          value={accountId}
          onChange={setAccountId}
          clearable={kind === 'owe'}
          required={kind === 'savings'}
          error={bad.includes('account_id')}
          nothingFoundMessage={`No hay cuentas en ${currency}`}
        />
        <SimpleGrid cols={3}>
          <NumberInput label="Día" min={1} max={31} hideControls value={day} onChange={setDay} />
          <MonthPickerInput label="Desde" valueFormat="MMM YYYY" value={start} onChange={(v) => v && setStart(v)} />
          <NumberInput label="Meses" placeholder="Sin fin" min={1} max={240} hideControls value={months} onChange={setMonths} />
        </SimpleGrid>
        <Text size="xs" c="dimmed">
          Solo cuenta un movimiento en {currency}. Si te falta algo un mes, pasa al siguiente; si ponés de más, el siguiente baja.
        </Text>
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
