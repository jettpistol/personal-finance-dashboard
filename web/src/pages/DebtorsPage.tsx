import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Button,
  Card,
  Collapse,
  Group,
  Menu,
  Modal,
  NumberInput,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconArrowBackUp, IconChevronRight, IconCopy, IconDots, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { PageHeader } from '../components/Layout';
import { MoneyInput } from '../components/inputs';
import { api, qs } from '../lib/api';
import { date, fromCents, money, toCents, today } from '../lib/format';
import { errorFields, FieldError, notifyError, notifyOk } from '../lib/queries';
import type { Currency } from '../lib/types';

// Deudores: money and things lent to other people. Standalone for now: nothing here touches
// accounts, balances or reports, and each person only sees what they lent.

type LoanReturn = { id: number; date: string; amount: number | null; note: string | null };
type Loan = {
  id: number;
  person: string;
  kind: 'money' | 'item';
  item: string | null;
  amount: number | null;
  currency: Currency;
  lent_on: string;
  due_on: string | null;
  notes: string | null;
  closed_on: string | null;
  closed_reason: 'returned' | 'forgiven' | null;
  interest_rate: number | null;
  installments: number | null;
  first_due: string | null;
  total: number | null;
  period_unit: 'day' | 'week' | 'month' | null;
  period_count: number | null;
  /** Tied to inflation (CPI). */
  indexed: number;
  /** Tied to inflation and some month's CPI isn't out yet: the installments can still grow. */
  inflation_pending: boolean;
  returns: LoanReturn[];
  returned: number;
  outstanding: number | null;
  schedule: { n: number; due: string; amount: number; paid: number; remaining: number }[];
  next_installment: { n: number; due: string; amount: number; remaining: number } | null;
  overdue: boolean;
};

const PERIOD: Record<'day' | 'week' | 'month', [string, string]> = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'] };

type View = 'open' | 'closed' | 'all';

const useLoans = () => useQuery({ queryKey: ['loans'], queryFn: () => api.get<Loan[]>('/loans') });

/** "hace 3 días", "hace 2 meses": how long the thing has been out. */
function ago(d: string): string {
  const days = dayjs(today()).diff(dayjs(d), 'day');
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'hace 1 año' : `hace ${years} años`;
}

/** A friendly message listing everything a person still has, ready to paste in WhatsApp. */
function reminder(person: string, loans: Loan[]): string {
  const parts = loans.map((l) =>
    l.kind === 'money'
      ? `${money(l.outstanding, l.currency)}${l.item ? ` (${l.item}, del ${date(l.lent_on, 'DD/MM')})` : ` (del ${date(l.lent_on, 'DD/MM')})`}`
      : `${l.item} (desde el ${date(l.lent_on, 'DD/MM')})`,
  );
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0];
  return `¡Hola ${person}! Te escribo para no olvidarme: tengo anotado que te presté ${list}. ¿Cuándo te queda cómodo devolverlo?`;
}

export function DebtorsPage() {
  const loans = useLoans();
  const [view, setView] = useState<View>('open');
  const [editing, setEditing] = useState<Loan | 'new' | null>(null);
  const [returning, setReturning] = useState<Loan | null>(null);
  const all = loans.data ?? [];
  const open = all.filter((l) => !l.closed_on);

  const shown = view === 'open' ? open : view === 'closed' ? all.filter((l) => l.closed_on) : all;
  const byPerson = useMemo(() => {
    const groups = new Map<string, Loan[]>();
    for (const l of shown) groups.set(l.person, [...(groups.get(l.person) ?? []), l]);
    // People with overdue things first, then by how much they owe.
    const owed = (ls: Loan[]) => ls.reduce((s, l) => s + (l.outstanding ?? 0), 0);
    return [...groups.entries()].sort((a, b) => Number(b[1].some((l) => l.overdue)) - Number(a[1].some((l) => l.overdue)) || owed(b[1]) - owed(a[1]));
  }, [shown]);

  const owedIn = (c: Currency) => open.filter((l) => l.kind === 'money' && l.currency === c).reduce((s, l) => s + (l.outstanding ?? 0), 0);
  const items = open.filter((l) => l.kind === 'item').length;
  const overdue = open.filter((l) => l.overdue).length;
  const people = [...new Set(all.map((l) => l.person))];

  return (
    <>
      <PageHeader
        title="Deudores"
        actions={
          <>
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => setView(v as View)}
              data={[
                { value: 'open', label: 'Pendientes' },
                { value: 'closed', label: 'Saldados' },
                { value: 'all', label: 'Todos' },
              ]}
            />
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
              Nuevo préstamo
            </Button>
          </>
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        <Stat label="Te deben" value={money(owedIn('ARS'))} />
        <Stat label="Te deben en dólares" value={money(owedIn('USD'), 'USD')} />
        <Stat label="Cosas prestadas" value={String(items)} />
        <Stat label="Vencidos" value={String(overdue)} alert={overdue > 0} />
      </SimpleGrid>

      {loans.isLoading && <Text c="dimmed">Cargando…</Text>}
      {loans.data && !shown.length && (
        <Card>
          <Text c="dimmed" ta="center">
            {view === 'open' ? 'Nadie te debe nada. Cuando prestes plata o algo, anotalo con «Nuevo préstamo».' : 'No hay préstamos para mostrar.'}
          </Text>
        </Card>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }} style={{ alignItems: 'start' }}>
        {byPerson.map(([person, list]) => (
          <PersonCard key={person} person={person} loans={list} onEdit={setEditing} onReturn={setReturning} />
        ))}
      </SimpleGrid>

      {editing && <LoanModal loan={editing === 'new' ? null : editing} people={people} onClose={() => setEditing(null)} />}
      {returning && <ReturnModal loan={returning} onClose={() => setReturning(null)} />}
    </>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
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

function PersonCard({ person, loans, onEdit, onReturn }: { person: string; loans: Loan[]; onEdit: (l: Loan) => void; onReturn: (l: Loan) => void }) {
  const open = loans.filter((l) => !l.closed_on);
  const totals = (['ARS', 'USD'] as Currency[])
    .map((c) => ({ c, v: open.filter((l) => l.kind === 'money' && l.currency === c).reduce((s, l) => s + (l.outstanding ?? 0), 0) }))
    .filter((t) => t.v > 0)
    .map((t) => money(t.v, t.c));
  const things = open.filter((l) => l.kind === 'item').length;
  const summary = [...totals, things ? (things === 1 ? '1 cosa' : `${things} cosas`) : null].filter(Boolean).join(' · ');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reminder(person, open));
      notifyOk('Mensaje copiado: pegalo en WhatsApp');
    } catch {
      notifyError(new Error('No se pudo copiar el mensaje.'));
    }
  };

  return (
    <Card padding={0}>
      <Group justify="space-between" wrap="nowrap" px="md" py="xs" className="pfd-debtor-head">
        <div style={{ minWidth: 0 }}>
          <Title order={4} lineClamp={1}>
            {person}
          </Title>
          <Text size="xs" c="dimmed" className="num">
            {summary || 'Nada pendiente'}
          </Text>
        </div>
        {open.length > 0 && (
          <Tooltip label="Copiar un recordatorio amable">
            <Button size="compact-xs" variant="default" leftSection={<IconCopy size={13} />} onClick={copy}>
              Recordar
            </Button>
          </Tooltip>
        )}
      </Group>
      <Stack gap={0}>
        {loans.map((l) => (
          <LoanRow key={l.id} loan={l} onEdit={() => onEdit(l)} onReturn={() => onReturn(l)} />
        ))}
      </Stack>
    </Card>
  );
}

function LoanRow({ loan: l, onEdit, onReturn }: { loan: Loan; onEdit: () => void; onReturn: () => void }) {
  const qc = useQueryClient();
  const reload = () => qc.invalidateQueries({ queryKey: ['loans'] });
  // A confirmation toast also offers Deshacer for what the request changed.
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) notifyOk(ok);
      reload();
    } catch (e) {
      notifyError(e);
    }
  };
  const forgive = () =>
    modals.openConfirmModal({
      title: '¿Perdonar la deuda?',
      centered: true,
      children: (
        <Text size="sm">
          {l.person} ya no te va a deber <b className="num">{money(l.outstanding, l.currency)}</b>. El préstamo queda cerrado como perdonado.
        </Text>
      ),
      labels: { confirm: 'Perdonar deuda', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          const r = await api.post<{ forgiven?: number }>(`/loans/${l.id}/close`, { reason: 'forgiven' });
          notifyOk(`Perdonados ${money(r.forgiven ?? l.outstanding, l.currency)} a ${l.person}.`);
          reload();
        } catch (e) {
          notifyError(e);
        }
      },
    });
  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar préstamo',
      centered: true,
      children: <Text size="sm">Se borra el préstamo y sus devoluciones anotadas.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => act(() => api.del(`/loans/${l.id}`), `Préstamo a ${l.person} eliminado`),
    });

  const [open, setOpen] = useState(false);
  const partial = l.kind === 'money' && l.returned > 0 && !l.closed_on;
  // One short line under the amount; everything else waits behind the row's toggle.
  const status = l.closed_on
    ? `${l.closed_reason === 'forgiven' ? 'Perdonado' : 'Devuelto'} el ${date(l.closed_on, 'D MMM')}`
    : [
        partial ? `Falta ${money(l.outstanding, l.currency)}` : null,
        l.next_installment ? `cuota ${l.next_installment.n}: ${date(l.next_installment.due, 'D MMM')}` : l.due_on ? `vence ${date(l.due_on, 'D MMM')}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || ago(l.lent_on);
  return (
    <div className="pfd-debtor-row" data-closed={l.closed_on ? true : undefined}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <UnstyledButton className="pfd-debtor-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <IconChevronRight size={14} className="pfd-debtor-caret" data-open={open || undefined} aria-hidden />
          <div style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={600} size="sm" className={l.kind === 'money' ? 'num' : undefined} lineClamp={1}>
                {l.kind === 'money' ? money(l.amount, l.currency) : l.item}
              </Text>
              {l.kind === 'item' && <span className="pfd-tag">Objeto</span>}
              {l.overdue && (
                <span className="pfd-tag" data-tone="ocre">
                  Vencido
                </span>
              )}
            </Group>
            <Text size="xs" c="dimmed" className="num" lineClamp={1}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </div>
        </UnstyledButton>
        <Group gap={4} wrap="nowrap">
          {!l.closed_on && (
            <Button size="compact-xs" variant="default" leftSection={<IconArrowBackUp size={13} />} onClick={onReturn}>
              {l.kind === 'money' ? 'Devolución' : 'Devuelto'}
            </Button>
          )}
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Más opciones">
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={onEdit}>Editar</Menu.Item>
              {!l.closed_on && l.kind === 'money' && (
                <Menu.Item color="red" onClick={forgive}>
                  Perdonar deuda
                </Menu.Item>
              )}
              {l.closed_on && <Menu.Item onClick={() => act(() => api.post(`/loans/${l.id}/close`, { reason: 'reopen' }), `Préstamo a ${l.person} reabierto`)}>Reabrir</Menu.Item>}
              <Menu.Item color="red" onClick={remove}>
                Eliminar
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <Collapse in={open}>
        <dl className="pfd-debtor-details">
          {l.kind === 'money' && l.item && (
            <>
              <dt>Para</dt>
              <dd>{l.item}</dd>
            </>
          )}
          <dt>Prestado</dt>
          <dd>
            {date(l.lent_on, 'D MMM YYYY')} ({ago(l.lent_on)})
          </dd>
          {l.due_on && (
            <>
              <dt>Devolver antes del</dt>
              <dd>{date(l.due_on, 'D MMM YYYY')}</dd>
            </>
          )}
          {l.first_due && (
            <>
              <dt>Plan</dt>
              <dd className="num">
                {(l.installments ?? 1) > 1 ? `${l.installments} cuotas` : 'Un pago'}
                {(l.installments ?? 1) > 1 && l.period_unit && ` cada ${l.period_count ?? 1} ${PERIOD[l.period_unit][(l.period_count ?? 1) > 1 ? 1 : 0]}`}
                {l.indexed ? ' · ajusta por inflación' : ''}
                {l.interest_rate ? ` · ${l.indexed ? '+ ' : ''}${String(l.interest_rate).replace('.', ',')}% mensual` : l.indexed ? '' : ' · sin interés'}
                {` · total ${money(l.total, l.currency)}`}
                {l.inflation_pending && ' (puede subir con el IPC que falta)'}
              </dd>
            </>
          )}
          {l.kind === 'money' && l.returned > 0 && (
            <>
              <dt>Devolvió</dt>
              <dd className="num">
                {money(l.returned, l.currency)} de {money(l.total ?? l.amount, l.currency)}
                {!l.closed_on && <Progress value={(l.returned / (l.total ?? l.amount ?? 1)) * 100} size={6} mt={4} color="teal" aria-label="Devuelto" />}
              </dd>
            </>
          )}
          {l.returns.length > 0 && (
            <>
              <dt>Devoluciones</dt>
              <dd>
                {l.returns.map((r) => (
                  <div key={r.id} className="num">
                    {date(r.date, 'D MMM')}
                    {r.amount != null && ` · ${money(r.amount, l.currency)}`}
                    {r.note && <Text span c="dimmed">{` · ${r.note}`}</Text>}
                  </div>
                ))}
              </dd>
            </>
          )}
          {l.notes && (
            <>
              <dt>Notas</dt>
              <dd>{l.notes}</dd>
            </>
          )}
        </dl>
      </Collapse>
    </div>
  );
}

function LoanModal({ loan, people, onClose }: { loan: Loan | null; people: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'money' | 'item'>(loan?.kind ?? 'money');
  const [person, setPerson] = useState(loan?.person ?? '');
  const [amount, setAmount] = useState<number | string>(loan?.amount ? fromCents(loan.amount) : '');
  const [currency, setCurrency] = useState<Currency>(loan?.currency ?? 'ARS');
  const [item, setItem] = useState(loan?.item ?? '');
  const [lentOn, setLentOn] = useState<string>(loan?.lent_on ?? today());
  const [dueOn, setDueOn] = useState<string | null>(loan?.due_on ?? null);
  const [notes, setNotes] = useState(loan?.notes ?? '');
  // Interest and installments: agreed when the loan is created, fixed afterwards.
  const locked = !!loan?.first_due;
  const [terms, setTerms] = useState(!!loan?.first_due);
  // Interest: none, a fixed monthly rate, or tied to inflation (with an optional rate on top).
  const [mode, setMode] = useState<'none' | 'fixed' | 'ipc'>(loan?.indexed ? 'ipc' : loan?.interest_rate ? 'fixed' : 'none');
  const [rate, setRate] = useState<number | string>(loan?.interest_rate || '');
  const [count, setCount] = useState<number | string>(loan?.installments ?? 1);
  const [firstDue, setFirstDue] = useState<string | null>(loan?.first_due ?? null);
  const [every, setEvery] = useState<number | string>(loan?.period_count ?? 1);
  const [unit, setUnit] = useState<'day' | 'week' | 'month'>(loan?.period_unit ?? 'month');
  const rateValue = mode === 'none' ? 0 : Number(rate) || 0;
  // The plan as the server works it out (same maths, CPI as published today).
  const previewParams = {
    amount: toCents(amount),
    interest_rate: rateValue,
    installments: Number(count) || 1,
    first_due: firstDue ?? '',
    lent_on: lentOn,
    period_unit: unit,
    period_count: Number(every) || 1,
    indexed: mode === 'ipc' ? 1 : 0,
  };
  const preview = useQuery({
    queryKey: ['loans', 'preview', previewParams],
    queryFn: () => api.get<{ installments: { n: number; due: string; amount: number }[] }>(`/loans/preview${qs(previewParams)}`),
    enabled: terms && kind === 'money' && toCents(amount) > 0 && !!firstDue,
    placeholderData: (prev) => prev,
  });
  const plan = terms && kind === 'money' && firstDue ? (preview.data?.installments ?? []).map((i) => i.amount) : [];
  const planTotal = plan.reduce((a, b) => a + b, 0);
  const sameAmounts = plan.every((a) => a === plan[0]);
  const [bad, setBad] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const fail = (e: unknown) => {
      setBad(errorFields(e));
      notifyError(e);
    };
    if (!person.trim()) return fail(new FieldError('Escribí a quién le prestaste.', ['person']));
    if (kind === 'money' && !(toCents(amount) > 0)) return fail(new FieldError('Indicá cuánto prestaste.', ['amount']));
    if (kind === 'item' && !item.trim()) return fail(new FieldError('Indicá qué prestaste.', ['item']));
    if (terms && kind === 'money' && !firstDue) return fail(new FieldError('Indicá cuándo vence la primera cuota.', ['first_due']));
    setSaving(true);
    const withTerms = terms && kind === 'money';
    const body = {
      person,
      kind,
      item: item || null,
      amount: kind === 'money' ? toCents(amount) : null,
      currency,
      lent_on: lentOn,
      due_on: withTerms ? null : dueOn,
      notes: notes || null,
      interest_rate: withTerms ? rateValue : null,
      installments: withTerms ? Number(count) || 1 : null,
      first_due: withTerms ? firstDue : null,
      period_unit: withTerms && (Number(count) || 1) > 1 ? unit : null,
      period_count: withTerms && (Number(count) || 1) > 1 ? Number(every) || 1 : null,
      indexed: withTerms && mode === 'ipc',
    };
    try {
      if (loan) await api.put(`/loans/${loan.id}`, body);
      else await api.post('/loans', body);
      notifyOk(loan ? `Préstamo a ${person} actualizado` : `Préstamo a ${person} anotado`);
      qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{loan ? 'Editar préstamo' : 'Nuevo préstamo'}</Text>}>
      <Stack gap="sm">
        <SegmentedControl
          fullWidth
          value={kind}
          onChange={(v) => setKind(v as 'money' | 'item')}
          data={[
            { value: 'money', label: 'Dinero' },
            { value: 'item', label: 'Objeto' },
          ]}
        />
        <Autocomplete label="¿A quién?" placeholder="Nombre" data={people} value={person} onChange={setPerson} error={bad.includes('person')} required data-autofocus />
        {kind === 'money' ? (
          <>
            <Group gap="sm" wrap="nowrap" align="flex-end">
              <MoneyInput label="Monto" currency={currency} value={amount} onChange={setAmount} error={bad.includes('amount')} required style={{ flex: 1 }} disabled={locked} />
              <Select w={96} aria-label="Moneda" data={['ARS', 'USD']} value={currency} onChange={(v) => v && setCurrency(v as Currency)} allowDeselect={false} disabled={locked} />
            </Group>
            <TextInput label="¿Para qué? (opcional)" placeholder="Ej: el seguro del auto" value={item} onChange={(e) => setItem(e.currentTarget.value)} />
          </>
        ) : (
          <TextInput label="¿Qué le prestaste?" placeholder="Ej: taladro, libro, carpa" value={item} onChange={(e) => setItem(e.currentTarget.value)} error={bad.includes('item')} required />
        )}
        <SimpleGrid cols={2}>
          <DateInput label="Fecha" valueFormat="DD/MM/YYYY" value={lentOn} onChange={(v) => v && setLentOn(v)} required disabled={locked} />
          {!(terms && kind === 'money') && (
            <DateInput label="Devolver antes de" placeholder="Opcional" valueFormat="DD/MM/YYYY" value={dueOn} onChange={setDueOn} clearable error={bad.includes('due_on')} />
          )}
        </SimpleGrid>
        {kind === 'money' && (
          <Stack gap="xs" className="pfd-loan-terms">
            <Switch
              label="Con interés o en cuotas"
              checked={terms}
              disabled={locked}
              onChange={(e) => setTerms(e.currentTarget.checked)}
            />
            {terms && (
              <>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={mode}
                  onChange={(v) => setMode(v as typeof mode)}
                  disabled={locked}
                  data={[
                    { value: 'none', label: 'Sin interés' },
                    { value: 'fixed', label: 'Interés fijo' },
                    { value: 'ipc', label: 'Inflación' },
                  ]}
                />
                <SimpleGrid cols={mode === 'none' ? 2 : 3}>
                  {mode !== 'none' && (
                    <NumberInput
                      label={mode === 'ipc' ? 'Más interés' : 'Interés mensual'}
                      description={mode === 'ipc' ? 'Opcional, por mes' : undefined}
                      suffix="%"
                      min={0}
                      max={50}
                      decimalScale={2}
                      decimalSeparator=","
                      hideControls
                      placeholder="0"
                      value={rate}
                      onChange={setRate}
                      disabled={locked}
                    />
                  )}
                  <NumberInput label="Cuotas" min={1} max={60} hideControls value={count} onChange={setCount} disabled={locked} />
                  <DateInput
                    label="Primera cuota"
                    valueFormat="DD/MM/YYYY"
                    placeholder="DD/MM/AAAA"
                    minDate={dayjs(lentOn).add(1, 'day').format('YYYY-MM-DD')}
                    value={firstDue}
                    onChange={setFirstDue}
                    error={bad.includes('first_due')}
                    disabled={locked}
                    required
                  />
                </SimpleGrid>
                {(Number(count) || 1) > 1 && (
                  <Group gap="xs" wrap="nowrap" align="flex-end">
                    <NumberInput label="Una cuota cada" min={1} max={365} hideControls value={every} onChange={setEvery} disabled={locked} w={120} />
                    <Select
                      aria-label="Unidad"
                      w={120}
                      data={[
                        { value: 'month', label: Number(every) === 1 ? 'mes' : 'meses' },
                        { value: 'week', label: Number(every) === 1 ? 'semana' : 'semanas' },
                        { value: 'day', label: Number(every) === 1 ? 'día' : 'días' },
                      ]}
                      value={unit}
                      onChange={(v) => v && setUnit(v as typeof unit)}
                      allowDeselect={false}
                      disabled={locked}
                    />
                  </Group>
                )}
                {plan.length > 0 && (
                  <div className="pfd-loan-plan">
                    <Text size="sm" fw={600}>
                      {plan.length > 1
                        ? sameAmounts
                          ? `${plan.length} cuotas de ${money(plan[0], currency)}`
                          : `${plan.length} cuotas, desde ${money(Math.min(...plan), currency)}`
                        : `Un pago de ${money(plan[0], currency)}`}
                    </Text>
                    {mode !== 'ipc' && planTotal > toCents(amount) && (
                      <Text size="xs" c="dimmed">
                        Total {money(planTotal, currency)} · interés {money(planTotal - toCents(amount), currency)}
                      </Text>
                    )}
                    {mode === 'ipc' && (
                      <Text size="xs" c="dimmed">
                        Con la inflación publicada hasta hoy. Cada cuota se ajusta con el IPC desde el préstamo; si el de un mes todavía no salió, se suma a la cuota siguiente.
                      </Text>
                    )}
                  </div>
                )}
                <Text size="xs" c="dimmed">
                  {locked ? 'El interés, la inflación y las cuotas quedaron fijos al crear el préstamo.' : 'Una vez guardado no se puede cambiar. Cada cuota aparece en Pendientes → Cobros.'}
                </Text>
              </>
            )}
          </Stack>
        )}
        <Textarea label="Notas" autosize minRows={1} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
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

function ReturnModal({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const qc = useQueryClient();
  const dueNow = loan.next_installment?.remaining ?? loan.outstanding ?? 0;
  const [amount, setAmount] = useState<number | string>(fromCents(dueNow));
  const [noteBad, setNoteBad] = useState(false);
  const [when, setWhen] = useState<string>(today());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const money_ = loan.kind === 'money';

  const partial = money_ && toCents(amount) > 0 && toCents(amount) < dueNow;
  const save = async () => {
    if (partial && !note.trim()) {
      setNoteBad(true);
      return notifyError(new FieldError('Es un pago parcial: escribí por qué no se devolvió todo.', ['note']));
    }
    setSaving(true);
    try {
      await api.post(`/loans/${loan.id}/returns`, { date: when, amount: money_ ? toCents(amount) : null, note: note || null });
      notifyOk(
        !money_
          ? `${loan.person} devolvió ${loan.item}`
          : toCents(amount) < (loan.outstanding ?? 0)
            ? `Devolución de ${money(toCents(amount), loan.currency)} de ${loan.person} anotada`
            : `${loan.person} saldó el préstamo: ${money(toCents(amount), loan.currency)}`,
      );
      qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{money_ ? `Devolución de ${loan.person}` : `${loan.person} devolvió ${loan.item}`}</Text>}>
      <Stack gap="sm">
        {money_ && (
          <MoneyInput
            label="¿Cuánto te devolvió?"
            description={
              loan.next_installment && (loan.installments ?? 1) > 1
                ? `Cuota ${loan.next_installment.n}: ${money(loan.next_installment.remaining, loan.currency)}. En total falta ${money(loan.outstanding, loan.currency)}.`
                : `Falta ${money(loan.outstanding, loan.currency)}. Si es menos, queda anotado como parcial.`
            }
            currency={loan.currency}
            value={amount}
            onChange={setAmount}
            data-autofocus
          />
        )}
        <DateInput label="Fecha" valueFormat="DD/MM/YYYY" value={when} onChange={(v) => v && setWhen(v)} />
        <TextInput
          label={partial ? '¿Por qué es parcial?' : 'Nota (opcional)'}
          placeholder={partial ? 'Ej: me dijo que el resto a fin de mes' : 'Ej: por transferencia'}
          value={note}
          onChange={(e) => {
            setNoteBad(false);
            setNote(e.currentTarget.value);
          }}
          error={noteBad}
          required={partial}
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={money_ && !(toCents(amount) > 0)}>
            {money_ ? 'Anotar devolución' : 'Marcar devuelto'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
