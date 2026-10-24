import { useEffect, useState } from 'react';
import { Button, Card, Chip, Group, Menu, Pagination, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconChevronDown, IconDownload, IconPlus, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api, download, qs } from '../lib/api';
import { useApp } from '../lib/app-state';
import { money } from '../lib/format';
import { categorySelectData, notifyError, notifyOk, useCategories, useRefreshData, useTags } from '../lib/queries';
import type { TxList } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { TxTable } from '../components/TxTable';
import { AccountSelect, CategorySelect } from '../components/inputs';

const PAGE_SIZE = 50;

export function TransactionsPage() {
  const { scope, openTx } = useApp();
  const [params, setParams] = useSearchParams();
  const cats = useCategories();
  const tags = useTags();
  const refresh = useRefreshData();
  const [range, setRange] = useState<[string | null, string | null]>([dayjs().startOf('month').format('YYYY-MM-DD'), dayjs().endOf('month').format('YYYY-MM-DD')]);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [type, setType] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [onlyScope, setOnlyScope] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const accountId = params.get('account_id') ? Number(params.get('account_id')) : null;

  useEffect(() => setPage(1), [range, debounced, type, categoryId, tag, flags, accountId, onlyScope, scope]);

  const filters = {
    from: range[0],
    to: range[1],
    q: debounced,
    type,
    category_id: categoryId,
    account_id: accountId,
    tag,
    shared: flags.includes('shared') ? 'true' : undefined,
    status: flags.includes('pending') ? 'pending' : undefined,
    uncategorized: flags.includes('uncategorized') ? 'true' : undefined,
    installments: flags.includes('installments') ? 'true' : undefined,
    scope: onlyScope ? scope : undefined,
  };
  const q = useQuery({
    queryKey: ['transactions', filters, page],
    queryFn: () => api.get<TxList>(`/transactions${qs({ ...filters, page, page_size: PAGE_SIZE })}`),
    placeholderData: (prev) => prev,
  });

  const bulk = async (action: 'delete' | 'categorize', category_id?: number | null) => {
    try {
      const r = await api.post<{ changed: number }>('/transactions/bulk', { ids: [...selected], action, category_id });
      notifyOk(`${r.changed} movimientos actualizados`);
      setSelected(new Set());
      refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  const askCategory = () => {
    let chosen: number | null = null;
    modals.openConfirmModal({
      title: `Categorizar ${selected.size} movimientos`,
      children: (
        <Stack>
          <Select
            searchable
            label="Categoría"
            data={[...categorySelectData(cats.data, 'expense'), ...categorySelectData(cats.data, 'income').map((g) => ({ ...g, group: `${g.group} (ingreso)` }))]}
            onChange={(v) => (chosen = v ? Number(v) : null)}
          />
          <Text size="xs" c="dimmed">
            Solo se aplica a movimientos del mismo tipo que la categoría.
          </Text>
        </Stack>
      ),
      labels: { confirm: 'Aplicar', cancel: 'Cancelar' },
      onConfirm: () => bulk('categorize', chosen),
    });
  };

  const askDelete = () =>
    modals.openConfirmModal({
      title: `Eliminar ${selected.size} movimientos`,
      children: <Text size="sm">Esta acción no se puede deshacer.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => bulk('delete'),
    });

  const data = q.data;
  return (
    <>
      <PageHeader
        title="Movimientos"
        actions={
          <>
            <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={() => download(`/export/transactions.csv${qs({ from: range[0], to: range[1] })}`)}>
              Exportar CSV
            </Button>
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => openTx({ accountId: accountId ?? undefined })}>
              Nuevo
            </Button>
          </>
        }
      />
      <Card mb="md" p="md">
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <TextInput leftSection={<IconSearch size={16} />} placeholder="Buscar descripción, comercio o nota" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
            <DatePickerInput type="range" placeholder="Rango de fechas" value={range} onChange={(v) => setRange(v as [string | null, string | null])} valueFormat="DD/MM/YY" clearable allowSingleDateInRange />
            <AccountSelect
              placeholder="Todas las cuentas"
              value={accountId}
              onChange={(v) => {
                if (v) params.set('account_id', String(v));
                else params.delete('account_id');
                setParams(params);
              }}
              clearable
              includeArchived
            />
            <Select
              placeholder="Todos los tipos"
              clearable
              value={type}
              onChange={setType}
              data={[
                { value: 'expense', label: 'Gastos' },
                { value: 'income', label: 'Ingresos' },
                { value: 'transfer', label: 'Transferencias' },
                { value: 'adjustment', label: 'Ajustes' },
              ]}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            {type === 'income' ? (
              <CategorySelect kind="income" placeholder="Todas las categorías" value={categoryId} onChange={setCategoryId} />
            ) : (
              <CategorySelect kind="expense" placeholder="Todas las categorías" value={categoryId} onChange={setCategoryId} />
            )}
            <Select placeholder="Etiqueta" clearable searchable data={tags.data ?? []} value={tag} onChange={setTag} />
          </SimpleGrid>
          <Group gap="xs">
            <Chip.Group multiple value={flags} onChange={setFlags}>
              <Chip size="xs" value="shared">
                Compartidos
              </Chip>
              <Chip size="xs" value="pending">
                Pendientes
              </Chip>
              <Chip size="xs" value="uncategorized">
                Sin categoría
              </Chip>
              <Chip size="xs" value="installments">
                En cuotas
              </Chip>
            </Chip.Group>
            <Chip size="xs" checked={onlyScope} onChange={setOnlyScope}>
              Solo del tablero seleccionado
            </Chip>
          </Group>
        </Stack>
      </Card>

      <Card p={0}>
        <Group justify="space-between" p="md" pb="xs">
          <Text size="sm" c="dimmed">
            {data ? `${data.total} movimientos · Ingresos ${money(data.totals_ars.income)} · Gastos ${money(data.totals_ars.expense)} (en ARS)` : 'Cargando…'}
          </Text>
          {selected.size > 0 && (
            <Menu>
              <Menu.Target>
                <Button size="xs" variant="light" rightSection={<IconChevronDown size={14} />}>
                  {selected.size} seleccionados
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={askCategory}>Asignar categoría</Menu.Item>
                <Menu.Item color="red" onClick={askDelete}>
                  Eliminar
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        <TxTable rows={data?.items ?? []} selectable selected={selected} onSelect={setSelected} />
        {data && data.total > PAGE_SIZE && (
          <Group justify="center" p="md">
            <Pagination total={Math.ceil(data.total / PAGE_SIZE)} value={page} onChange={setPage} size="sm" />
          </Group>
        )}
      </Card>
    </>
  );
}
