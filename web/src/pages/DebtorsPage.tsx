import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconArrowBackUp, IconCopy, IconDots, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { PageHeader } from '../components/Layout';
import { MoneyInput } from '../components/inputs';
import { api } from '../lib/api';
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
  returns: LoanReturn[];
  returned: number;
  outstanding: number | null;
  overdue: boolean;
};

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

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
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
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reload();
    } catch (e) {
      notifyError(e);
    }
  };
  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar préstamo',
      children: <Text size="sm">Se borra el préstamo y sus devoluciones anotadas.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => act(() => api.del(`/loans/${l.id}`)),
    });

  const partial = l.kind === 'money' && l.returned > 0 && !l.closed_on;
  return (
    <div className="pfd-debtor-row" data-closed={l.closed_on ? true : undefined}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
        <div style={{ minWidth: 0, flex: 1 }}>
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
            {l.closed_reason === 'returned' && (
              <span className="pfd-tag" data-tone="gray">
                Devuelto
              </span>
            )}
            {l.closed_reason === 'forgiven' && (
              <span className="pfd-tag" data-tone="gray">
                Perdonado
              </span>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {l.kind === 'money' && l.item ? `${l.item} · ` : ''}
            {date(l.lent_on, 'D MMM YYYY')} ({ago(l.lent_on)})
            {l.due_on && !l.closed_on && ` · devolver antes del ${date(l.due_on, 'D MMM')}`}
            {l.closed_on && ` · ${l.closed_reason === 'forgiven' ? 'perdonado' : 'devuelto'} el ${date(l.closed_on, 'D MMM YYYY')}`}
          </Text>
          {partial && (
            <>
              <Progress value={(l.returned / (l.amount ?? 1)) * 100} size={6} mt={6} color="teal" aria-label="Devuelto" />
              <Text size="xs" mt={2} className="num">
                Devolvió {money(l.returned, l.currency)} · falta <b>{money(l.outstanding, l.currency)}</b>
              </Text>
            </>
          )}
          {l.notes && (
            <Text size="xs" c="dimmed" fs="italic" mt={2}>
              {l.notes}
            </Text>
          )}
        </div>
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
              {!l.closed_on && l.kind === 'money' && <Menu.Item onClick={() => act(() => api.post(`/loans/${l.id}/close`, { reason: 'forgiven' }))}>Perdonar lo que falta</Menu.Item>}
              {l.closed_on && <Menu.Item onClick={() => act(() => api.post(`/loans/${l.id}/close`, { reason: 'reopen' }))}>Reabrir</Menu.Item>}
              <Menu.Item color="red" onClick={remove}>
                Eliminar
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
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
    setSaving(true);
    const body = { person, kind, item: item || null, amount: kind === 'money' ? toCents(amount) : null, currency, lent_on: lentOn, due_on: dueOn, notes: notes || null };
    try {
      if (loan) await api.put(`/loans/${loan.id}`, body);
      else await api.post('/loans', body);
      notifyOk('Préstamo guardado');
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
              <MoneyInput label="Monto" currency={currency} value={amount} onChange={setAmount} error={bad.includes('amount')} required style={{ flex: 1 }} />
              <Select w={96} aria-label="Moneda" data={['ARS', 'USD']} value={currency} onChange={(v) => v && setCurrency(v as Currency)} allowDeselect={false} />
            </Group>
            <TextInput label="¿Para qué? (opcional)" placeholder="Ej: el seguro del auto" value={item} onChange={(e) => setItem(e.currentTarget.value)} />
          </>
        ) : (
          <TextInput label="¿Qué le prestaste?" placeholder="Ej: taladro, libro, carpa" value={item} onChange={(e) => setItem(e.currentTarget.value)} error={bad.includes('item')} required />
        )}
        <SimpleGrid cols={2}>
          <DateInput label="Fecha" valueFormat="DD/MM/YYYY" value={lentOn} onChange={(v) => v && setLentOn(v)} required />
          <DateInput label="Devolver antes de" placeholder="Opcional" valueFormat="DD/MM/YYYY" value={dueOn} onChange={setDueOn} clearable error={bad.includes('due_on')} />
        </SimpleGrid>
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
  const [amount, setAmount] = useState<number | string>(fromCents(loan.outstanding));
  const [when, setWhen] = useState<string>(today());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const money_ = loan.kind === 'money';

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/loans/${loan.id}/returns`, { date: when, amount: money_ ? toCents(amount) : null, note: note || null });
      notifyOk(money_ && toCents(amount) < (loan.outstanding ?? 0) ? 'Devolución parcial anotada' : 'Préstamo saldado');
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
            description={`Falta ${money(loan.outstanding, loan.currency)}. Si es menos, queda anotado como parcial.`}
            currency={loan.currency}
            value={amount}
            onChange={setAmount}
            data-autofocus
          />
        )}
        <DateInput label="Fecha" valueFormat="DD/MM/YYYY" value={when} onChange={(v) => v && setWhen(v)} />
        <TextInput label="Nota (opcional)" placeholder="Ej: por transferencia" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
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
