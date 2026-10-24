import { useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Code, CopyButton, Group, List, PasswordInput, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import { date, money } from '../lib/format';
import { notifyError, notifyOk, useAccounts, useRefreshData } from '../lib/queries';

type Connection = {
  user_id: number;
  display_name: string;
  connected: boolean;
  hidden?: boolean;
  account_id?: number;
  account_name?: string | null;
  nickname?: string | null;
  test_credentials?: boolean;
  sync_from?: string;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  balance?: { available: number | null; unavailable: number | null; total: number | null } | null;
  balance_at?: string | null;
  balance_error?: string | null;
  app_balance?: number | null;
  balance_drift?: number | null;
  report_error?: string | null;
  movements?: Record<string, number>;
  webhook?: { url: string; has_secret: boolean; public_url_set: boolean } | null;
};

type Movement = {
  id: number;
  source: 'payment' | 'report';
  status: string | null;
  description: string;
  amount: number;
  date: string;
  tx_state: 'none' | 'created' | 'matched' | 'reversed' | 'skipped' | 'error';
  tx_status: 'confirmed' | 'pending' | null;
  note: string | null;
};

const STATE_LABEL: Record<Movement['tx_state'], { label: string; color: string }> = {
  created: { label: 'Cargado', color: 'teal' },
  matched: { label: 'Ya estaba', color: 'blue' },
  none: { label: 'En espera', color: 'gray' },
  reversed: { label: 'Anulado', color: 'gray' },
  skipped: { label: 'Omitido', color: 'gray' },
  error: { label: 'Error', color: 'red' },
};

// SQLite datetime('now') is UTC without a zone marker.
const when = (s: string | null | undefined) => (s ? date(`${s.replace(' ', 'T')}Z`, 'DD/MM HH:mm') : 'nunca');

export function MercadoPagoSettings() {
  const { me } = useApp();
  const connections = useQuery({
    queryKey: ['mp-connections'],
    queryFn: () => api.get<Connection[]>('/mp/connections'),
    // While a first sync runs in the background, keep the status fresh.
    refetchInterval: (q) => (q.state.data?.some((c) => c.connected && !c.hidden && !c.last_sync_at) ? 3000 : false),
  });
  if (!connections.data) return null;
  const mine = connections.data.find((c) => c.user_id === me.id);
  const others = connections.data.filter((c) => c.user_id !== me.id);

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {mine?.connected ? <ConnectedCard conn={mine} /> : <ConnectCard />}
        <Card>
          <Stack gap="xs">
            <Title order={4}>Cómo funciona</Title>
            <Text size="sm">
              Cada uno conecta su propia cuenta de Mercado Pago. Los pagos aprobados se cargan solos en tu cuenta «Mercado Pago» de la app, con tus reglas aplicadas,
              y se agrupan por día en <b>Importar</b>, así que podés deshacerlos.
            </Text>
            <List size="sm" spacing={4}>
              <List.Item>Si un pago se reintegra o se cancela, el movimiento se borra.</List.Item>
              <List.Item>Si ya lo habías cargado (a mano o desde un CSV), se vincula en vez de duplicarse.</List.Item>
              <List.Item>Lo pagado con tarjeta desde Mercado Pago y lo que solo aparece en el reporte (rendimientos, por ejemplo) queda como <b>pendiente</b> para que lo confirmes.</List.Item>
              <List.Item>Se sincroniza cada 15 minutos. Con la URL de notificaciones configurada, al instante.</List.Item>
            </List>
            {others.map((o) => (
              <Group key={o.user_id} justify="space-between" mt="xs">
                <Text size="sm">{o.display_name}</Text>
                {o.hidden ? <Badge color="gray">Privado</Badge> : o.connected ? <Badge color="teal">Conectado{o.nickname ? ` (${o.nickname})` : ''}</Badge> : <Badge color="gray">Sin conectar</Badge>}
              </Group>
            ))}
          </Stack>
        </Card>
      </SimpleGrid>
      {mine?.connected && <MovementsCard />}
    </Stack>
  );
}

function ConnectCard({ current }: { current?: Connection }) {
  const qc = useQueryClient();
  const { me } = useApp();
  const accounts = useAccounts();
  const [token, setToken] = useState('');
  const [picked, setAccountId] = useState<string | null>(current?.account_id ? String(current.account_id) : null);
  const [from, setFrom] = useState<string | null>(current?.sync_from ?? `${new Date().toISOString().slice(0, 7)}-01`);
  const [busy, setBusy] = useState(false);

  const own = (accounts.data ?? []).filter((a) => a.owner_id === me.id && a.currency === 'ARS' && !a.archived);
  // Default to the wallet account you already have, so connecting does not create a second one.
  const wallet = own.find((a) => a.type === 'wallet');
  const accountId = picked ?? (wallet ? String(wallet.id) : 'new');
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ nickname: string | null }>('/mp/connection', { access_token: token.trim(), account_id: accountId === 'new' ? null : Number(accountId), sync_from: from });
      notifyOk(`Conectado${r.nickname ? ` como ${r.nickname}` : ''}. Trayendo movimientos…`);
      setToken('');
      qc.invalidateQueries({ queryKey: ['mp-connections'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Stack>
        <Title order={4}>{current ? 'Cambiar el access token' : 'Conectar tu Mercado Pago'}</Title>
        <List size="sm" type="ordered" spacing={4}>
          <List.Item>
            Entrá a{' '}
            <Anchor href="https://www.mercadopago.com.ar/developers/panel/app" target="_blank" rel="noopener" size="sm">
              Tus integraciones
            </Anchor>{' '}
            con tu cuenta y creá una aplicación (cualquier nombre).
          </List.Item>
          <List.Item>
            En <b>Credenciales de producción</b>, copiá el <b>Access token</b> (empieza con <Code>APP_USR-</Code>).
          </List.Item>
          <List.Item>Pegalo acá. Se guarda cifrado y solo lo usa el servidor.</List.Item>
        </List>
        <PasswordInput label="Access token" placeholder="APP_USR-…" value={token} onChange={(e) => setToken(e.currentTarget.value)} />
        {token.startsWith('TEST-') && (
          <Alert color="yellow">Es un token de prueba: vas a ver solo datos de usuarios de prueba, no tu cuenta real.</Alert>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Cargar en la cuenta"
            value={accountId}
            onChange={setAccountId}
            allowDeselect={false}
            data={[{ value: 'new', label: 'Crear «Mercado Pago»' }, ...own.map((a) => ({ value: String(a.id), label: a.name }))]}
          />
          <DateInput label="Traer movimientos desde" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} />
        </SimpleGrid>
        <Group>
          <Button onClick={submit} loading={busy} disabled={!token.trim() || !from}>
            {current ? 'Guardar token' : 'Conectar'}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function ConnectedCard({ conn }: { conn: Connection }) {
  const qc = useQueryClient();
  const refresh = useRefreshData();
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [editToken, setEditToken] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) notifyOk(ok);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ['mp-connections'] });
      qc.invalidateQueries({ queryKey: ['mp-movements'] });
      refresh();
    }
  };

  const disconnect = () =>
    modals.openConfirmModal({
      title: 'Desconectar Mercado Pago',
      children: <Text size="sm">Se borra el token y el historial de sincronización. Los movimientos ya cargados en la app se quedan.</Text>,
      labels: { confirm: 'Desconectar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => run('disconnect', () => api.del('/mp/connection'), 'Mercado Pago desconectado'),
    });

  if (editToken) return <ConnectCard current={conn} />;
  const drift = conn.balance_drift;

  return (
    <Card>
      <Stack>
        <Group justify="space-between">
          <Title order={4}>Tu Mercado Pago</Title>
          <Group gap="xs">
            {conn.test_credentials && <Badge color="yellow">Prueba</Badge>}
            <Badge color={conn.last_sync_error ? 'red' : 'teal'}>{conn.last_sync_error ? 'Con errores' : 'Conectado'}</Badge>
          </Group>
        </Group>
        <Text size="sm">
          {conn.nickname} → cuenta <b>{conn.account_name}</b>, desde el {date(conn.sync_from!, 'DD/MM/YYYY')}. Última sincronización: {when(conn.last_sync_at)}.
        </Text>
        {conn.last_sync_error && <Alert color="red">{conn.last_sync_error}</Alert>}

        <Table fz="sm" verticalSpacing={4} withRowBorders={false}>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>Saldo en Mercado Pago</Table.Td>
              <Table.Td ta="right" className="num">
                {conn.balance?.total != null ? money(conn.balance.total) : '—'}
              </Table.Td>
            </Table.Tr>
            {conn.balance?.unavailable ? (
              <Table.Tr>
                <Table.Td c="dimmed">de eso, a liberar</Table.Td>
                <Table.Td ta="right" className="num" c="dimmed">
                  {money(conn.balance.unavailable)}
                </Table.Td>
              </Table.Tr>
            ) : null}
            <Table.Tr>
              <Table.Td>Saldo en la app</Table.Td>
              <Table.Td ta="right" className="num">
                {money(conn.app_balance)}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
        {drift != null && drift !== 0 && (
          <Alert color="yellow">
            Hay {money(Math.abs(drift))} de diferencia ({drift > 0 ? 'Mercado Pago tiene más' : 'la app tiene más'}). Revisá los pendientes, o ajustá el saldo inicial de la cuenta si
            empezaste a sincronizar a mitad de camino.
          </Alert>
        )}
        {conn.balance_error && <Alert color="yellow">No se pudo leer el saldo: {conn.balance_error}</Alert>}
        {conn.report_error && <Alert color="yellow">Reporte de dinero en cuenta: {conn.report_error}</Alert>}

        <Stack gap={4}>
          <Text size="sm" fw={700}>
            Notificaciones al instante (opcional)
          </Text>
          <Text size="sm" c="dimmed">
            En tu aplicación de Mercado Pago, entrá a <b>Webhooks → Configurar notificaciones</b>, pegá esta URL en <b>modo productivo</b>, marcá solo <b>Pagos</b> y guardá. Después
            copiá la <b>clave secreta</b> acá.
          </Text>
          <Group gap="xs" wrap="nowrap">
            <Code style={{ flex: 1, overflowWrap: 'anywhere' }}>{conn.webhook!.url}</Code>
            <CopyButton value={conn.webhook!.url}>
              {({ copied, copy }) => (
                <Button size="xs" variant="default" onClick={copy}>
                  {copied ? 'Copiada' : 'Copiar'}
                </Button>
              )}
            </CopyButton>
          </Group>
          {!conn.webhook!.public_url_set && (
            <Text size="xs" c="dimmed">
              Falta <Code>MP_WEBHOOK_BASE_URL</Code> en el servidor: Mercado Pago necesita una dirección pública con HTTPS. Mientras tanto, la sincronización cada 15 minutos alcanza.
            </Text>
          )}
          <Group align="flex-end">
            <PasswordInput
              label="Clave secreta"
              placeholder={conn.webhook!.has_secret ? 'Guardada (escribí para reemplazarla)' : 'Pegala acá'}
              value={secret}
              onChange={(e) => setSecret(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button variant="default" disabled={secret.trim().length < 8} loading={busy === 'secret'} onClick={() => run('secret', () => api.patch('/mp/connection', { webhook_secret: secret.trim() }).then(() => setSecret('')), 'Clave guardada')}>
              Guardar
            </Button>
          </Group>
        </Stack>

        <Group>
          <Button loading={busy === 'sync'} onClick={() => run('sync', () => api.post<{ inserted: number }>('/mp/connection/sync').then((r) => notifyOk(`${r.inserted} movimientos nuevos`)))}>
            Sincronizar ahora
          </Button>
          <Button variant="default" loading={busy === 'report'} onClick={() => run('report', () => api.post('/mp/connection/report'), 'Reporte pedido: se importa cuando Mercado Pago lo termine')}>
            Pedir reporte
          </Button>
          <Button variant="default" onClick={() => setEditToken(true)}>
            Cambiar token
          </Button>
          <Button variant="subtle" color="red" loading={busy === 'disconnect'} onClick={disconnect}>
            Desconectar
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function MovementsCard() {
  const movements = useQuery({ queryKey: ['mp-movements'], queryFn: () => api.get<Movement[]>('/mp/connection/movements?limit=50') });
  return (
    <Card>
      <Stack>
        <Title order={4}>Últimos movimientos de Mercado Pago</Title>
        {!movements.data?.length ? (
          <Text size="sm" c="dimmed">
            Todavía no llegó nada.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table fz="sm" verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Descripción</Table.Th>
                  <Table.Th ta="right">Monto</Table.Th>
                  <Table.Th>En la app</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {movements.data.map((m) => (
                  <Table.Tr key={m.id}>
                    <Table.Td className="num">{date(m.date, 'DD/MM/YY')}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{m.description}</Text>
                      {m.note && (
                        <Text size="xs" c="dimmed">
                          {m.note}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right" className="num">
                      {money(m.amount, 'ARS', { sign: true })}
                    </Table.Td>
                    <Table.Td>
                      {m.tx_state === 'created' && m.tx_status === 'pending' ? (
                        <Badge color="yellow">Pendiente</Badge>
                      ) : (
                        <Badge color={STATE_LABEL[m.tx_state].color}>{STATE_LABEL[m.tx_state].label}</Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </Card>
  );
}
