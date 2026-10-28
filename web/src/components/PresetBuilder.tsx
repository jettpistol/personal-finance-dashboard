import { useMemo } from 'react';
import {
  Alert,
  Badge,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PresetConfig } from '../lib/types';

export const DEFAULT_PRESET: PresetConfig = {
  delimiter: 'auto',
  encoding: 'utf-8',
  sheet: 0,
  skipRows: 0,
  hasHeader: true,
  columns: { date: 0, description: [1], amount: 2, debit: null, credit: null, currency: null, merchant: null, notes: null },
  amountMode: 'single',
  invertSign: false,
  dateFormat: 'DD/MM/YYYY',
  decimalSeparator: ',',
  skipIfContains: [],
  accountId: null,
};

/** Fills fields missing in an older saved preset with defaults. */
export function withDefaults(c: Partial<PresetConfig> | undefined): PresetConfig {
  return { ...DEFAULT_PRESET, ...c, columns: { ...DEFAULT_PRESET.columns, ...c?.columns } };
}

type Raw = { rows: (string | number)[][]; total_rows: number; max_columns: number };

export function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const ROLE_COLORS: Record<string, string> = {
  Fecha: 'blue',
  Descripción: 'grape',
  Monto: 'teal',
  Débito: 'red',
  Crédito: 'teal',
  Moneda: 'yellow',
  Comercio: 'orange',
  Notas: 'gray',
};

/**
 * Lets the user point at columns of the uploaded file to describe a bank's layout.
 * Works without a file too (uploadId null): then columns are chosen by number only.
 */
export function PresetBuilder({ uploadId, config, onChange }: { uploadId: string | null; config: PresetConfig; onChange: (c: PresetConfig) => void }) {
  const raw = useQuery({
    queryKey: ['imports', 'raw', uploadId, config.delimiter, config.encoding, config.sheet],
    queryFn: () => api.post<Raw>('/imports/raw', { upload_id: uploadId, delimiter: config.delimiter, encoding: config.encoding, sheet: config.sheet }),
    enabled: !!uploadId,
  });

  const set = <K extends keyof PresetConfig>(k: K, v: PresetConfig[K]) => onChange({ ...config, [k]: v });
  const setCol = <K extends keyof PresetConfig['columns']>(k: K, v: PresetConfig['columns'][K]) => onChange({ ...config, columns: { ...config.columns, [k]: v } });

  const nCols = Math.max(raw.data?.max_columns ?? 0, 1, ...(uploadId ? [] : [12]));
  const headerRow = config.hasHeader ? raw.data?.rows[config.skipRows] : undefined;
  const colOptions = Array.from({ length: nCols }, (_, i) => {
    const h = headerRow?.[i];
    return { value: String(i), label: `${colLetter(i)}${h !== undefined && String(h).trim() ? ` · ${String(h).trim().slice(0, 30)}` : ''}` };
  });

  // Which role each column plays, for highlighting the grid.
  const roles = useMemo(() => {
    const m = new Map<number, string[]>();
    const add = (i: number | null | undefined, r: string) => {
      if (i == null) return;
      m.set(i, [...(m.get(i) ?? []), r]);
    };
    add(config.columns.date, 'Fecha');
    config.columns.description.forEach((i) => add(i, 'Descripción'));
    if (config.amountMode === 'single') add(config.columns.amount, 'Monto');
    else {
      add(config.columns.debit, 'Débito');
      add(config.columns.credit, 'Crédito');
    }
    add(config.columns.currency, 'Moneda');
    add(config.columns.merchant, 'Comercio');
    add(config.columns.notes, 'Notas');
    return m;
  }, [config]);

  const skipWords = config.skipIfContains.map((w) => w.toLowerCase()).filter(Boolean);

  const colSelect = (label: string, value: number | null | undefined, onPick: (v: number | null) => void, opts: { clearable?: boolean; required?: boolean } = {}) => (
    <Select
      label={label}
      data={colOptions}
      value={value == null ? null : String(value)}
      onChange={(v) => onPick(v == null ? null : Number(v))}
      clearable={opts.clearable}
      required={opts.required}
      placeholder={opts.clearable ? 'No usar' : 'Elegí una columna'}
      searchable
    />
  );

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        <Select
          label="Separador"
          value={config.delimiter}
          onChange={(v) => set('delimiter', (v ?? 'auto') as PresetConfig['delimiter'])}
          data={[
            { value: 'auto', label: 'Automático' },
            { value: ';', label: 'Punto y coma ( ; )' },
            { value: ',', label: 'Coma ( , )' },
            { value: '\t', label: 'Tabulación' },
            { value: '|', label: 'Barra ( | )' },
          ]}
          allowDeselect={false}
          description="Solo para CSV"
        />
        <Select
          label="Codificación"
          value={config.encoding}
          onChange={(v) => set('encoding', (v ?? 'utf-8') as PresetConfig['encoding'])}
          data={[
            { value: 'utf-8', label: 'UTF-8' },
            { value: 'windows-1252', label: 'Windows-1252 (Latin-1, común en bancos argentinos)' },
          ]}
          allowDeselect={false}
          description="Si ves acentos rotos (Ã©), cambiala"
        />
        <NumberInput label="Hoja (Excel)" min={1} value={config.sheet + 1} onChange={(v) => set('sheet', Math.max(0, Number(v || 1) - 1))} description="1 = primera hoja" />
        <NumberInput label="Filas a saltear" min={0} max={200} value={config.skipRows} onChange={(v) => set('skipRows', Number(v || 0))} description="Antes del encabezado" />
      </SimpleGrid>

      <Switch label="La primera fila (después de saltear) es el encabezado" checked={config.hasHeader} onChange={(e) => set('hasHeader', e.currentTarget.checked)} />

      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
        {colSelect('Columna de fecha', config.columns.date, (v) => setCol('date', v ?? 0), { required: true })}
        <Select
          label="Formato de fecha"
          value={config.dateFormat}
          onChange={(v) => set('dateFormat', (v ?? 'DD/MM/YYYY') as PresetConfig['dateFormat'])}
          data={['DD/MM/YYYY', 'DD/MM/YY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']}
          allowDeselect={false}
        />
        <MultiSelect
          label="Columna(s) de descripción"
          description="Si elegís varias, se unen con ' - '"
          data={colOptions}
          value={config.columns.description.map(String)}
          onChange={(v) => setCol('description', v.length ? v.map(Number) : config.columns.description)}
          searchable
          required
        />
      </SimpleGrid>

      <Stack gap={6}>
        <Text size="sm" fw={500}>
          Montos
        </Text>
        <SegmentedControl
          value={config.amountMode}
          onChange={(v) => set('amountMode', v as PresetConfig['amountMode'])}
          data={[
            { value: 'single', label: 'Una columna con signo' },
            { value: 'split', label: 'Columnas débito y crédito' },
          ]}
        />
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
          {config.amountMode === 'single' ? (
            colSelect('Columna de monto', config.columns.amount, (v) => setCol('amount', v), { required: true })
          ) : (
            <>
              {colSelect('Columna de débito (salidas)', config.columns.debit, (v) => setCol('debit', v), { clearable: true })}
              {colSelect('Columna de crédito (entradas)', config.columns.credit, (v) => setCol('credit', v), { clearable: true })}
            </>
          )}
          <Select
            label="Separador decimal"
            value={config.decimalSeparator}
            onChange={(v) => set('decimalSeparator', (v ?? ',') as PresetConfig['decimalSeparator'])}
            data={[
              { value: ',', label: 'Coma (1.234,56)' },
              { value: '.', label: 'Punto (1,234.56)' },
            ]}
            allowDeselect={false}
          />
        </SimpleGrid>
        {config.amountMode === 'single' && (
          <Switch
            label="Los gastos vienen en positivo"
            description="Típico de los resúmenes de tarjeta: invierte el signo para que los consumos cuenten como gastos."
            checked={config.invertSign}
            onChange={(e) => set('invertSign', e.currentTarget.checked)}
          />
        )}
      </Stack>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
        {colSelect('Columna de moneda (opcional)', config.columns.currency, (v) => setCol('currency', v), { clearable: true })}
        {colSelect('Columna de comercio (opcional)', config.columns.merchant, (v) => setCol('merchant', v), { clearable: true })}
        {colSelect('Columna de notas (opcional)', config.columns.notes, (v) => setCol('notes', v), { clearable: true })}
      </SimpleGrid>

      <TagsInput
        label="Ignorar filas que contengan"
        description="Ej: SALDO ANTERIOR, TOTAL. Presioná Enter para agregar cada texto."
        value={config.skipIfContains}
        onChange={(v) => set('skipIfContains', v)}
        clearable
      />

      {uploadId && (
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              Vista del archivo
            </Text>
            {raw.data && (
              <Text size="xs" c="dimmed">
                Mostrando {raw.data.rows.length} de {raw.data.total_rows} filas
              </Text>
            )}
          </Group>
          {raw.isLoading && <Loader size="sm" />}
          {raw.error && <Alert color="red">{(raw.error as Error).message}</Alert>}
          {raw.data && (
            <ScrollArea h={360} type="auto" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
              <Table striped={false} withColumnBorders fz="xs" verticalSpacing={2} horizontalSpacing={6} style={{ whiteSpace: 'nowrap' }}>
                <Table.Thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--mantine-color-body)' }}>
                  <Table.Tr>
                    <Table.Th>#</Table.Th>
                    {Array.from({ length: nCols }, (_, i) => (
                      <Table.Th key={i}>
                        <Group gap={4} wrap="nowrap">
                          <Text size="xs" fw={700}>
                            {colLetter(i)}
                          </Text>
                          {roles.get(i)?.map((r) => (
                            <Badge key={r} size="xs" color={ROLE_COLORS[r]} variant="filled">
                              {r}
                            </Badge>
                          ))}
                        </Group>
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {raw.data.rows.map((row, ri) => {
                    const skipped = ri < config.skipRows;
                    const isHeader = config.hasHeader && ri === config.skipRows;
                    const ignored = !skipped && !isHeader && skipWords.length > 0 && skipWords.some((w) => row.map(String).join(' ').toLowerCase().includes(w));
                    return (
                      <Table.Tr
                        key={ri}
                        style={{
                          opacity: skipped || ignored ? 0.4 : 1,
                          textDecoration: ignored ? 'line-through' : undefined,
                          fontWeight: isHeader ? 700 : undefined,
                          background: isHeader ? 'var(--mantine-color-default-hover)' : undefined,
                        }}
                      >
                        <Table.Td c="dimmed">{ri + 1}</Table.Td>
                        {Array.from({ length: nCols }, (_, ci) => {
                          const role = roles.get(ci)?.[0];
                          return (
                            <Table.Td
                              key={ci}
                              style={{
                                maxWidth: 260,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                background: role && !skipped && !isHeader ? `var(--mantine-color-${ROLE_COLORS[role]}-light)` : undefined,
                              }}
                            >
                              {String(row[ci] ?? '')}
                            </Table.Td>
                          );
                        })}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
          <Text size="xs" c="dimmed">
            Las filas grises se saltean, la fila en negrita es el encabezado y las tachadas se ignoran.
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
