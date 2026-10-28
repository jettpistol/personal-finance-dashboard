import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Collapse, Group, Pagination, SegmentedControl, Select, Stack, Switch, Table, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { date, money } from '../lib/format';
import { notifyOk } from '../lib/queries';
import type { ImportItem } from '../lib/types';
import { AccountSelect, CategorySelect } from './inputs';

const PAGE = 50;

/** The review table of an import: tick rows, set type and category, spot duplicates. Shared by Importar and Resúmenes. */
export function ImportReview({
  errors,
  items,
  setItems,
  currency,
  onBack,
  backLabel,
  errorsHint,
  onCommit,
  committing,
}: {
  errors: { line: number; message: string }[];
  items: ImportItem[];
  setItems: (fn: (prev: ImportItem[]) => ImportItem[]) => void;
  currency: 'ARS' | 'USD';
  onBack: () => void;
  backLabel: string;
  errorsHint?: string;
  onCommit: () => void;
  committing: boolean;
}) {
  const [page, setPage] = useState(1);
  const [showErrors, setShowErrors] = useState(false);
  const [bulkKind, setBulkKind] = useState<'expense' | 'income'>('expense');
  const [bulkCategory, setBulkCategory] = useState<number | null>(null);

  const update = (idx: number, patch: Partial<ImportItem>) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const included = items.filter((i) => i.include);
  const totals = useMemo(() => {
    let out = 0;
    let inn = 0;
    for (const i of included) {
      if (i.type === 'transfer') continue;
      if (i.direction === 'out') out += i.amount;
      else inn += i.amount;
    }
    return { out, inn };
  }, [included]);

  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const slice = items.slice((page - 1) * PAGE, page * PAGE);
  const dupCount = items.filter((i) => i.duplicate === 'exact').length;
  const uncategorized = included.filter((i) => i.type !== 'transfer' && i.category_id == null).length;

  const applyBulk = () => {
    if (bulkCategory == null) return;
    const n = items.filter((it) => it.include && it.type === bulkKind).length;
    setItems((prev) => prev.map((it) => (it.include && it.type === bulkKind ? { ...it, category_id: bulkCategory } : it)));
    notifyOk(`Categoría asignada a ${n} ${bulkKind === 'expense' ? 'gastos' : 'ingresos'} seleccionados`);
  };

  return (
    <Stack mt="md">
      <Group gap="xs">
        <Badge variant="light" size="lg">
          {items.length} filas leídas
        </Badge>
        <Badge variant="light" color="teal" size="lg">
          {included.length} a importar
        </Badge>
        {dupCount > 0 && (
          <Badge variant="light" color="yellow" size="lg">
            {dupCount} duplicadas
          </Badge>
        )}
        {uncategorized > 0 && (
          <Badge variant="light" color="gray" size="lg">
            {uncategorized} sin categoría
          </Badge>
        )}
        <Text size="sm" c="dimmed">
          Salidas {money(totals.out, currency)} · Entradas {money(totals.inn, currency)}
        </Text>
      </Group>

      {errors.length > 0 && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title={`${errors.length} filas no se pudieron leer`}>
          <Button size="compact-xs" variant="subtle" onClick={() => setShowErrors((s) => !s)}>
            {showErrors ? 'Ocultar detalle' : 'Ver detalle'}
          </Button>
          <Collapse in={showErrors}>
            <Stack gap={2} mt="xs">
              {errors.slice(0, 100).map((e, i) => (
                <Text key={i} size="xs">
                  Línea {e.line}: {e.message}
                </Text>
              ))}
            </Stack>
          </Collapse>
          {errorsHint && (
            <Text size="xs" mt={4}>
              {errorsHint}
            </Text>
          )}
        </Alert>
      )}

      <Group align="flex-end" gap="xs">
        <SegmentedControl
          size="xs"
          value={bulkKind}
          onChange={(v) => {
            setBulkKind(v as 'expense' | 'income');
            setBulkCategory(null);
          }}
          data={[
            { value: 'expense', label: 'Gastos' },
            { value: 'income', label: 'Ingresos' },
          ]}
        />
        <CategorySelect size="xs" w={240} kind={bulkKind} value={bulkCategory} onChange={setBulkCategory} placeholder="Categoría" />
        <Button size="xs" variant="default" onClick={applyBulk} disabled={bulkCategory == null}>
          Asignar categoría a seleccionados
        </Button>
        <Button size="xs" variant="subtle" onClick={() => setItems((prev) => prev.map((i) => ({ ...i, include: i.duplicate !== 'exact' })))}>
          Seleccionar todos (sin duplicados)
        </Button>
        <Button size="xs" variant="subtle" onClick={() => setItems((prev) => prev.map((i) => ({ ...i, include: false })))}>
          Ninguno
        </Button>
      </Group>

      <Table.ScrollContainer minWidth={980}>
        <Table verticalSpacing={4} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={32} />
              <Table.Th w={90}>Fecha</Table.Th>
              <Table.Th>Descripción</Table.Th>
              <Table.Th ta="right">Monto</Table.Th>
              <Table.Th w={140}>Tipo</Table.Th>
              <Table.Th w={230}>Categoría / destino</Table.Th>
              <Table.Th w={90}>Compartido</Table.Th>
              <Table.Th>Info</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {slice.map((it, i) => {
              const idx = (page - 1) * PAGE + i;
              return (
                <Table.Tr key={it.import_hash + idx} opacity={it.include ? 1 : 0.5}>
                  <Table.Td>
                    <Checkbox size="xs" aria-label="Incluir" checked={it.include} onChange={(e) => update(idx, { include: e.currentTarget.checked })} />
                  </Table.Td>
                  <Table.Td className="num">{date(it.date, 'DD/MM/YY')}</Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {it.description}
                    </Text>
                    {it.merchant && (
                      <Text size="xs" c="dimmed">
                        {it.merchant}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={600} className="num" c={it.direction === 'in' ? 'teal' : undefined}>
                      {it.direction === 'out' ? '-' : '+'}
                      {money(it.amount, currency)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      value={it.type}
                      allowDeselect={false}
                      onChange={(v) => update(idx, { type: (v ?? 'expense') as ImportItem['type'], category_id: null })}
                      data={[
                        { value: 'expense', label: 'Gasto' },
                        { value: 'income', label: 'Ingreso' },
                        { value: 'transfer', label: 'Transferencia' },
                      ]}
                    />
                  </Table.Td>
                  <Table.Td>
                    {it.type === 'transfer' ? (
                      <AccountSelect
                        size="xs"
                        placeholder={it.direction === 'out' ? 'Hacia la cuenta…' : 'Desde la cuenta…'}
                        value={it.to_account_id}
                        onChange={(v) => update(idx, { to_account_id: v })}
                        error={it.include && !it.to_account_id}
                      />
                    ) : (
                      <CategorySelect size="xs" kind={it.type} value={it.category_id} onChange={(v) => update(idx, { category_id: v })} placeholder="Sin categoría" />
                    )}
                  </Table.Td>
                  <Table.Td>
                    {it.type === 'expense' && <Switch size="xs" aria-label="Compartido" checked={it.is_shared} onChange={(e) => update(idx, { is_shared: e.currentTarget.checked })} />}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {it.hint && (
                        <Tooltip label={it.hint.text} multiline w={260}>
                          <Badge size="xs" variant="light" color="gray">
                            {it.hint.label}
                          </Badge>
                        </Tooltip>
                      )}
                      {it.suggested && (
                        <Tooltip label={`Sugerida por el banco de reglas: ${it.suggested}. No es una regla propia.`} multiline w={240}>
                          <Badge size="xs" variant="outline" color="gray">
                            Sugerida
                          </Badge>
                        </Tooltip>
                      )}
                      {it.rule && (
                        <Tooltip label={`Regla: ${it.rule}`}>
                          <Badge size="xs" variant="light" color="blue">
                            Regla
                          </Badge>
                        </Tooltip>
                      )}
                      {it.duplicate === 'exact' && (
                        <Tooltip label="Ya importaste esta fila antes">
                          <Badge size="xs" color="yellow">
                            Duplicado
                          </Badge>
                        </Tooltip>
                      )}
                      {it.duplicate === 'similar' && (
                        <Tooltip label="Ya hay un movimiento con la misma fecha y monto en esta cuenta">
                          <Badge size="xs" color="yellow" variant="light">
                            Posible duplicado
                          </Badge>
                        </Tooltip>
                      )}
                      {it.currency_mismatch && (
                        <Tooltip label="La moneda de esta fila no coincide con la de la cuenta">
                          <Badge size="xs" color="red" variant="light">
                            Otra moneda
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {pages > 1 && <Pagination value={page} onChange={setPage} total={pages} size="sm" />}

      <Group justify="space-between">
        <Button variant="subtle" onClick={onBack}>
          {backLabel}
        </Button>
        <Button onClick={onCommit} loading={committing} disabled={!included.length}>
          Importar {included.length} movimientos
        </Button>
      </Group>
    </Stack>
  );
}
