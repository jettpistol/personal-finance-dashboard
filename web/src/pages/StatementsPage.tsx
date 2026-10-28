import { Fragment, useState } from 'react';
import { Alert, Badge, Button, Card, Collapse, FileButton, Group, List, Stack, Stepper, Table, Tabs, Text } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconFileText, IconUpload, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { notifyError, useAccounts, useRefreshData } from '../lib/queries';
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
      issuer: 'visa' | 'amex';
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

const FILE_LABEL = { pdf: 'PDF', xlsx: 'Excel' } as const;

export function StatementsPage() {
  const [tab, setTab] = useState<string | null>('import');
  return (
    <>
      <PageHeader title="Resúmenes" />
      <Tabs value={tab} onChange={setTab} keepMounted>
        <Tabs.List mb="md">
          <Tabs.Tab value="import">Importar resumen</Tabs.Tab>
          <Tabs.Tab value="formats">Cómo funciona y formatos</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="import">
          <StatementWizard onSeeFormats={() => setTab('formats')} />
        </Tabs.Panel>
        <Tabs.Panel value="formats">
          <HowItWorks />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

function StatementWizard({ onSeeFormats }: { onSeeFormats: () => void }) {
  const refresh = useRefreshData();
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

  const onFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setDetected(null);
    setProblem(null);
    try {
      const up = await api.upload<Upload>('/imports/upload', file);
      setUpload(up);
      try {
        setDetected(await api.post<Detected>('/statements/detect', { upload_id: up.upload_id }));
      } catch (e) {
        setProblem((e as Error).message);
      }
    } catch (e) {
      notifyError(e);
    } finally {
      setUploading(false);
    }
  };

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
      setResult(await api.post<CommitResult>('/imports/commit', { file_name: upload.file_name, account_id: accountId, preset_id: null, rows }));
      setStep(2);
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
          Los archivos no se guardan: se leen en memoria y se descartan a los 30 minutos. En los PDF, las líneas de pago de una tarjeta quedan sin marcar porque el pago ya figura en la cuenta bancaria.
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
          Se irán sumando más formatos, por ejemplo Naranja X, Ualá y Binance.
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
