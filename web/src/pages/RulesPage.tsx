import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconBooks, IconEdit, IconPlus, IconTrash, IconWand } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { date, fromCents, money, toCents } from '../lib/format';
import { categoryLabel, categorySelectData, errorFields, FieldError, notifyError, notifyOk, useAccounts, useCategories, useRefreshData } from '../lib/queries';
import type { Currency, Rule } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { AccountSelect, CategorySelect, MoneyInput } from '../components/inputs';
import { GroupedSelect } from '../components/GroupedSelect';
import { RuleCatalogModal } from '../components/RuleCatalogModal';

const MATCH_LABEL: Record<Rule['match_type'], string> = {
  contains: 'contiene',
  starts_with: 'empieza con',
  equals: 'es igual a',
  regex: 'coincide con la expresión',
};

type Form = {
  name: string;
  priority: number | string;
  match_type: Rule['match_type'];
  pattern: string;
  account_id: number | null;
  amount_min: number | string;
  amount_max: number | string;
  set_type: Rule['set_type'];
  set_category_id: number | null;
  set_merchant: string;
  set_to_account_id: number | null;
  set_shared: 'keep' | 'yes' | 'no';
  set_tags: string[];
  active: boolean;
};

const emptyForm: Form = {
  name: '',
  priority: 0,
  match_type: 'contains',
  pattern: '',
  account_id: null,
  amount_min: '',
  amount_max: '',
  set_type: null,
  set_category_id: null,
  set_merchant: '',
  set_to_account_id: null,
  set_shared: 'keep',
  set_tags: [],
  active: true,
};

function toForm(r: Rule): Form {
  return {
    name: r.name,
    priority: r.priority,
    match_type: r.match_type,
    pattern: r.pattern,
    account_id: r.account_id,
    amount_min: r.amount_min == null ? '' : fromCents(r.amount_min),
    amount_max: r.amount_max == null ? '' : fromCents(r.amount_max),
    set_type: r.set_type,
    set_category_id: r.set_category_id,
    set_merchant: r.set_merchant ?? '',
    set_to_account_id: r.set_to_account_id,
    set_shared: r.set_shared == null ? 'keep' : r.set_shared ? 'yes' : 'no',
    set_tags: r.set_tags ?? [],
    active: !!r.active,
  };
}

function toPayload(f: Form) {
  return {
    name: f.name.trim() || f.pattern.trim(),
    priority: Number(f.priority || 0),
    match_type: f.match_type,
    pattern: f.pattern,
    account_id: f.account_id,
    amount_min: f.amount_min === '' ? null : toCents(f.amount_min),
    amount_max: f.amount_max === '' ? null : toCents(f.amount_max),
    set_type: f.set_type,
    set_category_id: f.set_type === 'transfer' ? null : f.set_category_id,
    set_merchant: f.set_merchant.trim() || null,
    set_to_account_id: f.set_type === 'transfer' ? f.set_to_account_id : null,
    set_shared: f.set_shared === 'keep' ? null : f.set_shared === 'yes',
    set_tags: f.set_tags,
    active: f.active,
  };
}

type TestMatch = { id: number; date: string; description: string; amount: number; currency: Currency; category_id: number | null };

export function RulesPage() {
  const qc = useQueryClient();
  const refresh = useRefreshData();
  const cats = useCategories();
  const accounts = useAccounts();
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => api.get<Rule[]>('/rules') });
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [applying, setApplying] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  const apply = async () => {
    setApplying(true);
    try {
      const r = await api.post<{ changed: number }>('/rules/apply');
      notifyOk(r.changed ? (r.changed === 1 ? 'Se categorizó 1 movimiento' : `Se categorizaron ${r.changed} movimientos`) : 'No había movimientos sin categoría que coincidan con las reglas');
      refresh();
    } catch (e) {
      notifyError(e);
    } finally {
      setApplying(false);
    }
  };

  const remove = (r: Rule) =>
    modals.openConfirmModal({
      title: 'Eliminar regla',
      children: <Text size="sm">Se elimina «{r.name}». Los movimientos ya categorizados no cambian.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/rules/${r.id}`);
          notifyOk(`Regla «${r.name}» eliminada`);
          qc.invalidateQueries({ queryKey: ['rules'] });
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const toggleActive = async (r: Rule) => {
    try {
      await api.put(`/rules/${r.id}`, toPayload({ ...toForm(r), active: !r.active }));
      qc.invalidateQueries({ queryKey: ['rules'] });
    } catch (e) {
      notifyError(e);
    }
  };

  const actionsText = (r: Rule) => {
    const parts: string[] = [];
    if (r.set_type) parts.push(r.set_type === 'expense' ? 'gasto' : r.set_type === 'income' ? 'ingreso' : 'transferencia');
    if (r.set_category_id) parts.push(categoryLabel(cats.data, r.set_category_id));
    if (r.set_to_account_id) parts.push(`→ ${accounts.data?.find((a) => a.id === r.set_to_account_id)?.name ?? 'cuenta'}`);
    if (r.set_merchant) parts.push(`comercio «${r.set_merchant}»`);
    if (r.set_shared != null) parts.push(r.set_shared ? 'compartido' : 'no compartido');
    if (r.set_tags?.length) parts.push(r.set_tags.map((t) => `#${t}`).join(' '));
    return parts.join(' · ') || '—';
  };

  return (
    <>
      <PageHeader
        title="Reglas"
        description="Categorizan automáticamente los movimientos al importar o al escribir una descripción. Gana la de mayor prioridad que coincida."
        actions={
          <>
            <Tooltip label="Categoriza con las reglas los movimientos que todavía no tienen categoría">
              <Button variant="default" leftSection={<IconWand size={16} />} onClick={apply} loading={applying}>
                Aplicar reglas
              </Button>
            </Tooltip>
            <Button variant="default" leftSection={<IconBooks size={16} />} onClick={() => setBrowsing(true)}>
              Reglas sugeridas
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              Nueva regla
            </Button>
          </>
        }
      />
      <Card>
        {!rules.data?.length ? (
          <Text c="dimmed" size="sm">
            Todavía no hay reglas. Empezá por «Reglas sugeridas»: comercios y servicios habituales de Buenos Aires.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={700}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={60}>Prior.</Table.Th>
                  <Table.Th>Regla</Table.Th>
                  <Table.Th>Si la descripción…</Table.Th>
                  <Table.Th>Entonces</Table.Th>
                  <Table.Th w={70}>Activa</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rules.data.map((r) => (
                  <Table.Tr key={r.id} opacity={r.active ? 1 : 0.5}>
                    <Table.Td className="num">{r.priority}</Table.Td>
                    <Table.Td fw={500}>{r.name}</Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {MATCH_LABEL[r.match_type]} <b>«{r.pattern}»</b>
                      </Text>
                      {(r.account_id || r.amount_min != null || r.amount_max != null) && (
                        <Text size="xs" c="dimmed">
                          {r.account_id ? `en ${accounts.data?.find((a) => a.id === r.account_id)?.name ?? 'cuenta'} ` : ''}
                          {r.amount_min != null ? `desde ${money(r.amount_min)} ` : ''}
                          {r.amount_max != null ? `hasta ${money(r.amount_max)}` : ''}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{actionsText(r)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Switch size="xs" aria-label="Activa" checked={!!r.active} onChange={() => toggleActive(r)} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setEditing(r)}>
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
      {editing && <RuleModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {browsing && <RuleCatalogModal onClose={() => setBrowsing(false)} />}
    </>
  );
}

function RuleModal({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useCategories();
  const [form, setForm] = useState<Form>(rule ? toForm(rule) : emptyForm);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [matches, setMatches] = useState<TestMatch[] | null>(null);
  const [bad, setBad] = useState<string[]>([]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setBad((b) => b.filter((x) => x !== k));
    setForm((f) => ({ ...f, [k]: v }));
  };
  const fail = (e: unknown) => {
    setBad(errorFields(e));
    notifyError(e);
  };

  const save = async () => {
    if (!form.pattern.trim()) return fail(new FieldError('Escribí el texto a buscar.', ['pattern']));
    setSaving(true);
    try {
      if (rule) await api.put(`/rules/${rule.id}`, toPayload(form));
      else await api.post('/rules', toPayload(form));
      qc.invalidateQueries({ queryKey: ['rules'] });
      notifyOk('Regla guardada');
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!form.pattern.trim()) return;
    setTesting(true);
    try {
      const r = await api.post<{ matches: TestMatch[] }>('/rules/test', toPayload(form));
      setMatches(r.matches);
    } catch (e) {
      notifyError(e);
    } finally {
      setTesting(false);
    }
  };

  // Without a type, the rule can point to an expense or income category.
  const categoryData = form.set_type === 'expense' || form.set_type === 'income'
    ? null
    : [
        ...categorySelectData(cats.data, 'expense').map((g) => ({ ...g, group: `Gasto · ${g.group}` })),
        ...categorySelectData(cats.data, 'income').map((g) => ({ ...g, group: `Ingreso · ${g.group}` })),
      ];

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{rule ? 'Editar regla' : 'Nueva regla'}</Text>} size="lg" fullScreen={window.innerWidth < 600}>
      <Stack gap="sm">
        <TextInput label="Nombre" placeholder="Ej: Supermercado Coto" value={form.name} onChange={(e) => set('name', e.currentTarget.value)} />
        <Divider label="Condición" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <Select
            label="Si la descripción"
            value={form.match_type}
            onChange={(v) => set('match_type', (v ?? 'contains') as Rule['match_type'])}
            allowDeselect={false}
            data={Object.entries(MATCH_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <TextInput
            label="Texto"
            placeholder={form.match_type === 'regex' ? 'Ej: ^(NETFLIX|SPOTIFY)' : 'Ej: COTO'}
            description={form.match_type === 'regex' ? 'Expresión regular, sin distinguir mayúsculas' : 'Sin distinguir mayúsculas ni acentos'}
            value={form.pattern}
            onChange={(e) => set('pattern', e.currentTarget.value)}
            error={bad.includes('pattern')}
            required
          />
        </SimpleGrid>
        <AccountSelect label="Solo en la cuenta (opcional)" clearable value={form.account_id} onChange={(v) => set('account_id', v)} />
        <SimpleGrid cols={2}>
          <MoneyInput label="Monto desde (opcional)" value={form.amount_min} onChange={(v) => set('amount_min', v)} />
          <MoneyInput label="Monto hasta (opcional)" value={form.amount_max} onChange={(v) => set('amount_max', v)} />
        </SimpleGrid>

        <Divider label="Acciones" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <Select
            label="Tipo"
            clearable
            placeholder="Sin cambio"
            value={form.set_type}
            onChange={(v) => setForm((f) => ({ ...f, set_type: v as Rule['set_type'], set_category_id: null }))}
            data={[
              { value: 'expense', label: 'Gasto' },
              { value: 'income', label: 'Ingreso' },
              { value: 'transfer', label: 'Transferencia' },
            ]}
          />
          {form.set_type === 'transfer' ? (
            <AccountSelect label="Cuenta de la transferencia" description="La otra cuenta (ej: tu caja de ahorro en dólares)" value={form.set_to_account_id} onChange={(v) => set('set_to_account_id', v)} />
          ) : categoryData ? (
            <GroupedSelect
              label="Categoría"
              searchable
              clearable
              placeholder="Sin cambio"
              data={categoryData}
              value={form.set_category_id == null ? null : String(form.set_category_id)}
              onChange={(v) => set('set_category_id', v ? Number(v) : null)}
            />
          ) : (
            <CategorySelect label="Categoría" kind={form.set_type as 'expense' | 'income'} placeholder="Sin cambio" value={form.set_category_id} onChange={(v) => set('set_category_id', v)} />
          )}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Comercio" placeholder="Sin cambio" value={form.set_merchant} onChange={(e) => set('set_merchant', e.currentTarget.value)} />
          <Select
            label="Compartido"
            value={form.set_shared}
            onChange={(v) => set('set_shared', (v ?? 'keep') as Form['set_shared'])}
            allowDeselect={false}
            data={[
              { value: 'keep', label: 'Sin cambio' },
              { value: 'yes', label: 'Marcar como compartido' },
              { value: 'no', label: 'Marcar como no compartido' },
            ]}
          />
        </SimpleGrid>
        <TagsInput label="Agregar etiquetas" value={form.set_tags} onChange={(v) => set('set_tags', v)} clearable />
        <SimpleGrid cols={2}>
          <NumberInput label="Prioridad" description="Mayor número = se evalúa primero" value={form.priority} onChange={(v) => set('priority', v)} />
          <Switch mt="xl" label="Activa" checked={form.active} onChange={(e) => set('active', e.currentTarget.checked)} />
        </SimpleGrid>

        {matches && (
          <Alert color={matches.length ? 'blue' : 'gray'} title={matches.length ? `Coincide con ${matches.length}${matches.length === 50 ? '+' : ''} movimientos` : 'No coincide con ningún movimiento existente'}>
            {matches.length > 0 && (
              <Stack gap={2}>
                {matches.slice(0, 12).map((m) => (
                  <Group key={m.id} justify="space-between" wrap="nowrap" gap="xs">
                    <Text size="xs" lineClamp={1}>
                      {date(m.date, 'DD/MM/YY')} · {m.description}
                    </Text>
                    <Group gap={6} wrap="nowrap">
                      <Badge size="xs" variant="light" color="gray" style={{ textTransform: 'none' }}>
                        {categoryLabel(cats.data, m.category_id)}
                      </Badge>
                      <Text size="xs" className="num">
                        {money(m.amount, m.currency)}
                      </Text>
                    </Group>
                  </Group>
                ))}
              </Stack>
            )}
          </Alert>
        )}

        <Group justify="space-between" mt="sm">
          <Button variant="default" onClick={test} loading={testing} disabled={!form.pattern.trim()}>
            Probar
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={save} loading={saving}>
              Guardar
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
