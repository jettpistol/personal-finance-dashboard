import { useState } from 'react';
import { Alert, Anchor, Button, FileButton, Group, List, Modal, Stack, Table, Text } from '@mantine/core';
import { IconDownload, IconFileUpload } from '@tabler/icons-react';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { notifyError, notifyOk, useRefreshData } from '../lib/queries';
import type { Currency } from '../lib/types';

type Row = {
  line: number;
  status: 'ok' | 'error' | 'duplicate';
  message?: string;
  date?: string;
  type?: 'expense' | 'income';
  amount?: number;
  currency?: Currency;
  account?: string;
  category?: string | null;
  description?: string;
};
type Result = { rows: Row[]; created: number };

async function send(file: File, commit: boolean): Promise<Result> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return api.post<Result>(`/transactions/csv${commit ? '?commit=1' : ''}`, fd);
}

const STATUS: Record<Row['status'], { label: string; tone?: string }> = {
  ok: { label: 'OK' },
  duplicate: { label: 'Repetido', tone: 'gray' },
  error: { label: 'Error', tone: 'ocre' },
};

/** Bulk upload from the simple movements CSV: pick the file, check every row, then save the valid ones. */
export function CsvImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const refresh = useRefreshData();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = result?.rows.filter((r) => r.status === 'ok').length ?? 0;

  const pick = async (f: File | null) => {
    setFile(f);
    setResult(null);
    if (!f) return;
    setBusy(true);
    try {
      setResult(await send(f, false));
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await send(file, true);
      notifyOk(r.created === 1 ? '1 movimiento cargado' : `${r.created} movimientos cargados`);
      refresh();
      onDone();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>Importar desde CSV</Text>} size="xl" centered fullScreen={window.innerWidth < 600}>
      <Stack gap="sm">
        <List size="sm" spacing={2}>
          <List.Item>Una fila por movimiento.</List.Item>
          <List.Item>
            Columnas obligatorias: <b>fecha, tipo, monto, cuenta</b>.
          </List.Item>
          <List.Item>
            Columnas opcionales: <b>categoria, descripcion, comercio, compartido, etiquetas, notas</b>.
          </List.Item>
          <List.Item>Formatos admitidos: CSV y Excel (.xlsx).</List.Item>
        </List>
        <Anchor href="/ejemplo-movimientos.csv" download size="sm" w="fit-content">
          <Group gap={4} wrap="nowrap">
            <IconDownload size={14} />
            Descargar ejemplo
          </Group>
        </Anchor>
        <FileButton onChange={pick} accept=".csv,text/csv,.xlsx">
          {(props) => (
            <Button {...props} variant="default" leftSection={<IconFileUpload size={16} />} loading={busy && !result} w="fit-content">
              {file ? file.name : 'Elegir archivo'}
            </Button>
          )}
        </FileButton>

        {result && (
          <>
            <Alert color={ok ? 'blue' : 'yellow'} p="xs">
              <Text size="sm">
                {ok} para cargar
                {result.rows.some((r) => r.status === 'duplicate') && ` · ${result.rows.filter((r) => r.status === 'duplicate').length} repetidos (se saltean)`}
                {result.rows.some((r) => r.status === 'error') && ` · ${result.rows.filter((r) => r.status === 'error').length} con errores (deben corregirse en el archivo antes de volver a cargarlo)`}
              </Text>
            </Alert>
            <Table.ScrollContainer minWidth={680} mah={360}>
              <Table verticalSpacing={4} stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={48}>Fila</Table.Th>
                    <Table.Th w={84}>Fecha</Table.Th>
                    <Table.Th>Descripción</Table.Th>
                    <Table.Th>Cuenta</Table.Th>
                    <Table.Th ta="right">Monto</Table.Th>
                    <Table.Th w={90}>Estado</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.rows.map((r) => (
                    <Table.Tr key={r.line}>
                      <Table.Td className="num">{r.line}</Table.Td>
                      <Table.Td className="num">{r.date ? date(r.date, 'DD/MM/YY') : '—'}</Table.Td>
                      <Table.Td>
                        <Text size="sm" lineClamp={1}>
                          {r.description || (r.category ?? '')}
                        </Text>
                        {r.message && (
                          <Text size="xs" c={r.status === 'error' ? 'red.8' : 'dimmed'}>
                            {r.message}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" lineClamp={1}>
                          {r.account ?? '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {r.amount != null ? `${r.type === 'expense' ? '-' : '+'}${money(r.amount, r.currency)}` : '—'}
                      </Table.Td>
                      <Table.Td>
                        <span className="pfd-tag" data-tone={STATUS[r.status].tone}>
                          {STATUS[r.status].label}
                        </span>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy && !!result} disabled={!ok}>
            {ok === 1 ? 'Cargar 1 movimiento' : `Cargar ${ok} movimientos`}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
