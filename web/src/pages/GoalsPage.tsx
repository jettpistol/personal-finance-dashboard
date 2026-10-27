import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  AspectRatio,
  Box,
  Button,
  Card,
  Collapse,
  FileButton,
  Group,
  Image,
  Menu,
  Modal,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import {
  IconCash,
  IconChevronDown,
  IconDots,
  IconEdit,
  IconExternalLink,
  IconInfoCircle,
  IconPhoto,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/Layout';
import { AccountSelect, MoneyInput } from '../components/inputs';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import { MANTINE_COLORS, date, fromCents, money, toCents, today } from '../lib/format';
import { compressImage } from '../lib/image';
import { notifyError, notifyOk, useRefreshData } from '../lib/queries';
import type { Currency, Goal, Scope } from '../lib/types';

type Priority = 'high' | 'medium' | 'low';

/** A goal ("objetivo") with its picture, link, notes and priority. */
type Objective = Goal & { url: string | null; notes: string | null; priority: Priority | null; image_version: string | null };

const PRIORITY: Record<Priority, { label: string; tone?: string }> = {
  high: { label: 'Alta' },
  medium: { label: 'Media', tone: 'grape' },
  low: { label: 'Baja', tone: 'gray' },
};

const IMAGE_RATIO = 16 / 9;
const imageUrl = (g: Objective) => `/api/goals/${g.id}/image?v=${g.image_version}`;
const validUrl = (s: string) => {
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
};
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function ImagePlaceholder({ compact }: { compact?: boolean }) {
  return (
    <Stack
      h="100%"
      gap={4}
      align="center"
      justify="center"
      style={{ background: 'linear-gradient(var(--pfd-strip-top, #fbfcfd), var(--pfd-strip-bottom, #e8ecf2))', color: 'var(--pfd-ink-2)' }}
    >
      <IconPhoto size={compact ? 20 : 32} stroke={1.4} />
      {!compact && <Text size="xs">Sin imagen</Text>}
    </Stack>
  );
}

type Form = {
  name: string;
  target_amount: number | string;
  currency: Currency;
  deadline: string | null;
  account_id: number | null;
  scope: Scope;
  color: string | null;
  archived: boolean;
  url: string;
  notes: string;
  priority: Priority | null;
};

function GoalModal({ goal, onClose }: { goal: Objective | null; onClose: () => void }) {
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
          url: goal.url ?? '',
          notes: goal.notes ?? '',
          priority: goal.priority,
        }
      : {
          name: '',
          target_amount: '',
          currency: 'ARS',
          deadline: null,
          account_id: null,
          scope: scope === `user:${me.id}` ? scope : 'household',
          color: 'teal',
          archived: false,
          url: '',
          notes: '',
          priority: null,
        },
  );
  // Picture: a newly chosen file, or the request to drop the current one.
  const [file, setFile] = useState<File | null>(null);
  const [dropImage, setDropImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (fileUrl && URL.revokeObjectURL(fileUrl)), [fileUrl]);
  const preview = fileUrl ?? (goal?.image_version && !dropImage ? imageUrl(goal) : null);

  const url = form.url.trim();
  const urlError = url && !validUrl(url) ? 'Tiene que ser un enlace completo, que empiece con http:// o https://' : null;

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, url: url || null, notes: form.notes.trim() || null, target_amount: toCents(form.target_amount) };
      let id = goal?.id;
      if (goal) await api.put(`/goals/${goal.id}`, body);
      else id = (await api.post<{ id: number }>('/goals', body)).id;
      if (file && id) {
        const blob = await compressImage(file, 1200, 0.8);
        await api.upload(`/goals/${id}/image`, blob, 'file', blob.type === 'image/jpeg' ? 'objetivo.jpg' : file.name);
      } else if (dropImage && goal?.image_version) {
        await api.del(`/goals/${goal.id}/image`);
      }
      notifyOk(goal ? 'Objetivo actualizado' : 'Objetivo creado');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{goal ? 'Editar objetivo' : 'Nuevo objetivo'}</Text>}>
      <Stack gap="sm">
        <TextInput label="Nombre" placeholder="Ej: Fondo de emergencia, Viaje 2027, Bici nueva" value={form.name} onChange={(e) => set('name', e.currentTarget.value)} data-autofocus required />
        <SimpleGrid cols={2}>
          <MoneyInput label="Monto objetivo" currency={form.currency} value={form.target_amount} onChange={(v) => set('target_amount', v)} />
          <Select label="Moneda" value={form.currency} onChange={(v) => v && set('currency', v as Currency)} data={['ARS', 'USD']} allowDeselect={false} />
        </SimpleGrid>
        <SimpleGrid cols={2}>
          <DateInput label="Fecha límite" placeholder="Opcional" clearable value={form.deadline} onChange={(v) => set('deadline', v)} valueFormat="DD/MM/YYYY" minDate={today()} />
          <Select
            label="Prioridad"
            placeholder="Sin prioridad"
            clearable
            value={form.priority}
            onChange={(v) => set('priority', v as Priority | null)}
            data={(Object.keys(PRIORITY) as Priority[]).map((p) => ({ value: p, label: PRIORITY[p].label }))}
          />
        </SimpleGrid>
        <AccountSelect
          label="Cuenta vinculada"
          description="Si la vinculás, el avance es el saldo de esa cuenta: lo que haya ahí cuenta como aportado. Si no, registrás los aportes a mano."
          placeholder="Sin vincular (aportes manuales)"
          clearable
          value={form.account_id}
          onChange={(v) => set('account_id', v)}
        />

        <div>
          <Text size="sm" fw={500} mb={4}>
            Imagen
          </Text>
          <Group gap="sm" wrap="nowrap" align="center">
            <Box w={128} style={{ flex: 'none', border: '1px solid var(--pfd-rule)' }}>
              <AspectRatio ratio={IMAGE_RATIO}>{preview ? <Image src={preview} alt="" fit="cover" /> : <ImagePlaceholder compact />}</AspectRatio>
            </Box>
            <Stack gap={4} align="flex-start" style={{ minWidth: 0 }}>
              <Group gap="xs">
                <FileButton
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(f) => {
                    setFile(f);
                    if (f) setDropImage(false);
                  }}
                >
                  {(props) => (
                    <Button {...props} size="xs" variant="default" leftSection={<IconPhoto size={14} />}>
                      {preview ? 'Reemplazar' : 'Elegir imagen'}
                    </Button>
                  )}
                </FileButton>
                {preview && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={() => {
                      setFile(null);
                      setDropImage(true);
                    }}
                  >
                    Quitar
                  </Button>
                )}
              </Group>
              <Text size="xs" c="var(--pfd-ink-2)">
                JPG, PNG o WEBP. Se recorta para la tarjeta.
              </Text>
            </Stack>
          </Group>
        </div>

        <TextInput
          label="Enlace"
          description="Por ejemplo, la página del producto o de la reserva."
          placeholder="https://…"
          type="url"
          value={form.url}
          onChange={(e) => set('url', e.currentTarget.value)}
          error={urlError}
        />
        <Textarea
          label="Notas"
          placeholder="Opcional: modelo, talle, a quién preguntar…"
          autosize
          minRows={2}
          maxRows={5}
          maxLength={500}
          value={form.notes}
          onChange={(e) => set('notes', e.currentTarget.value)}
        />
        <SimpleGrid cols={2}>
          <Select
            label="Ámbito"
            value={form.scope}
            onChange={(v) => v && set('scope', v as Scope)}
            data={[
              { value: 'household', label: 'Hogar (de los dos)' },
              { value: `user:${me.id}`, label: 'Mío' },
            ]}
            allowDeselect={false}
          />
          <Select label="Color" value={form.color} onChange={(v) => set('color', v)} data={MANTINE_COLORS} clearable />
        </SimpleGrid>
        {goal && <Switch label="Archivado" checked={form.archived} onChange={(e) => set('archived', e.currentTarget.checked)} />}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!form.name.trim() || toCents(form.target_amount) <= 0 || !!urlError}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type Contribution = { id: number; goal_id: number; date: string; amount: number; note: string | null };

function ContributionsModal({ goal, onClose }: { goal: Objective; onClose: () => void }) {
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

/** How a goal's progress is measured: the linked account's balance, or contributions recorded by hand. */
function Tracking({ g, editable, onContrib }: { g: Objective; editable: boolean; onContrib: () => void }) {
  if (g.account_id) {
    return (
      <Tooltip
        multiline
        w={260}
        withArrow
        events={{ hover: true, focus: true, touch: true }}
        label={`El avance es el saldo actual de ${g.account_name ?? 'la cuenta vinculada'}: todo lo que haya en esa cuenta se toma como aportado. Para sumar, registrá un depósito o una transferencia a esa cuenta en Movimientos.`}
      >
        <UnstyledButton style={{ minWidth: 0 }} aria-label={`Sigue el saldo de ${g.account_name ?? 'la cuenta vinculada'}. Más información`}>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="var(--pfd-ink-2)" truncate>
              Sigue el saldo de <b>{g.account_name ?? 'una cuenta'}</b>
            </Text>
            <IconInfoCircle size={14} color="var(--pfd-ink-2)" style={{ flex: 'none' }} />
          </Group>
        </UnstyledButton>
      </Tooltip>
    );
  }
  if (editable && !g.archived) {
    return (
      <Button size="compact-sm" variant="light" leftSection={<IconPlus size={12} />} onClick={onContrib}>
        Registrar aporte
      </Button>
    );
  }
  return (
    <Text size="xs" c="var(--pfd-ink-2)">
      Aportes manuales
    </Text>
  );
}

function GoalCard({ g, onEdit, onContrib }: { g: Objective; onEdit: () => void; onContrib: () => void }) {
  const { me } = useApp();
  const refresh = useRefreshData();
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const editable = g.scope === 'household' || g.scope === `user:${me.id}`;
  const color = g.color ?? 'teal';
  const done = g.saved >= g.target_amount;
  const prio = g.priority ? PRIORITY[g.priority] : null;

  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar objetivo',
      children: <Text size="sm">¿Eliminar «{g.name}», su imagen y sus aportes registrados?</Text>,
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
    <Card opacity={g.archived ? 0.6 : 1} style={{ display: 'flex', flexDirection: 'column' }}>
      <Card.Section style={{ position: 'relative', borderBottom: '1px solid var(--pfd-rule)' }}>
        <AspectRatio ratio={IMAGE_RATIO}>
          {g.image_version && !broken ? <Image src={imageUrl(g)} alt={g.name} fit="cover" loading="lazy" onError={() => setBroken(true)} /> : <ImagePlaceholder />}
        </AspectRatio>
        {(prio || !!g.archived) && (
          <Group gap={4} style={{ position: 'absolute', top: 8, left: 8 }}>
            {prio && (
              <span className="pfd-tag" data-tone={prio.tone}>
                Prioridad {prio.label}
              </span>
            )}
            {!!g.archived && (
              <span className="pfd-tag" data-tone="gray">
                Archivado
              </span>
            )}
          </Group>
        )}
      </Card.Section>

      <Group justify="space-between" align="flex-start" wrap="nowrap" mt="sm">
        <div style={{ minWidth: 0 }}>
          <Text fw={700} lineClamp={1} title={g.name}>
            {g.name}
          </Text>
          <Group gap={6} mt={2} wrap="nowrap">
            <Text size="xs" c="var(--pfd-ink-2)" style={{ flex: 'none' }}>
              {g.scope === 'household' ? 'Hogar' : 'Personal'}
            </Text>
            {g.url && (
              <>
                <Text size="xs" c="var(--pfd-ink-2)" aria-hidden>
                  ·
                </Text>
                <Anchor size="xs" href={g.url} target="_blank" rel="noopener noreferrer" title={hostOf(g.url)} style={{ whiteSpace: 'nowrap' }}>
                  Ver enlace <IconExternalLink size={11} style={{ verticalAlign: '-1px' }} />
                </Anchor>
              </>
            )}
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

      <Group mt="xs" justify="space-between" align="flex-end" wrap="nowrap" gap="sm">
        <div style={{ minWidth: 0 }}>
          <Text className="num" fw={800} fz="lg" lh={1.2}>
            {money(g.saved, g.currency)}
          </Text>
          <Text size="xs" c="var(--pfd-ink-2)" className="num">
            de {money(g.target_amount, g.currency)}
          </Text>
        </div>
        <Text size="sm" fw={700} className="num">
          {Math.round(g.pct)}%
        </Text>
      </Group>
      <Progress mt={6} value={Math.max(0, Math.min(100, g.pct))} color={done ? 'teal.7' : `${color}.7`} size={10} aria-label={`Avance de ${g.name}`} />
      <Text size="sm" mt="xs" fw={done ? 600 : undefined}>
        {done
          ? 'Objetivo cumplido.'
          : g.monthly_needed != null
            ? `Necesitás ahorrar ${money(g.monthly_needed, g.currency)} por mes`
            : `Faltan ${money(g.remaining, g.currency)}`}
      </Text>
      {g.deadline && (
        <Text size="xs" c="var(--pfd-ink-2)">
          Para el {date(g.deadline)}
          {g.months_left != null && ` · ${g.months_left} ${g.months_left === 1 ? 'mes' : 'meses'}`}
        </Text>
      )}

      <Group justify="space-between" wrap="nowrap" gap="xs" mt="auto" pt="sm" style={{ borderTop: '1px solid var(--pfd-rule)' }}>
        <div style={{ minWidth: 0 }}>
          <Tracking g={g} editable={editable} onContrib={onContrib} />
        </div>
        <Anchor component="button" size="xs" fw={600} onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          Detalles
          <IconChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
        </Anchor>
      </Group>
      <Collapse in={open} transitionDuration={150}>
        <Stack gap={6} pt="xs">
          <div>
            <Text size="xs" fw={700} c="var(--pfd-ink-2)">
              Notas
            </Text>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} c={g.notes ? undefined : 'var(--pfd-ink-2)'}>
              {g.notes || 'Sin notas.'}
            </Text>
          </div>
          <div>
            <Text size="xs" fw={700} c="var(--pfd-ink-2)">
              Cómo se mide
            </Text>
            <Text size="sm">
              {g.account_id
                ? `Con el saldo de ${g.account_name ?? 'la cuenta vinculada'}: cada movimiento de esa cuenta mueve el avance.`
                : 'Con los aportes que registrás a mano. No mueven el saldo de ninguna cuenta.'}
            </Text>
            {!g.account_id && editable && (
              <Anchor component="button" size="xs" onClick={onContrib}>
                Ver historial de aportes
              </Anchor>
            )}
          </div>
          {g.url && (
            <Text size="xs" c="var(--pfd-ink-2)" truncate>
              Enlace: {hostOf(g.url)}
            </Text>
          )}
        </Stack>
      </Collapse>
    </Card>
  );
}

export function GoalsPage() {
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api.get<Objective[]>('/goals') });
  const [editing, setEditing] = useState<Objective | null | 'new'>(null);
  const [contrib, setContrib] = useState<Objective | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = (goals.data ?? []).filter((g) => showArchived || !g.archived);

  return (
    <>
      <PageHeader
        title="Objetivos"
        description="Lo que quieren lograr: fondo de emergencia, un viaje, una bici, un futuro auto…"
        actions={
          <>
            <Switch size="sm" label="Mostrar archivados" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              Nuevo objetivo
            </Button>
          </>
        }
      />
      {goals.isLoading && <Text c="dimmed">Cargando…</Text>}
      {goals.data && !list.length && (
        <Card>
          <Text c="dimmed" ta="center">
            Todavía no hay objetivos. Creá uno para seguir lo que van ahorrando para algo.
          </Text>
        </Card>
      )}
      {/* Cards keep their own height, so opening one card's details does not stretch its neighbours. */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} style={{ alignItems: 'start' }}>
        {list.map((g) => (
          <GoalCard key={g.id} g={g} onEdit={() => setEditing(g)} onContrib={() => setContrib(g)} />
        ))}
      </SimpleGrid>
      {editing && <GoalModal goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {contrib && <ContributionsModal goal={contrib} onClose={() => setContrib(null)} />}
    </>
  );
}
