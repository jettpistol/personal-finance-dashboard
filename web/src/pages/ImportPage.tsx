import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  FileButton,
  Group,
  Modal,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconArrowBackUp, IconEdit, IconFileSpreadsheet, IconTrash, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { notifyError, notifyOk, useAccounts, useRefreshData } from '../lib/queries';
import type { ImportItem, Preset, PresetConfig } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { AccountSelect, CategorySelect } from '../components/inputs';
import { DEFAULT_PRESET, PresetBuilder, withDefaults } from '../components/PresetBuilder';

type Upload = { upload_id: string; file_name: string; size: number };
type Preview = { items: ImportItem[]; errors: { line: number; message: string }[]; total_rows: number };
type CommitResult = { batch_id: number; imported: number; failures: { description: string; error: string }[] };
type Batch = { id: number; file_name: string; account_name: string | null; created_by_name: string | null; row_count: number; remaining: number; created_at: string };

const PAGE = 50;
const NEW_PRESET = 'new';

function usePresets() {
  return useQuery({ queryKey: ['presets'], queryFn: () => api.get<Preset[]>('/presets') });
}

export function ImportPage() {
  const [tab, setTab] = useState<string | null>('import');
  return (
    <>
      <PageHeader title="Importar" description="Cargá resúmenes de tu banco o billetera en CSV o Excel. Cada banco usa un preset que describe sus columnas." />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="import">Importar archivo</Tabs.Tab>
          <Tabs.Tab value="presets">Presets</Tabs.Tab>
          <Tabs.Tab value="history">Historial</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="import">
          <ImportWizard />
        </Tabs.Panel>
        <Tabs.Panel value="presets">
          <PresetsTab />
        </Tabs.Panel>
        <Tabs.Panel value="history">
          <HistoryTab />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

function ImportWizard() {
  const qc = useQueryClient();
  const refresh = useRefreshData();
  const presets = usePresets();
  const accounts = useAccounts();
  const [step, setStep] = useState(0);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_PRESET);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);

  const account = accounts.data?.find((a) => a.id === accountId);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      setUpload(await api.upload<Upload>('/imports/upload', file));
    } catch (e) {
      notifyError(e);
    } finally {
      setUploading(false);
    }
  };

  const pickPreset = (v: string | null) => {
    setPresetId(v);
    if (v && v !== NEW_PRESET) {
      const p = presets.data?.find((x) => String(x.id) === v);
      if (p) {
        setConfig(withDefaults(p.config));
        setPresetName(p.name);
        if (p.config.accountId && !accountId) setAccountId(p.config.accountId);
      }
    } else {
      setConfig(DEFAULT_PRESET);
      setPresetName('');
    }
  };

  const savePreset = async () => {
    if (!presetName.trim()) return notifyError(new Error('Poné un nombre al preset (ej: Galicia caja de ahorro).'));
    setSavingPreset(true);
    try {
      const body = { name: presetName.trim(), config: { ...config, accountId } };
      if (presetId && presetId !== NEW_PRESET) {
        await api.put(`/presets/${presetId}`, body);
      } else {
        const r = await api.post<{ id: number }>('/presets', body);
        setPresetId(String(r.id));
      }
      await qc.invalidateQueries({ queryKey: ['presets'] });
      notifyOk('Preset guardado');
    } catch (e) {
      notifyError(e);
    } finally {
      setSavingPreset(false);
    }
  };

  const loadPreview = async () => {
    if (!upload || !accountId) return;
    setLoadingPreview(true);
    try {
      const p = await api.post<Preview>('/imports/preview', { upload_id: upload.upload_id, config, account_id: accountId });
      setPreview(p);
      setItems(p.items);
      setStep(2);
    } catch (e) {
      notifyError(e);
    } finally {
      setLoadingPreview(false);
    }
  };

  const commit = async () => {
    if (!upload || !accountId) return;
    const rows = items.filter((i) => i.include);
    if (!rows.length) return notifyError(new Error('No hay filas seleccionadas para importar.'));
    const badTransfer = rows.find((r) => r.type === 'transfer' && !r.to_account_id);
    if (badTransfer) return notifyError(new Error(`Falta la cuenta de la transferencia "${badTransfer.description}".`));
    setCommitting(true);
    try {
      const r = await api.post<CommitResult>('/imports/commit', {
        file_name: upload.file_name,
        account_id: accountId,
        preset_id: presetId && presetId !== NEW_PRESET ? Number(presetId) : null,
        rows,
      });
      setResult(r);
      setStep(3);
      refresh();
    } catch (e) {
      notifyError(e);
    } finally {
      setCommitting(false);
    }
  };

  const restart = () => {
    setStep(0);
    setUpload(null);
    setPreview(null);
    setItems([]);
    setResult(null);
  };

  return (
    <Card>
      <Stepper active={step} onStepClick={(s) => s < step && step < 3 && setStep(s)} size="sm" allowNextStepsSelect={false}>
        <Stepper.Step label="Archivo" description="Subir y elegir cuenta">
          <Stack mt="md" maw={560}>
            <Group>
              <FileButton onChange={onFile} accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
                {(props) => (
                  <Button {...props} leftSection={<IconUpload size={16} />} loading={uploading} variant={upload ? 'default' : 'filled'}>
                    {upload ? 'Cambiar archivo' : 'Elegir archivo'}
                  </Button>
                )}
              </FileButton>
              {upload && (
                <Group gap={6}>
                  <IconFileSpreadsheet size={18} />
                  <Text size="sm">{upload.file_name}</Text>
                  <Text size="xs" c="dimmed">
                    ({Math.ceil(upload.size / 1024)} KB)
                  </Text>
                </Group>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              Formatos: CSV o XLSX. Si tu banco descarga .xls, abrilo en Excel y guardalo como .xlsx.
            </Text>
            <AccountSelect label="Cuenta de destino" description="Los movimientos se cargan en esta cuenta" value={accountId} onChange={setAccountId} writableOnly required />
            <Select
              label="Preset del banco"
              placeholder="Elegí uno o creá uno nuevo"
              value={presetId}
              onChange={pickPreset}
              data={[{ value: NEW_PRESET, label: '➕ Crear preset nuevo' }, ...(presets.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))]}
            />
            <Group justify="flex-end">
              <Button disabled={!upload || !accountId || !presetId} variant="default" onClick={() => setStep(1)}>
                {presetId === NEW_PRESET ? 'Configurar columnas' : 'Revisar preset'}
              </Button>
              {presetId && presetId !== NEW_PRESET && (
                <Button disabled={!upload || !accountId} loading={loadingPreview} onClick={loadPreview}>
                  Vista previa
                </Button>
              )}
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Preset" description="Indicar columnas">
          <Stack mt="md">
            <PresetBuilder uploadId={upload?.upload_id ?? null} config={config} onChange={setConfig} />
            <Group justify="space-between" align="flex-end">
              <Group align="flex-end">
                <TextInput label="Nombre del preset" placeholder="Ej: Galicia - caja de ahorro" value={presetName} onChange={(e) => setPresetName(e.currentTarget.value)} w={260} />
                <Button variant="default" onClick={savePreset} loading={savingPreset}>
                  {presetId && presetId !== NEW_PRESET ? 'Guardar cambios' : 'Guardar preset'}
                </Button>
              </Group>
              <Group>
                <Button variant="subtle" onClick={() => setStep(0)}>
                  Atrás
                </Button>
                <Button onClick={loadPreview} loading={loadingPreview} disabled={!upload || !accountId}>
                  Vista previa
                </Button>
              </Group>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Revisar" description="Categorías y duplicados">
          {preview && (
            <PreviewStep
              preview={preview}
              items={items}
              setItems={setItems}
              currency={account?.currency ?? 'ARS'}
              onBack={() => setStep(1)}
              onCommit={commit}
              committing={committing}
            />
          )}
        </Stepper.Step>

        <Stepper.Completed>
          {result && (
            <Stack mt="md" maw={640}>
              <Alert color={result.failures.length ? 'yellow' : 'teal'} title={`Se importaron ${result.imported} movimientos`}>
                {result.failures.length ? `${result.failures.length} filas no se pudieron importar:` : 'Listo. Podés deshacer esta importación desde la pestaña Historial.'}
              </Alert>
              {result.failures.length > 0 && (
                <Table fz="sm">
                  <Table.Tbody>
                    {result.failures.map((f, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{f.description}</Table.Td>
                        <Table.Td c="red">{f.error}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              <Group>
                <Button onClick={restart}>Importar otro archivo</Button>
              </Group>
            </Stack>
          )}
        </Stepper.Completed>
      </Stepper>
    </Card>
  );
}

function PreviewStep({
  preview,
  items,
  setItems,
  currency,
  onBack,
  onCommit,
  committing,
}: {
  preview: Preview;
  items: ImportItem[];
  setItems: (fn: (prev: ImportItem[]) => ImportItem[]) => void;
  currency: 'ARS' | 'USD';
  onBack: () => void;
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
          <Badge variant="light" color="orange" size="lg">
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

      {preview.errors.length > 0 && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title={`${preview.errors.length} filas no se pudieron leer`}>
          <Button size="compact-xs" variant="subtle" onClick={() => setShowErrors((s) => !s)}>
            {showErrors ? 'Ocultar detalle' : 'Ver detalle'}
          </Button>
          <Collapse in={showErrors}>
            <Stack gap={2} mt="xs">
              {preview.errors.slice(0, 100).map((e, i) => (
                <Text key={i} size="xs">
                  Línea {e.line}: {e.message}
                </Text>
              ))}
            </Stack>
          </Collapse>
          <Text size="xs" mt={4}>
            Si son muchas, volvé al preset y revisá columnas, formato de fecha o filas a saltear.
          </Text>
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
                      {it.rule && (
                        <Tooltip label={`Regla: ${it.rule}`}>
                          <Badge size="xs" variant="light" color="blue">
                            Regla
                          </Badge>
                        </Tooltip>
                      )}
                      {it.duplicate === 'exact' && (
                        <Tooltip label="Ya importaste esta fila antes">
                          <Badge size="xs" color="orange">
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
          Volver al preset
        </Button>
        <Button onClick={onCommit} loading={committing} disabled={!included.length}>
          Importar {included.length} movimientos
        </Button>
      </Group>
    </Stack>
  );
}

function PresetsTab() {
  const qc = useQueryClient();
  const presets = usePresets();
  const accounts = useAccounts();
  const [editing, setEditing] = useState<Preset | null>(null);
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_PRESET);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const open = (p: Preset) => {
    setEditing(p);
    setConfig(withDefaults(p.config));
    setName(p.name);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.put(`/presets/${editing.id}`, { name: name.trim() || editing.name, config });
      await qc.invalidateQueries({ queryKey: ['presets'] });
      notifyOk('Preset actualizado');
      setEditing(null);
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = (p: Preset) =>
    modals.openConfirmModal({
      title: 'Eliminar preset',
      children: <Text size="sm">Se elimina «{p.name}». Los movimientos ya importados no cambian.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/presets/${p.id}`);
          qc.invalidateQueries({ queryKey: ['presets'] });
        } catch (e) {
          notifyError(e);
        }
      },
    });

  return (
    <Card>
      {!presets.data?.length ? (
        <Text c="dimmed" size="sm">
          Todavía no hay presets. Se crean al importar el primer archivo de cada banco.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={500}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Cuenta por defecto</Table.Th>
                <Table.Th>Montos</Table.Th>
                <Table.Th w={90} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {presets.data.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td fw={500}>{p.name}</Table.Td>
                  <Table.Td>{accounts.data?.find((a) => a.id === p.config.accountId)?.name ?? '—'}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {p.config.amountMode === 'split' ? 'Débito / crédito' : p.config.invertSign ? 'Una columna (gastos en positivo)' : 'Una columna con signo'} · {p.config.dateFormat}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end">
                      <ActionIcon variant="subtle" aria-label="Editar" onClick={() => open(p)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => remove(p)}>
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
      <Modal opened={!!editing} onClose={() => setEditing(null)} title="Editar preset" size="xl">
        <Stack>
          <TextInput label="Nombre" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <AccountSelect
            label="Cuenta por defecto"
            clearable
            value={config.accountId ?? null}
            onChange={(v) => setConfig({ ...config, accountId: v })}
          />
          <Text size="xs" c="dimmed">
            Sin archivo, las columnas se eligen por letra. Para verlas sobre el archivo, usá la pestaña Importar.
          </Text>
          <PresetBuilder uploadId={null} config={config} onChange={setConfig} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} loading={saving}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

function HistoryTab() {
  const refresh = useRefreshData();
  const batches = useQuery({ queryKey: ['imports'], queryFn: () => api.get<Batch[]>('/imports') });

  const undo = (b: Batch) =>
    modals.openConfirmModal({
      title: 'Deshacer importación',
      children: (
        <Text size="sm">
          Se eliminan los {b.remaining} movimientos que siguen de «{b.file_name}», incluso si los editaste después.
        </Text>
      ),
      labels: { confirm: 'Deshacer', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          const r = await api.del<{ deleted: number }>(`/imports/${b.id}`);
          notifyOk(`Se eliminaron ${r.deleted} movimientos`);
          refresh();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  return (
    <Card>
      {!batches.data?.length ? (
        <Text c="dimmed" size="sm">
          Sin importaciones todavía.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Archivo</Table.Th>
                <Table.Th>Cuenta</Table.Th>
                <Table.Th>Por</Table.Th>
                <Table.Th ta="right">Movimientos</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {batches.data.map((b) => (
                <Table.Tr key={b.id}>
                  <Table.Td className="num">{date(b.created_at.slice(0, 10), 'DD/MM/YY')}</Table.Td>
                  <Table.Td>{b.file_name}</Table.Td>
                  <Table.Td>{b.account_name ?? '—'}</Table.Td>
                  <Table.Td>{b.created_by_name ?? '—'}</Table.Td>
                  <Table.Td ta="right" className="num">
                    {b.remaining}
                    {b.remaining !== b.row_count && (
                      <Text span size="xs" c="dimmed">
                        {' '}
                        / {b.row_count}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconArrowBackUp size={14} />} disabled={!b.remaining} onClick={() => undo(b)}>
                      Deshacer
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}
