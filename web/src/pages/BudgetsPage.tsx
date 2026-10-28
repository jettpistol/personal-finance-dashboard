import { useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Modal, Progress, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconEdit, IconInfoCircle, IconPlus, IconSparkles, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { MonthSelect, PageHeader } from '../components/Layout';
import { CategorySelect, MoneyInput } from '../components/inputs';
import { api, qs } from '../lib/api';
import { scopeName, useApp } from '../lib/app-state';
import { currentMonth, fromCents, money, pct, toCents } from '../lib/format';
import { categoryLabel, notifyError, notifyOk, useCategories, useRefreshData, useSettings } from '../lib/queries';
import type { BudgetStatus, Currency, MonthSummary } from '../lib/types';

/** Red from just before the limit (over 95%), yellow from 80%. */
function barColor(p: number) {
  return p > 95 ? 'red' : p >= 80 ? 'yellow' : 'teal';
}

function BudgetModal({ budget, scope, onClose }: { budget: Partial<BudgetStatus> | null; scope: string; onClose: () => void }) {
  const refresh = useRefreshData();
  const [categoryId, setCategoryId] = useState<number | null>(budget?.category_id ?? null);
  const [amount, setAmount] = useState<number | string>(budget?.amount ? fromCents(budget.amount) : '');
  const [currency, setCurrency] = useState<Currency>(budget?.currency ?? 'ARS');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/budgets', { category_id: categoryId, scope, amount: toCents(amount), currency });
      notifyOk('Presupuesto guardado');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{budget?.id ? 'Editar presupuesto' : 'Nuevo presupuesto'}</Text>}>
      <Stack gap="sm">
        <CategorySelect
          label="Categoría"
          description="Un presupuesto en una categoría principal incluye sus subcategorías."
          kind="expense"
          value={categoryId}
          onChange={setCategoryId}
          disabled={!!budget?.id}
          clearable={false}
        />
        <SimpleGrid cols={2}>
          <MoneyInput label="Monto mensual" currency={currency} value={amount} onChange={setAmount} />
          <Select label="Moneda" value={currency} onChange={(v) => v && setCurrency(v as Currency)} data={['ARS', 'USD']} allowDeselect={false} />
        </SimpleGrid>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!categoryId || toCents(amount) <= 0}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function SuggestModal({ scope, existing, onClose }: { scope: string; existing: BudgetStatus[]; onClose: () => void }) {
  const cats = useCategories();
  const refresh = useRefreshData();
  const q = useQuery({
    queryKey: ['budgets', 'suggest', scope],
    queryFn: () => api.post<{ category_id: number; amount: number }[]>('/budgets/suggest', { scope }),
  });
  const rows = (q.data ?? []).filter((r) => r.category_id && r.amount > 0).sort((a, b) => b.amount - a.amount);
  const has = new Set(existing.map((b) => b.category_id));
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [amounts, setAmounts] = useState<Record<number, number | string>>({});
  const [saving, setSaving] = useState(false);
  const isPicked = (id: number) => picked[id] ?? !has.has(id);

  const save = async () => {
    setSaving(true);
    try {
      const chosen = rows.filter((r) => isPicked(r.category_id));
      for (const r of chosen) {
        const value = amounts[r.category_id];
        await api.put('/budgets', { category_id: r.category_id, scope, amount: value === undefined ? r.amount : toCents(value), currency: 'ARS' });
      }
      notifyOk(chosen.length === 1 ? '1 presupuesto guardado' : `${chosen.length} presupuestos guardados`);
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} size="lg" title={<Text fw={700}>Sugerencia según los últimos 3 meses</Text>}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Promedio mensual de gasto por categoría principal. Elegí cuáles usar y ajustá los montos.
        </Text>
        {q.isLoading && <Text c="dimmed">Calculando…</Text>}
        {q.data && !rows.length && <Text c="dimmed">No hay gastos en los últimos 3 meses para sugerir.</Text>}
        {rows.length > 0 && (
          <Table verticalSpacing={6}>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.category_id}>
                  <Table.Td w={32}>
                    <Checkbox checked={isPicked(r.category_id)} onChange={(e) => setPicked({ ...picked, [r.category_id]: e.currentTarget.checked })} aria-label="Usar" />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{categoryLabel(cats.data, r.category_id)}</Text>
                    {has.has(r.category_id) && (
                      <Text size="xs" c="dimmed">
                        Ya tiene presupuesto (se reemplaza)
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td w={180}>
                    <MoneyInput size="xs" value={amounts[r.category_id] ?? fromCents(r.amount)} onChange={(v) => setAmounts({ ...amounts, [r.category_id]: v })} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!rows.some((r) => isPicked(r.category_id))}>
            Guardar seleccionados
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function BudgetsPage() {
  const { scope, me, users } = useApp();
  const cats = useCategories();
  const settings = useSettings();
  const refresh = useRefreshData();
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<Partial<BudgetStatus> | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const editable = scope === 'household' || scope === `user:${me.id}`;

  const budgets = useQuery({ queryKey: ['budgets', scope, month], queryFn: () => api.get<BudgetStatus[]>(`/budgets${qs({ scope, month })}`) });
  const summary = useQuery({
    queryKey: ['reports', 'summary', scope, month, 'ARS'],
    queryFn: () => api.get<MonthSummary>(`/reports/summary${qs({ scope, month, currency: 'ARS' })}`),
  });

  const list = budgets.data ?? [];
  const ars = list.filter((b) => b.currency === 'ARS');
  const totalBudget = ars.reduce((s, b) => s + b.amount, 0);
  const totalSpent = ars.reduce((s, b) => s + b.spent, 0);
  const totalPct = totalBudget ? (totalSpent / totalBudget) * 100 : 0;

  const totalLeft = totalBudget - totalSpent;

  const isCurrent = month === currentMonth();
  const daysInMonth = dayjs(`${month}-01`).daysInMonth();
  const day = isCurrent ? dayjs().date() : daysInMonth;
  const expectedPct = (day / daysInMonth) * 100;

  // Top-level categories with spending but no budget (a budget on a parent covers its children).
  const budgeted = new Set(list.map((b) => b.parent_id ?? b.category_id));
  const unbudgeted = (summary.data?.by_category ?? []).filter((c) => c.category_id != null && !budgeted.has(c.category_id) && c.amount > 0);

  const remove = (b: BudgetStatus) =>
    modals.openConfirmModal({
      title: 'Eliminar presupuesto',
      children: <Text size="sm">¿Eliminar el presupuesto de {b.category_name}?</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/budgets/${b.id}`);
          notifyOk(`Presupuesto de ${b.category_name} eliminado`);
          refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  // A switch, not an action: budgets keep the amount entered and are shown adjusted by the CPI
  // published since then, so turning it on again never adds inflation twice.
  const indexing = !!settings.data?.budget_indexing;
  const setIndexing = async (on: boolean) => {
    try {
      await api.patch('/settings', { budget_indexing: on });
      qc.invalidateQueries({ queryKey: ['settings'] });
      refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <>
      <PageHeader
        title="Presupuestos"
        description={`Límites mensuales por categoría · ${scopeName(scope, users, me.id)}`}
        actions={
          <>
            <MonthSelect value={month} onChange={setMonth} />
            {editable && (
              <>
                <Button variant="default" size="xs" leftSection={<IconSparkles size={14} />} onClick={() => setSuggesting(true)}>
                  Sugerir según últimos 3 meses
                </Button>
                <Checkbox
                  label="Ajustar por inflación"
                  description="Muestra los presupuestos en pesos actualizados por el IPC publicado desde que los cargaste. Activarla de nuevo no suma inflación dos veces."
                  checked={indexing}
                  disabled={!settings.data}
                  onChange={(e) => setIndexing(e.currentTarget.checked)}
                />
                <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing({})}>
                  Nuevo presupuesto
                </Button>
              </>
            )}
          </>
        }
      />

      {!editable && (
        <Alert color="gray" icon={<IconInfoCircle size={16} />} mb="md">
          Estás viendo los presupuestos de tu pareja. Solo podés editar los del hogar y los tuyos.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} mb="lg">
        <Card>
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <div>
              <Text size="xs" c="dimmed" fw={650}>
                Gastado del presupuesto (ARS)
              </Text>
              <Text className="num" fz={28} fw={800}>
                {money(totalSpent)}{' '}
                <Text span c="dimmed" fz="md" fw={500}>
                  de {money(totalBudget)}
                </Text>
              </Text>
            </div>
            <Badge size="lg" variant="light" color={barColor(totalPct)}>
              {pct(totalPct, 0)}
            </Badge>
          </Group>
          <Progress value={Math.min(100, totalPct)} color={barColor(totalPct)} mt="sm" size="lg" radius="xl" />
        </Card>

        <Card>
          <Text size="xs" c="dimmed" fw={650}>
            {totalLeft < 0 ? 'Excedido (ARS)' : 'Disponible (ARS)'}
          </Text>
          <Text className="num" fz={28} fw={800} c={totalLeft < 0 ? 'red.8' : undefined}>
            {money(Math.abs(totalLeft))}
          </Text>
          {list.length > 0 && (
            <Table verticalSpacing={4} mt="xs">
              <Table.Tbody>
                {list.map((b) => {
                  const left = b.amount - b.spent;
                  return (
                    <Table.Tr key={b.id}>
                      <Table.Td>
                        <Text size="sm">{categoryLabel(cats.data, b.category_id)}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" className="num" fw={600} c={left < 0 ? 'red.8' : undefined}>
                          {left < 0 ? `Excedido ${money(-left, b.currency)}` : money(left, b.currency)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </Card>
      </SimpleGrid>

      {budgets.isLoading && <Text c="dimmed">Cargando…</Text>}
      {budgets.data && !list.length && (
        <Card mb="lg">
          <Text c="dimmed" ta="center">
            No hay presupuestos para este ámbito. {editable && 'Creá uno o usá «Sugerir según últimos 3 meses».'}
          </Text>
        </Card>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mb="xl">
        {list.map((b) => {
          const remaining = b.amount - b.spent;
          const ahead = isCurrent && b.pct > expectedPct + 10 && b.pct < 100;
          return (
            <Card key={b.id} padding="md">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <div style={{ minWidth: 0 }}>
                  <Text fw={700} lineClamp={1}>
                    {categoryLabel(cats.data, b.category_id)}
                  </Text>
                  <Text size="xs" c="dimmed" className="num">
                    {money(b.spent, b.currency)} de {money(b.amount, b.currency)}
                    {b.indexed_pct > 0 && ` · incluye +${pct(b.indexed_pct, 1)} de inflación`}
                  </Text>
                </div>
                <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Badge variant="light" color={barColor(b.pct)}>
                    {pct(b.pct, 0)}
                  </Badge>
                  {editable && (
                    <>
                      <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setEditing(b)} aria-label="Editar">
                        <IconEdit size={14} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove(b)} aria-label="Eliminar">
                        <IconTrash size={14} />
                      </ActionIcon>
                    </>
                  )}
                </Group>
              </Group>
              <Progress value={Math.min(100, b.pct)} color={barColor(b.pct)} mt="sm" radius="xl" />
              <Text size="xs" mt={6} c={remaining < 0 ? 'red' : 'dimmed'}>
                {remaining < 0 ? `Excedido por ${money(-remaining, b.currency)}` : `Quedan ${money(remaining, b.currency)}`}
                {ahead && ' · vas más rápido que el mes'}
              </Text>
            </Card>
          );
        })}
      </SimpleGrid>

      {unbudgeted.length > 0 && (
        <Card>
          <Title order={4}>Gastos sin presupuesto este mes</Title>
          <Table verticalSpacing={6}>
            <Table.Tbody>
              {unbudgeted.map((c) => (
                <Table.Tr key={c.category_id}>
                  <Table.Td>
                    <Text size="sm">{c.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ta="right" className="num">
                      {money(c.amount)}
                    </Text>
                  </Table.Td>
                  {editable && (
                    <Table.Td w={120} ta="right">
                      <Button
                        size="compact-xs"
                        variant="light"
                        onClick={() => setEditing({ category_id: c.category_id!, amount: Math.round(c.amount / 100) * 100, currency: 'ARS' })}
                      >
                        Presupuestar
                      </Button>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {editing && <BudgetModal budget={editing} scope={scope} onClose={() => setEditing(null)} />}
      {suggesting && <SuggestModal scope={scope} existing={list} onClose={() => setSuggesting(false)} />}
    </>
  );
}
