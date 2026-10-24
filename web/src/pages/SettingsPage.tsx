import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  CheckIcon,
  Code,
  ColorSwatch,
  Group,
  List,
  Menu,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput, MonthPickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconDots, IconDownload, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download, qs } from '../lib/api';
import { useApp } from '../lib/app-state';
import { date, MANTINE_COLORS, monthName, today } from '../lib/format';
import { notifyError, notifyOk, useCategories, useMe, useSettings, useUsers } from '../lib/queries';
import type { Category, FxRate, Settings } from '../lib/types';
import { PageHeader } from '../components/Layout';

export function SettingsPage() {
  const [tab, setTab] = useState<string | null>('profile');
  return (
    <>
      <PageHeader title="Ajustes" />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md" style={{ flexWrap: 'wrap' }}>
          <Tabs.Tab value="profile">Perfil</Tabs.Tab>
          <Tabs.Tab value="notifications">Notificaciones</Tabs.Tab>
          <Tabs.Tab value="household">Hogar</Tabs.Tab>
          <Tabs.Tab value="categories">Categorías</Tabs.Tab>
          <Tabs.Tab value="rates">Cotizaciones e inflación</Tabs.Tab>
          <Tabs.Tab value="data">Datos</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="profile">
          <ProfileTab />
        </Tabs.Panel>
        <Tabs.Panel value="notifications">
          <NotificationsTab />
        </Tabs.Panel>
        <Tabs.Panel value="household">
          <HouseholdTab />
        </Tabs.Panel>
        <Tabs.Panel value="categories">
          <CategoriesTab />
        </Tabs.Panel>
        <Tabs.Panel value="rates">
          <RatesTab />
        </Tabs.Panel>
        <Tabs.Panel value="data">
          <DataTab />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

function ColorPicker({ value, onChange }: { value: string | null | undefined; onChange: (c: string) => void }) {
  return (
    <Group gap={6}>
      {MANTINE_COLORS.map((c) => (
        <ColorSwatch
          key={c}
          component="button"
          type="button"
          aria-label={c}
          color={`var(--mantine-color-${c}-6)`}
          onClick={() => onChange(c)}
          style={{ cursor: 'pointer', color: '#fff' }}
          size={24}
        >
          {value === c && <CheckIcon style={{ width: 10, height: 10 }} />}
        </ColorSwatch>
      ))}
    </Group>
  );
}

// ---- Perfil ----

function ProfileTab() {
  const qc = useQueryClient();
  const me = useMe();
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [share, setShare] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.display_name);
    setColor(me.data.color);
    setShare(!!me.data.share_dashboard);
  }, [me.data]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/me', { display_name: name, color, share_dashboard: share });
      for (const k of ['me', 'users', 'auth']) qc.invalidateQueries({ queryKey: [k] });
      notifyOk('Perfil actualizado');
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pw.next !== pw.repeat) return notifyError(new Error('Las contraseñas nuevas no coinciden.'));
    setSavingPw(true);
    try {
      await api.post('/auth/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', repeat: '' });
      notifyOk('Contraseña cambiada. Se cerraron tus otras sesiones.');
    } catch (e) {
      notifyError(e);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Card>
        <Stack>
          <Title order={4}>Tus datos</Title>
          <TextInput label="Usuario" value={me.data?.username ?? ''} disabled />
          <TextInput label="Nombre para mostrar" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <div>
            <Text size="sm" fw={500} mb={6}>
              Color
            </Text>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <Switch
            label="Mi pareja puede ver mi tablero personal (sin cuentas ni movimientos privados)"
            checked={share}
            onChange={(e) => setShare(e.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button onClick={save} loading={saving}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Title order={4}>Cambiar contraseña</Title>
          <PasswordInput label="Contraseña actual" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.currentTarget.value })} autoComplete="current-password" />
          <PasswordInput label="Nueva contraseña" description="Mínimo 10 caracteres" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.currentTarget.value })} autoComplete="new-password" />
          <PasswordInput label="Repetir nueva contraseña" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.currentTarget.value })} autoComplete="new-password" />
          <Group justify="flex-end">
            <Button onClick={changePassword} loading={savingPw} disabled={!pw.current || !pw.next}>
              Cambiar contraseña
            </Button>
          </Group>
        </Stack>
      </Card>
    </SimpleGrid>
  );
}

// ---- Notificaciones ----

function NotificationsTab() {
  const qc = useQueryClient();
  const me = useMe();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [chatId, setChatId] = useState('');

  useEffect(() => {
    setChatId(me.data?.telegram_chat_id ?? '');
  }, [me.data?.telegram_chat_id]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) notifyOk(ok);
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const pref = (key: 'notify_budget' | 'notify_recurring' | 'notify_review', v: boolean) => run(key, () => api.patch('/me', { [key]: v }));

  if (!me.data) return null;
  const linked = !!me.data.telegram_chat_id;

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Card>
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Telegram</Title>
            {linked ? <Badge color="teal">Vinculado</Badge> : <Badge color="gray">Sin vincular</Badge>}
          </Group>
          {!me.data.telegram_available ? (
            <Alert color="yellow" title="El bot no está configurado en el servidor">
              <List size="sm" spacing={4} type="ordered">
                <List.Item>
                  En Telegram, hablale a <b>@BotFather</b> y enviá <Code>/newbot</Code>. Elegí un nombre y te da un token.
                </List.Item>
                <List.Item>
                  En el servidor, agregá la variable <Code>TELEGRAM_BOT_TOKEN=el-token</Code> (archivo <Code>.env</Code>) y reiniciá la app.
                </List.Item>
                <List.Item>Volvé a esta pantalla para vincular tu cuenta.</List.Item>
              </List>
            </Alert>
          ) : (
            <>
              <Text size="sm" c="dimmed">
                Recibí alertas de presupuesto, recurrentes para confirmar y el cierre de mes (.docx) por Telegram.
              </Text>
              {code ? (
                <Alert color="blue">
                  <Text size="sm">
                    Abrí tu bot en Telegram y enviale:
                  </Text>
                  <Code block my="xs" fz="md">
                    /start {code}
                  </Code>
                  <Group>
                    <Button size="xs" loading={busy === 'verify'} onClick={() => run('verify', () => api.post('/me/telegram/verify', { code }).then(() => setCode(null)), 'Telegram vinculado')}>
                      Ya lo envié
                    </Button>
                    <Button size="xs" variant="subtle" onClick={() => setCode(null)}>
                      Cancelar
                    </Button>
                  </Group>
                </Alert>
              ) : (
                <Group>
                  <Button loading={busy === 'code'} onClick={() => run('code', () => api.post<{ code: string }>('/me/telegram/code').then((r) => setCode(r.code)))}>
                    {linked ? 'Volver a vincular' : 'Vincular Telegram'}
                  </Button>
                  {linked && (
                    <Button variant="default" loading={busy === 'test'} onClick={() => run('test', () => api.post('/me/telegram/test'), 'Mensaje de prueba enviado')}>
                      Enviar prueba
                    </Button>
                  )}
                </Group>
              )}
            </>
          )}
          <Group align="flex-end">
            <TextInput
              label="Chat ID (manual)"
              description="Opcional, si ya conocés tu chat ID"
              value={chatId}
              onChange={(e) => setChatId(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button variant="default" loading={busy === 'chat'} onClick={() => run('chat', () => api.patch('/me', { telegram_chat_id: chatId.trim() || null }), 'Chat ID guardado')}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Title order={4}>Qué avisos recibir</Title>
          <Text size="sm" c="dimmed">
            Siempre se guardan en la campanita de la app. Estas opciones controlan el envío por Telegram.
          </Text>
          <Switch label="Presupuestos al 80% y superados" checked={!!me.data.notify_budget} onChange={(e) => pref('notify_budget', e.currentTarget.checked)} />
          <Switch label="Recurrentes pendientes de confirmar" checked={!!me.data.notify_recurring} onChange={(e) => pref('notify_recurring', e.currentTarget.checked)} />
          <Switch label="Cierre de mes (documento .docx)" checked={!!me.data.notify_review} onChange={(e) => pref('notify_review', e.currentTarget.checked)} />
        </Stack>
      </Card>
    </SimpleGrid>
  );
}

// ---- Hogar ----

function HouseholdTab() {
  const qc = useQueryClient();
  const settings = useSettings();
  const users = useUsers();
  const [form, setForm] = useState<Settings | null>(null);
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
  const [saving, setSaving] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', display_name: '', password: '' });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setForm(settings.data);
    setSplitMode(Object.values(settings.data.default_split ?? {}).some((v) => v > 0) ? 'custom' : 'equal');
  }, [settings.data]);

  if (!form || !users.data) return null;
  const splitTotal = users.data.reduce((a, u) => a + Number(form.default_split[u.id] ?? 0), 0);

  const save = async () => {
    if (splitMode === 'custom' && Math.abs(splitTotal - 100) > 0.01) return notifyError(new Error('La división por defecto debe sumar 100%.'));
    setSaving(true);
    try {
      await api.patch('/settings', {
        household_name: form.household_name,
        default_split: splitMode === 'equal' ? {} : Object.fromEntries(users.data.map((u) => [String(u.id), Number(form.default_split[u.id] ?? 0)])),
        fx_side: form.fx_side,
        budget_thresholds: [...new Set(form.budget_thresholds.map(Number).filter((n) => n > 0))].sort((a, b) => a - b),
        budget_auto_index: form.budget_auto_index,
      });
      qc.invalidateQueries({ queryKey: ['settings'] });
      for (const k of ['dashboard', 'reports', 'accounts', 'balances']) qc.invalidateQueries({ queryKey: [k] });
      notifyOk('Ajustes del hogar guardados');
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const addUser = async () => {
    setAdding(true);
    try {
      await api.post('/users', { ...newUser, display_name: newUser.display_name || newUser.username });
      setNewUser({ username: '', display_name: '', password: '' });
      qc.invalidateQueries({ queryKey: ['users'] });
      notifyOk('Persona agregada. Ya puede ingresar con su usuario y contraseña.');
    } catch (e) {
      notifyError(e);
    } finally {
      setAdding(false);
    }
  };

  const thresholds = form.budget_thresholds;

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Card>
        <Stack>
          <Title order={4}>Hogar</Title>
          <TextInput label="Nombre del hogar" value={form.household_name} onChange={(e) => setForm({ ...form, household_name: e.currentTarget.value })} />
          <div>
            <Text size="sm" fw={500}>
              División por defecto de gastos compartidos
            </Text>
            <Text size="xs" c="dimmed" mb={6}>
              Se usa cuando cargás un gasto compartido sin elegir otra división. Ej: proporcional a los ingresos.
            </Text>
            <Select
              value={splitMode}
              onChange={(v) => setSplitMode((v ?? 'equal') as 'equal' | 'custom')}
              allowDeselect={false}
              data={[
                { value: 'equal', label: 'Partes iguales' },
                { value: 'custom', label: 'Porcentajes personalizados' },
              ]}
              mb="xs"
            />
            {splitMode === 'custom' && (
              <>
                <SimpleGrid cols={Math.min(users.data.length, 4)}>
                  {users.data.map((u) => (
                    <NumberInput
                      key={u.id}
                      label={u.display_name}
                      suffix="%"
                      min={0}
                      max={100}
                      decimalSeparator=","
                      value={form.default_split[u.id] ?? ''}
                      onChange={(v) => setForm({ ...form, default_split: { ...form.default_split, [u.id]: Number(v || 0) } })}
                    />
                  ))}
                </SimpleGrid>
                <Text size="xs" c={Math.abs(splitTotal - 100) < 0.01 ? 'teal' : 'red'} mt={4}>
                  Suma: {splitTotal}%
                </Text>
              </>
            )}
          </div>
          <Select
            label="Cotización BNA para convertir"
            description="Dólar oficial del Banco Nación del día de cada movimiento"
            value={form.fx_side}
            onChange={(v) => setForm({ ...form, fx_side: (v ?? 'sell') as Settings['fx_side'] })}
            allowDeselect={false}
            data={[
              { value: 'sell', label: 'Vendedor (lo que pagás al comprar dólares)' },
              { value: 'buy', label: 'Comprador (lo que te pagan al vender)' },
              { value: 'avg', label: 'Promedio' },
            ]}
          />
          <SimpleGrid cols={2}>
            <NumberInput
              label="Primer aviso de presupuesto"
              suffix="%"
              min={1}
              max={200}
              value={thresholds[0] ?? 80}
              onChange={(v) => setForm({ ...form, budget_thresholds: [Number(v || 0), thresholds[1] ?? 100] })}
            />
            <NumberInput
              label="Segundo aviso"
              suffix="%"
              min={1}
              max={200}
              value={thresholds[1] ?? 100}
              onChange={(v) => setForm({ ...form, budget_thresholds: [thresholds[0] ?? 80, Number(v || 0)] })}
            />
          </SimpleGrid>
          <Switch
            label="Actualizar presupuestos por inflación automáticamente"
            description="Cuando se publica un nuevo IPC, sube los presupuestos en pesos ese porcentaje."
            checked={form.budget_auto_index}
            onChange={(e) => setForm({ ...form, budget_auto_index: e.currentTarget.checked })}
          />
          <Group justify="flex-end">
            <Button onClick={save} loading={saving}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Title order={4}>Personas</Title>
          <Table>
            <Table.Tbody>
              {users.data.map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <ColorSwatch color={`var(--mantine-color-${u.color}-6)`} size={14} />
                      <Text size="sm" fw={500}>
                        {u.display_name}
                      </Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      @{u.username}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {u.has_telegram && (
                      <Badge size="xs" variant="light">
                        Telegram
                      </Badge>
                    )}
                    {!u.share_dashboard && (
                      <Badge size="xs" variant="light" color="gray" ml={4}>
                        Tablero privado
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Title order={5}>Agregar persona</Title>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <TextInput label="Usuario" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.currentTarget.value })} autoComplete="off" />
            <TextInput label="Nombre para mostrar" value={newUser.display_name} onChange={(e) => setNewUser({ ...newUser, display_name: e.currentTarget.value })} />
          </SimpleGrid>
          <PasswordInput
            label="Contraseña inicial"
            description="Mínimo 10 caracteres. Después la puede cambiar desde su perfil."
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.currentTarget.value })}
            autoComplete="new-password"
          />
          <Group justify="flex-end">
            <Button leftSection={<IconPlus size={16} />} onClick={addUser} loading={adding} disabled={!newUser.username || !newUser.password}>
              Agregar
            </Button>
          </Group>
        </Stack>
      </Card>
    </SimpleGrid>
  );
}

// ---- Categorías ----

function CategoriesTab() {
  const qc = useQueryClient();
  const cats = useCategories();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [editing, setEditing] = useState<{ cat: Category | null; parent: Category | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const refreshCats = () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
  };

  const archive = async (c: Category) => {
    try {
      await api.patch(`/categories/${c.id}`, { archived: !c.archived });
      refreshCats();
    } catch (e) {
      notifyError(e);
    }
  };

  const remove = (c: Category) =>
    modals.openConfirmModal({
      title: `Eliminar «${c.name}»`,
      children: (
        <Text size="sm">
          {c.parent_id === null ? 'También se eliminan sus subcategorías. ' : ''}Los movimientos de esta categoría quedan sin categoría y sus presupuestos se borran. Si solo querés dejar de usarla,
          archivala.
        </Text>
      ),
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/categories/${c.id}`);
          refreshCats();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const list = (cats.data ?? []).filter((c) => c.kind === kind && (showArchived || !c.archived));
  const parents = list.filter((c) => c.parent_id === null);

  const actions = (c: Category) => (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" size="sm" aria-label="Acciones">
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => setEditing({ cat: c, parent: null })}>Editar</Menu.Item>
        {c.parent_id === null && <Menu.Item onClick={() => setEditing({ cat: null, parent: c })}>Agregar subcategoría</Menu.Item>}
        <Menu.Item onClick={() => archive(c)}>{c.archived ? 'Desarchivar' : 'Archivar'}</Menu.Item>
        <Menu.Item color="red" onClick={() => remove(c)}>
          Eliminar
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <Card>
      <Group justify="space-between" mb="md">
        <Group>
          <Select
            size="xs"
            value={kind}
            onChange={(v) => setKind((v ?? 'expense') as 'expense' | 'income')}
            allowDeselect={false}
            data={[
              { value: 'expense', label: 'Gastos' },
              { value: 'income', label: 'Ingresos' },
            ]}
            w={140}
          />
          <Switch size="xs" label="Mostrar archivadas" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
        </Group>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing({ cat: null, parent: null })}>
          Nueva categoría
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {parents.map((p) => (
          <Card key={p.id} padding="sm" opacity={p.archived ? 0.5 : 1}>
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <ColorSwatch color={`var(--mantine-color-${p.color ?? 'gray'}-6)`} size={14} />
                <Text fw={600}>{p.name}</Text>
              </Group>
              {actions(p)}
            </Group>
            <Stack gap={2} mt="xs" pl="lg">
              {list
                .filter((c) => c.parent_id === p.id)
                .map((c) => (
                  <Group key={c.id} justify="space-between" wrap="nowrap" opacity={c.archived ? 0.5 : 1}>
                    <Text size="sm">{c.name}</Text>
                    {actions(c)}
                  </Group>
                ))}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      {editing && <CategoryModal kind={kind} cat={editing.cat} parent={editing.parent} onClose={() => setEditing(null)} onSaved={refreshCats} />}
    </Card>
  );
}

function CategoryModal({ kind, cat, parent, onClose, onSaved }: { kind: 'expense' | 'income'; cat: Category | null; parent: Category | null; onClose: () => void; onSaved: () => void }) {
  const cats = useCategories();
  const [name, setName] = useState(cat?.name ?? '');
  const [color, setColor] = useState<string | null>(cat?.color ?? parent?.color ?? 'blue');
  const [parentId, setParentId] = useState<number | null>(cat?.parent_id ?? parent?.id ?? null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (cat) await api.patch(`/categories/${cat.id}`, { name, color });
      else await api.post('/categories', { name, kind, parent_id: parentId, color });
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const parentOptions = (cats.data ?? []).filter((c) => c.kind === kind && c.parent_id === null && !c.archived).map((c) => ({ value: String(c.id), label: c.name }));

  return (
    <Modal opened onClose={onClose} title={cat ? 'Editar categoría' : parentId ? 'Nueva subcategoría' : 'Nueva categoría'}>
      <Stack>
        <TextInput label="Nombre" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus required />
        {!cat && (
          <Select label="Dentro de" placeholder="Ninguna (categoría principal)" clearable data={parentOptions} value={parentId == null ? null : String(parentId)} onChange={(v) => setParentId(v ? Number(v) : null)} />
        )}
        <div>
          <Text size="sm" fw={500} mb={6}>
            Color
          </Text>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!name.trim()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---- Cotizaciones e inflación ----

type FxResponse = { latest: FxRate | null; rows: (FxRate & { fetched_at: string })[] };
type CpiResponse = { latest_month: string | null; rows: { month: string; pct: number; source: string }[] };

function RatesTab() {
  const qc = useQueryClient();
  const fx = useQuery({ queryKey: ['fx'], queryFn: () => api.get<FxResponse>('/fx') });
  const cpi = useQuery({ queryKey: ['cpi'], queryFn: () => api.get<CpiResponse>('/cpi') });
  const [busy, setBusy] = useState<string | null>(null);
  const [rate, setRate] = useState<{ date: string; buy: number | string; sell: number | string }>({ date: today(), buy: '', sell: '' });
  const [cpiForm, setCpiForm] = useState<{ month: string | null; pct: number | string }>({ month: null, pct: '' });

  const afterRates = () => {
    for (const k of ['fx', 'cpi', 'dashboard', 'reports', 'accounts', 'budgets', 'goals']) qc.invalidateQueries({ queryKey: [k] });
  };

  const refreshFx = async () => {
    setBusy('fx');
    try {
      const r = await api.post<{ ok: boolean; inserted: number; errors: string[] }>('/fx/refresh');
      if (r.errors.length) notifyError(new Error(`No se pudo actualizar del todo: ${r.errors.join(' · ')}`));
      else notifyOk(`Cotizaciones actualizadas (${r.inserted} días nuevos o cambiados)`);
      afterRates();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const refreshCpi = async () => {
    setBusy('cpi');
    try {
      const r = await api.post<{ ok: boolean; inserted: number; error?: string }>('/cpi/refresh');
      if (!r.ok) notifyError(new Error(`No se pudo actualizar el IPC: ${r.error ?? 'error desconocido'}`));
      else notifyOk(`IPC actualizado (${r.inserted} meses nuevos o cambiados)`);
      afterRates();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const saveRate = async () => {
    setBusy('rate');
    try {
      await api.post('/fx', { date: rate.date, buy: Number(rate.buy), sell: Number(rate.sell) });
      notifyOk('Cotización guardada');
      setRate({ date: today(), buy: '', sell: '' });
      afterRates();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const saveCpi = async () => {
    if (!cpiForm.month) return;
    setBusy('cpiManual');
    try {
      await api.post('/cpi', { month: cpiForm.month.slice(0, 7), pct: Number(cpiForm.pct) });
      notifyOk('IPC guardado');
      setCpiForm({ month: null, pct: '' });
      afterRates();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const nf = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const latest = fx.data?.latest;

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Card>
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Dólar oficial BNA</Title>
            <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={busy === 'fx'} onClick={refreshFx}>
              Actualizar desde BNA
            </Button>
          </Group>
          {latest ? (
            <Group gap="xl">
              <div>
                <Text size="xs" c="dimmed">
                  Comprador
                </Text>
                <Text fw={700} fz="xl" className="num">
                  $ {nf(latest.buy)}
                </Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">
                  Vendedor
                </Text>
                <Text fw={700} fz="xl" className="num">
                  $ {nf(latest.sell)}
                </Text>
              </div>
              <Text size="xs" c="dimmed">
                {date(latest.date)} · {latest.source === 'manual' ? 'carga manual' : latest.source}
              </Text>
            </Group>
          ) : (
            <Alert color="yellow">Todavía no hay cotizaciones. Actualizalas o cargá una a mano para poder ver los montos en USD.</Alert>
          )}
          <Text size="sm" fw={500}>
            Carga manual
          </Text>
          <SimpleGrid cols={{ base: 1, xs: 3 }}>
            <DateInput label="Fecha" valueFormat="DD/MM/YYYY" value={rate.date} onChange={(v) => v && setRate({ ...rate, date: v })} />
            <NumberInput label="Comprador" decimalSeparator="," thousandSeparator="." prefix="$ " min={0} value={rate.buy} onChange={(v) => setRate({ ...rate, buy: v })} />
            <NumberInput label="Vendedor" decimalSeparator="," thousandSeparator="." prefix="$ " min={0} value={rate.sell} onChange={(v) => setRate({ ...rate, sell: v })} />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button size="xs" onClick={saveRate} loading={busy === 'rate'} disabled={!rate.buy || !rate.sell}>
              Guardar cotización
            </Button>
          </Group>
          <Table.ScrollContainer minWidth={300} mah={320}>
            <Table fz="sm" verticalSpacing={4} stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th ta="right">Comprador</Table.Th>
                  <Table.Th ta="right">Vendedor</Table.Th>
                  <Table.Th>Fuente</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {fx.data?.rows.map((r) => (
                  <Table.Tr key={r.date}>
                    <Table.Td className="num">{date(r.date, 'DD/MM/YY')}</Table.Td>
                    <Table.Td ta="right" className="num">
                      {nf(r.buy)}
                    </Table.Td>
                    <Table.Td ta="right" className="num">
                      {nf(r.sell)}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {r.source}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Inflación (IPC INDEC)</Title>
            <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={busy === 'cpi'} onClick={refreshCpi}>
              Actualizar IPC
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            {cpi.data?.latest_month ? `Último dato: ${monthName(cpi.data.latest_month)}.` : 'Todavía no hay datos de inflación.'} Se usa para ver los gastos en pesos de hoy y comparar tu gasto con
            la inflación.
          </Text>
          <Text size="sm" fw={500}>
            Carga manual
          </Text>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <MonthPickerInput label="Mes" valueFormat="MMMM YYYY" value={cpiForm.month} onChange={(v) => setCpiForm({ ...cpiForm, month: v })} />
            <NumberInput label="Variación mensual" suffix="%" decimalSeparator="," value={cpiForm.pct} onChange={(v) => setCpiForm({ ...cpiForm, pct: v })} />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button size="xs" onClick={saveCpi} loading={busy === 'cpiManual'} disabled={!cpiForm.month || cpiForm.pct === ''}>
              Guardar IPC
            </Button>
          </Group>
          <Table.ScrollContainer minWidth={260} mah={320}>
            <Table fz="sm" verticalSpacing={4} stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mes</Table.Th>
                  <Table.Th ta="right">Variación</Table.Th>
                  <Table.Th>Fuente</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {cpi.data?.rows.map((r) => (
                  <Table.Tr key={r.month}>
                    <Table.Td>{monthName(r.month)}</Table.Td>
                    <Table.Td ta="right" className="num">
                      {r.pct.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {r.source === 'indec' ? 'INDEC' : r.source}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Card>
    </SimpleGrid>
  );
}

// ---- Datos ----

function DataTab() {
  const qc = useQueryClient();
  const { me } = useApp();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ file: string; date: string; size: number }[]>('/backups') });

  const backupNow = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ file: string }>('/backups');
      notifyOk(`Copia creada: ${r.file}`);
      qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  const range = qs({ from, to });

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Card>
        <Stack>
          <Title order={4}>Exportar</Title>
          <Text size="sm" c="dimmed">
            Exporta lo que vos podés ver ({me.display_name}): los movimientos privados de tu pareja no se incluyen.
          </Text>
          <SimpleGrid cols={2}>
            <DateInput label="Desde (opcional)" valueFormat="DD/MM/YYYY" clearable value={from} onChange={setFrom} />
            <DateInput label="Hasta (opcional)" valueFormat="DD/MM/YYYY" clearable value={to} onChange={setTo} />
          </SimpleGrid>
          <Group>
            <Button leftSection={<IconDownload size={16} />} variant="default" onClick={() => download(`/export/transactions.csv${range}`)}>
              Movimientos (CSV)
            </Button>
            <Button leftSection={<IconDownload size={16} />} variant="default" onClick={() => download(`/export/workbook.xlsx${range}`)}>
              Todo (Excel)
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            El Excel incluye hojas de movimientos, cuentas, categorías y presupuestos.
          </Text>
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Copias de seguridad</Title>
            <Button size="xs" onClick={backupNow} loading={busy}>
              Crear copia ahora
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            Todos los días se guarda una copia de la base en el servidor, en <Code>data/backups</Code> (últimos 14 días y una por mes del último año). Para no perder datos si se pierde
            el servidor, copiá la carpeta <Code>data</Code> a otro lugar (por ejemplo con rclone a Google Drive). Ver{' '}
            <Anchor href="https://rclone.org/drive/" target="_blank" rel="noopener" size="sm">
              rclone
            </Anchor>
            .
          </Text>
          {!backups.data?.length ? (
            <Text size="sm" c="dimmed">
              Todavía no hay copias.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={300} mah={320}>
              <Table fz="sm" verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Archivo</Table.Th>
                    <Table.Th ta="right">Tamaño</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {backups.data.map((b) => (
                    <Table.Tr key={b.file}>
                      <Table.Td className="num">{date(b.date, 'DD/MM/YY')}</Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {b.file}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {(b.size / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 2 })} MB
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Card>
    </SimpleGrid>
  );
}
