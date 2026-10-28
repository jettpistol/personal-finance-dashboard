import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  FileButton,
  Group,
  Modal,
  Select,
  Stack,
  Stepper,
  Table,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowBackUp, IconEdit, IconFileSpreadsheet, IconTrash, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { notifyError, notifyOk, useAccounts, useRefreshData } from '../lib/queries';
import type { ImportItem, Preset, PresetConfig } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { AccountSelect } from '../components/inputs';
import { DEFAULT_PRESET, PresetBuilder, withDefaults } from '../components/PresetBuilder';
import { ImportReview } from '../components/ImportReview';

type Upload = { upload_id: string; file_name: string; size: number };
type Preview = { items: ImportItem[]; errors: { line: number; message: string }[]; total_rows: number };
type CommitResult = { batch_id: number; imported: number; failures: { description: string; error: string }[] };
type Batch = { id: number; file_name: string; account_name: string | null; created_by_name: string | null; row_count: number; remaining: number; created_at: string };

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
      notifyOk(r.imported === 1 ? '1 movimiento importado' : `${r.imported} movimientos importados`);
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
              data={[{ value: NEW_PRESET, label: 'Crear preset nuevo…' }, ...(presets.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))]}
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
            <ImportReview
              errors={preview.errors}
              items={items}
              setItems={setItems}
              currency={account?.currency ?? 'ARS'}
              onBack={() => setStep(1)}
              backLabel="Volver al preset"
              errorsHint="Si son muchas, volvé al preset y revisá columnas, formato de fecha o filas a saltear."

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
          notifyOk(`Preset «${p.name}» eliminado`);
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
          notifyOk(`Importación deshecha: ${r.deleted === 1 ? '1 movimiento eliminado' : `${r.deleted} movimientos eliminados`}`);
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
