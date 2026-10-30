import { Fragment, useEffect, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Collapse, FileButton, Group, List, Menu, Stack, Stepper, Table, Tabs, Text } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconDots, IconFileText, IconMail, IconUpload, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { notifyError, notifyOk, useAccounts, useRefreshData } from '../lib/queries';
import type { ImportItem } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { AccountSelect } from '../components/inputs';
import { ImportReview } from '../components/ImportReview';

type ReaderInfo = {
  id: string;
  institution: string;
  product: string;
  document: string;
  fileType: 'pdf' | 'xlsx';
  target: 'bank' | 'card';
  currencies: Array<'ARS' | 'USD'>;
  reads: string[];
  howToGet: string;
  checks: string[];
  limits: string[];
};

type Summary =
  | { kind: 'account'; accountRef: string; periodFrom: string | null; periodTo: string | null; count: number; openingBalance: number; closingBalance: number }
  | {
      kind: 'card';
      issuer: 'visa' | 'amex' | 'naranjax';
      accountRef: string;
      count: number;
      closeDate: string;
      dueDate: string;
      totalDue: { ars: number; usd: number };
      minimumPayment: number | null;
      upcomingInstallments: Array<{ month: string; amount: number }>;
      cards: Array<{ last4: string; holder: string }>;
    };

type Check = { name: string; label: string; ok: boolean; detail: string | null };
type Detected = { reader: ReaderInfo; summary: Summary; integrity: { ok: boolean; checks: Check[] }; warnings: string[] };
type Previewed = Detected & { items: ImportItem[]; errors: { line: number; message: string }[]; total_rows: number };
type Upload = { upload_id: string; file_name: string; size: number };
type CommitResult = { batch_id: number; imported: number; failures: { description: string; error: string }[] };
/** A statement that arrived by email (Ajustes → Gmail), waiting in Resúmenes. */
type MailItem = {
  id: number;
  file_name: string;
  received_at: string;
  status: 'pending' | 'imported' | 'failed';
  title: string;
  summary: Summary | null;
  integrity_ok: boolean | null;
  error: string | null;
};
/** A received statement opened in the wizard: already uploaded, maybe with its usual account. */
type Received = { mailId: number; upload: Upload; accountId: number | null };
const MAIL_KEY = ['mail-statements'];

const FILE_LABEL = { pdf: 'PDF', xlsx: 'Excel' } as const;

export function StatementsPage() {
  const [tab, setTab] = useState<string | null>('import');
  const [received, setReceived] = useState<Received | null>(null);
  return (
    <>
      <PageHeader title="Resúmenes" />
      <Tabs value={tab} onChange={setTab} keepMounted>
        <Tabs.List mb="md">
          <Tabs.Tab value="import">Importar resumen</Tabs.Tab>
          <Tabs.Tab value="formats">Cómo funciona y formatos</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="import">
          <Stack>
            <MailInbox openId={received?.mailId ?? null} onOpen={setReceived} />
            <StatementWizard onSeeFormats={() => setTab('formats')} received={received} onDone={() => setReceived(null)} />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="formats">
          <HowItWorks />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

function StatementWizard({ onSeeFormats, received, onDone }: { onSeeFormats: () => void; received: Received | null; onDone: () => void }) {
  const refresh = useRefreshData();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [step, setStep] = useState(0);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Previewed | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);

  const account = accounts.data?.find((a) => a.id === accountId);

  const detect = async (up: Upload) => {
    setUpload(up);
    try {
      setDetected(await api.post<Detected>('/statements/detect', { upload_id: up.upload_id }));
    } catch (e) {
      setProblem((e as Error).message);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    if (received) onDone();
    setUploading(true);
    setDetected(null);
    setProblem(null);
    try {
      await detect(await api.upload<Upload>('/imports/upload', file));
    } catch (e) {
      notifyError(e);
    } finally {
      setUploading(false);
    }
  };

  // A statement from Recibidos por correo starts the wizard over, as if its file had just been chosen.
  useEffect(() => {
    if (!received) return;
    restart();
    setAccountId(received.accountId);
    setUploading(true);
    void detect(received.upload).finally(() => setUploading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received?.mailId]);

  const loadPreview = async () => {
    if (!upload || !accountId) return;
    setLoadingPreview(true);
    try {
      const p = await api.post<Previewed>('/statements/preview', { upload_id: upload.upload_id, account_id: accountId });
      setPreview(p);
      setItems(p.items);
      setStep(1);
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
      const r = await api.post<CommitResult>('/imports/commit', { file_name: upload.file_name, account_id: accountId, preset_id: null, rows });
      setResult(r);
      setStep(2);
      if (received) {
        await api.post(`/mail-statements/${received.mailId}/imported`, { account_id: accountId, batch_id: r.batch_id }).catch(() => undefined);
        qc.invalidateQueries({ queryKey: MAIL_KEY });
        onDone();
      }
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
    setDetected(null);
    setProblem(null);
    setPreview(null);
    setItems([]);
    setResult(null);
  };

  return (
    <Card>
      <Stepper active={step} onStepClick={(s) => s < step && step < 2 && setStep(s)} size="sm" allowNextStepsSelect={false}>
        <Stepper.Step label="Archivo" description="Subir y elegir cuenta">
          <Stack mt="md" maw={640}>
            <Group>
              <FileButton onChange={onFile} accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
                {(props) => (
                  <Button {...props} leftSection={<IconUpload size={16} />} loading={uploading} variant={upload ? 'default' : 'filled'}>
                    {upload ? 'Cambiar archivo' : 'Elegir archivo'}
                  </Button>
                )}
              </FileButton>
              {upload && (
                <Group gap={6}>
                  <IconFileText size={18} />
                  <Text size="sm">{upload.file_name}</Text>
                  <Text size="xs" c="dimmed">
                    ({Math.ceil(upload.size / 1024)} KB)
                  </Text>
                </Group>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              PDF o Excel (.xlsx), tal como los entrega el banco. El formato se reconoce solo.{' '}
              <Text component="a" size="xs" c="blue" style={{ cursor: 'pointer' }} onClick={onSeeFormats}>
                Ver formatos disponibles
              </Text>
            </Text>

            {problem && (
              <Alert color="red" icon={<IconX size={16} />} title="No se pudo reconocer el archivo">
                {problem}
              </Alert>
            )}

            {detected && <Recognised d={detected} />}

            {detected?.integrity.ok && (
              <>
                <AccountSelect
                  label="Cuenta de destino"
                  description={
                    detected.reader.target === 'card'
                      ? 'La cuenta de esta tarjeta. Los consumos en dólares solo entran a una cuenta en dólares.'
                      : 'La cuenta bancaria de este extracto. Todos los movimientos entran en pesos.'
                  }
                  value={accountId}
                  onChange={setAccountId}
                  writableOnly
                  required
                />
                <Group justify="flex-end">
                  <Button disabled={!accountId} loading={loadingPreview} onClick={loadPreview}>
                    Vista previa
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Revisar" description="Categorías y duplicados">
          {preview && (
            <ImportReview
              errors={preview.errors}
              items={items}
              setItems={setItems}
              currency={account?.currency ?? 'ARS'}
              onBack={() => setStep(0)}
              backLabel="Volver"
              onCommit={commit}
              committing={committing}
            />
          )}
        </Stepper.Step>

        <Stepper.Completed>
          {result && (
            <Stack mt="md" maw={640}>
              <Alert color={result.failures.length ? 'yellow' : 'teal'} title={`Se importaron ${result.imported} movimientos`}>
                {result.failures.length ? `${result.failures.length} filas no se pudieron importar:` : 'Listo. Se puede deshacer esta importación desde Importar → Historial.'}
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
                <Button onClick={restart}>Importar otro resumen</Button>
              </Group>
            </Stack>
          )}
        </Stepper.Completed>
      </Stepper>
    </Card>
  );
}

/**
 * Statements that arrived by email (Ajustes → Gmail). Shown only to whoever turned the search on;
 * pending ones first. «Revisar» opens one in the wizard below.
 */
function MailInbox({ openId, onOpen }: { openId: number | null; onOpen: (r: Received) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: MAIL_KEY, queryFn: () => api.get<{ on: boolean; items: MailItem[] }>('/mail-statements') });
  const [busy, setBusy] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const data = q.data;
  if (!data || (!data.on && !data.items.length)) return null;

  const pending = data.items.filter((i) => i.status !== 'imported');
  const done = data.items.filter((i) => i.status === 'imported');

  const open = async (item: MailItem) => {
    setBusy(item.id);
    try {
      const r = await api.post<Upload & { account_id: number | null }>(`/mail-statements/${item.id}/open`);
      onOpen({ mailId: item.id, upload: { upload_id: r.upload_id, file_name: r.file_name, size: r.size }, accountId: r.account_id });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };
  const dismiss = async (item: MailItem) => {
    try {
      await api.post(`/mail-statements/${item.id}/dismiss`);
      qc.invalidateQueries({ queryKey: MAIL_KEY });
      notifyOk(`Descartado ${item.file_name}.`);
    } catch (e) {
      notifyError(e);
    }
  };

  const facts = (i: MailItem) => {
    const s = i.summary;
    if (!s) return i.error ?? '';
    if (s.kind === 'account') return `${s.count} movimientos`;
    return [`Vence ${date(s.dueDate, 'DD/MM/YY')}`, `${money(s.totalDue.ars, 'ARS')}${s.totalDue.usd ? ` y ${money(s.totalDue.usd, 'USD')}` : ''}`, `${s.count} movimientos`].join(' · ');
  };

  const row = (i: MailItem) => (
    <Group key={i.id} justify="space-between" wrap="nowrap" gap="sm">
      <div style={{ minWidth: 0 }}>
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={600} truncate>
            {i.title}
          </Text>
          {i.status === 'failed' && (
            <Badge size="xs" color="ocre" variant="light">
              No se pudo leer
            </Badge>
          )}
          {i.status === 'pending' && i.integrity_ok === false && (
            <Badge size="xs" color="red" variant="light">
              No cuadra
            </Badge>
          )}
          {i.status === 'imported' && (
            <Badge size="xs" color="teal" variant="light">
              Importado
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed" truncate>
          {facts(i)}
        </Text>
      </div>
      <Group gap={4} wrap="nowrap">
        {i.status !== 'failed' && (
          <Button size="xs" variant={i.status === 'pending' ? 'filled' : 'default'} loading={busy === i.id} disabled={openId === i.id} onClick={() => open(i)}>
            {openId === i.id ? 'Abierto' : i.status === 'pending' ? 'Revisar' : 'Abrir'}
          </Button>
        )}
        {i.status !== 'imported' && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Más opciones">
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item color="red" onClick={() => dismiss(i)}>
                Descartar
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Group>
  );

  return (
    <Card>
      <Group justify="space-between" mb="xs">
        <Group gap={6}>
          <IconMail size={16} />
          <Text fw={700}>Recibidos por correo</Text>
        </Group>
        <Anchor component={Link} to="/ajustes?tab=gmail" size="xs">
          Gmail
        </Anchor>
      </Group>
      <Stack gap="xs">
        {pending.length ? pending.map(row) : <Text size="sm" c="dimmed">No hay resúmenes nuevos.</Text>}
        {done.length > 0 && (
          <>
            <Anchor component="button" size="xs" ta="left" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Ocultar importados' : `Importados (${done.length})`}
            </Anchor>
            <Collapse in={showDone}>
              <Stack gap="xs">{done.map(row)}</Stack>
            </Collapse>
          </>
        )}
      </Stack>
    </Card>
  );
}

/** What was recognised, in one line, and whether the numbers add up. */
function Recognised({ d }: { d: Detected }) {
  const [showChecks, setShowChecks] = useState(false);
  const s = d.summary;
  const facts =
    s.kind === 'account'
      ? [
          s.periodFrom && s.periodTo ? `Del ${date(s.periodFrom, 'DD/MM/YY')} al ${date(s.periodTo, 'DD/MM/YY')}` : null,
          `${s.count} movimientos`,
          `Saldo final ${money(s.closingBalance, 'ARS')}`,
        ]
      : [
          `Cierre ${date(s.closeDate, 'DD/MM/YY')}`,
          `Vence ${date(s.dueDate, 'DD/MM/YY')}`,
          `Total a pagar ${money(s.totalDue.ars, 'ARS')}${s.totalDue.usd ? ` y ${money(s.totalDue.usd, 'USD')}` : ''}`,
          `${s.count} movimientos`,
        ];
  const failed = d.integrity.checks.filter((c) => !c.ok);
  return (
    <Alert
      color={d.integrity.ok ? 'teal' : 'red'}
      icon={d.integrity.ok ? <IconCheck size={16} /> : <IconX size={16} />}
      title={`${d.reader.institution} · ${d.reader.product} · ${d.reader.document}`}
    >
      <Stack gap={6}>
        <Text size="sm">{facts.filter(Boolean).join(' · ')}</Text>
        {d.integrity.ok ? (
          <Group gap="xs">
            <Text size="sm">Los números cuadran con los totales del documento.</Text>
            <Button size="compact-xs" variant="subtle" onClick={() => setShowChecks((v) => !v)}>
              {showChecks ? 'Ocultar controles' : 'Ver controles'}
            </Button>
          </Group>
        ) : (
          <Text size="sm" fw={600}>
            Los números no cuadran con los totales del documento, así que no se importa.
          </Text>
        )}
        <Collapse in={showChecks || !d.integrity.ok}>
          <Stack gap={2}>
            {(d.integrity.ok ? d.integrity.checks : failed).map((c) => (
              <Group key={c.name} gap={6} wrap="nowrap" align="flex-start">
                {c.ok ? <IconCheck size={14} style={{ marginTop: 3 }} /> : <IconX size={14} style={{ marginTop: 3 }} />}
                <Text size="xs">
                  {c.label}
                  {c.detail ? `: ${c.detail}` : ''}
                </Text>
              </Group>
            ))}
          </Stack>
        </Collapse>
        {d.warnings.map((w, i) => (
          <Group key={i} gap={6} wrap="nowrap" align="flex-start">
            <IconAlertTriangle size={14} style={{ marginTop: 3 }} />
            <Text size="xs">{w}</Text>
          </Group>
        ))}
      </Stack>
    </Alert>
  );
}

const STEPS = [
  ['Elegir el archivo', 'El PDF o el Excel tal como lo entrega el banco. No hace falta indicar de qué banco ni de qué producto es.'],
  ['Reconocimiento', 'El formato se identifica por el contenido del archivo, no por su nombre, y se leen los movimientos.'],
  ['Controles', 'Se comprueba que los números leídos cuadren con los totales que el propio documento imprime: saldos, total a pagar, suma de compras. Si no cuadran, el archivo no se importa.'],
  ['Revisión', 'Se elige la cuenta de destino y se revisan tipos, categorías y duplicados. Las reglas propias van primero; después, el banco de reglas sugeridas. Lo que no se reconoce queda sin categoría.'],
  ['Importación', 'Los movimientos entran como en cualquier otra importación y se pueden deshacer desde Importar → Historial.'],
];

function HowItWorks() {
  const readers = useQuery({ queryKey: ['statement-readers'], queryFn: () => api.get<ReaderInfo[]>('/statements/readers') });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Stack>
      <Card>
        <Text fw={700} mb="xs">
          Cómo funciona
        </Text>
        <List type="ordered" spacing="xs" size="sm">
          {STEPS.map(([title, text]) => (
            <List.Item key={title}>
              <Text span fw={600}>
                {title}.
              </Text>{' '}
              {text}
            </List.Item>
          ))}
        </List>
        <Text size="xs" c="dimmed" mt="sm">
          Los archivos subidos no se guardan: se leen en memoria y se descartan a los 30 minutos. Los que llegan por correo (Ajustes → Gmail) se guardan hasta que se descartan. En los PDF, las líneas de pago de una tarjeta quedan sin marcar porque el pago ya figura en la cuenta bancaria.
        </Text>
      </Card>

      <Card>
        <Text fw={700} mb="xs">
          Formatos que se pueden leer
        </Text>
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Formato</Table.Th>
                <Table.Th w={90}>Archivo</Table.Th>
                <Table.Th w={110}>Moneda</Table.Th>
                <Table.Th w={100} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(readers.data ?? []).map((r) => (
                <Fragment key={r.id}>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {r.institution} · {r.product}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {r.document}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" size="sm">
                        {FILE_LABEL[r.fileType]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{r.currencies.join(' y ')}</Table.Td>
                    <Table.Td ta="right">
                      <Button size="compact-xs" variant="default" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? 'Ocultar' : 'Detalles'}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td colSpan={4} p={0} style={{ borderBottom: open === r.id ? undefined : 'none' }}>
                      <Collapse in={open === r.id}>
                        <ReaderDetails r={r} />
                      </Collapse>
                    </Table.Td>
                  </Table.Tr>
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="xs" c="dimmed" mt="sm">
          Se irán sumando más formatos, por ejemplo Ualá y Binance.
        </Text>
      </Card>
    </Stack>
  );
}

function ReaderDetails({ r }: { r: ReaderInfo }) {
  const section = (title: string, lines: string[]) => (
    <div>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={2}>
        {title}
      </Text>
      <List size="sm" spacing={2}>
        {lines.map((l) => (
          <List.Item key={l}>{l}</List.Item>
        ))}
      </List>
    </div>
  );
  return (
    <Stack gap="sm" p="sm">
      {section('Qué se lee', r.reads)}
      {section('Cómo se obtiene', [r.howToGet])}
      {section('Controles', r.checks)}
      {section('A tener en cuenta', r.limits)}
    </Stack>
  );
}
