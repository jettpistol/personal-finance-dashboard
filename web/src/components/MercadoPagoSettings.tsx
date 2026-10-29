import { useEffect, useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Collapse, Group, Loader, Menu, Modal, PasswordInput, Radio, Stack, Text, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconChevronDown, IconChevronRight, IconDots, IconPencil, IconRefresh } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { date, money, today } from '../lib/format';
import { MercadoPagoReview } from './MercadoPagoReview';
import { errorFields, notifyError, notifyOk } from '../lib/queries';

type Check = { key: 'identity' | 'payments' | 'balance' | 'release_report' | 'settlement_report'; status: 'ok' | 'unconfigured' | 'unavailable' | 'error'; http: number | null };
type Setup = { key: 'release_report' | 'settlement_report'; result: 'exists' | 'created' | 'failed'; http: number | null; message?: string };
type Connection =
  | { connected: false }
  | {
      connected: true;
      mp_user_id: number | null;
      nickname: string | null;
      site_id: string | null;
      history_start: string | null;
      connected_at: string;
      checked_at: string | null;
      checks: Check[] | null;
      readable: boolean;
      /** Its account in Cuentas (this data profile), or the existing ones it has to be tied to. */
      account: { id: number; name: string } | null;
      candidates: { id: number; name: string }[];
      sync?: Sync;
    };

/** How the movements import is going (lib/mp-sync.ts on the server). */
type Sync = {
  status: 'off' | 'fetching' | 'review' | 'live' | 'error';
  live: boolean;
  waiting: boolean;
  review_count: number;
  last_sync_at: string | null;
  error: string | null;
  balance: number | null;
  balance_at: string | null;
  app_balance: number | null;
};

const SOURCES: Record<Check['key'], string> = {
  identity: 'Datos de la cuenta',
  payments: 'Pagos recibidos',
  balance: 'Saldo',
  release_report: 'Reporte de dinero liberado',
  settlement_report: 'Reporte de todas las transacciones',
};
const STATUS: Record<Check['status'], { label: string; tone?: string }> = {
  ok: { label: 'Disponible' },
  unconfigured: { label: 'Sin configurar', tone: 'gray' },
  unavailable: { label: 'No disponible', tone: 'gray' },
  error: { label: 'Error', tone: 'ocre' },
};

const KEY = ['mercadopago'];

/**
 * Ajustes → Mercado Pago: each person connects their own account. The token is typed here once,
 * sent to the server and kept only in this component's state until saved; the server never sends
 * it back.
 */
export function MercadoPagoSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<Connection>('/me/mercadopago') });
  const [token, setToken] = useState('');
  // The owner's default for where the history starts.
  const [start, setStart] = useState<string | null>('2026-10-01');
  const [replacing, setReplacing] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [bad, setBad] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const c = q.data;
  const sync = c?.connected ? c.sync : undefined;
  const waiting = !!sync && (sync.status === 'fetching' || sync.waiting);

  // While Mercado Pago makes a report, ask every 15 s whether it's ready.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      try {
        const r = await api.post<Connection>('/me/mercadopago/sync', {});
        qc.setQueryData(KEY, r);
        if (r.connected && r.sync && !(r.sync.status === 'fetching' || r.sync.waiting)) {
          qc.invalidateQueries({ queryKey: ['accounts'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
        }
      } catch {
        /* the next tick tries again */
      }
    }, 15_000);
    return () => clearInterval(t);
  }, [waiting, qc]);

  if (!c) return null;

  const run = async (key: string, fn: () => Promise<Connection>, ok?: string) => {
    setBusy(key);
    setBad([]);
    try {
      qc.setQueryData(KEY, await fn());
      if (ok) notifyOk(ok);
      return true;
    } catch (e) {
      setBad(errorFields(e));
      notifyError(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    if (!token.trim()) {
      setBad(['access_token']);
      return;
    }
    const body = c.connected ? { access_token: token } : { access_token: token, history_start: start };
    const done = await run('connect', () => api.put<Connection>('/me/mercadopago', body), 'Cuenta de Mercado Pago conectada');
    if (done) {
      setToken('');
      setReplacing(false);
    }
  };

  const disconnect = () =>
    modals.openConfirmModal({
      title: 'Desconectar Mercado Pago',
      centered: true,
      children: (
        <Text size="sm">
          Se borra el token guardado en Finanzas. Para anularlo también en Mercado Pago, renovalo en Credenciales de producción.
        </Text>
      ),
      labels: { confirm: 'Desconectar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => run('disconnect', () => api.del<Connection>('/me/mercadopago'), 'Mercado Pago desconectado'),
    });

  const tokenField = (
    <PasswordInput
      label="Access Token de producción"
      placeholder="APP_USR-…"
      description="Se guarda cifrado y no se vuelve a mostrar."
      autoComplete="off"
      spellCheck={false}
      value={token}
      onChange={(e) => {
        setBad([]);
        setToken(e.currentTarget.value);
      }}
      onKeyDown={(e) => e.key === 'Enter' && connect()}
      error={bad.includes('access_token')}
      data-autofocus
    />
  );
  const help = (
    <Anchor component={Link} to="/ayuda/mercado-pago" size="sm">
      Cómo obtener el token
    </Anchor>
  );

  if (!c.connected) {
    return (
      <Card maw={560} mx="auto">
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Mercado Pago</Title>
            <Badge color="gray">Sin conectar</Badge>
          </Group>
          {tokenField}
          <DateInput
            label="Traer movimientos desde"
            placeholder="Opcional"
            valueFormat="DD/MM/YYYY"
            clearable
            maxDate={today()}
            value={start}
            onChange={setStart}
            error={bad.includes('history_start')}
          />
          {help}
          <Group>
            <Button loading={busy === 'connect'} onClick={connect}>
              Conectar
            </Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  const checks = c.checks ?? [];
  const available = checks.filter((x) => x.status === 'ok').length;
  const unconfigured = checks.some((x) => x.status === 'unconfigured');

  // Saves the missing report settings in Mercado Pago (no money moves), then shows the new checks.
  const setupReports = async () => {
    setBusy('reports');
    try {
      const r = await api.post<Connection & { setup: Setup[] }>('/me/mercadopago/reports');
      const { setup, ...view } = r;
      qc.setQueryData(KEY, view);
      setShowSources(true);
      const failed = setup.filter((x) => x.result === 'failed');
      // Mercado Pago's own reason (in its words) helps tell a wrong setting from an account that can't have reports.
      if (failed.length)
        notifyError(new Error(`Mercado Pago no aceptó: ${failed.map((x) => `${SOURCES[x.key]}${x.http ? ` (código ${x.http})` : ''}${x.message ? `: «${x.message}»` : ''}`).join('; ')}.`));
      else notifyOk('Reportes configurados');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const startSync = () => run('sync', () => api.post<Connection>('/me/mercadopago/sync', { start: true }));
  const when = (iso: string) => dayjs(iso).format(dayjs(iso).isSame(dayjs(), 'day') ? '[hoy] HH:mm' : 'D MMM HH:mm');
  const movements = !sync ? null : sync.status === 'off' ? (
    <Button size="xs" variant="default" loading={busy === 'sync'} disabled={!c.account || !c.readable} onClick={startSync}>
      Traer movimientos
    </Button>
  ) : sync.status === 'error' ? (
    <Stack gap={6} align="flex-start">
      <Text size="sm" c="red">
        {sync.error}
      </Text>
      <Button size="xs" variant="default" loading={busy === 'sync'} onClick={startSync}>
        Reintentar
      </Button>
    </Stack>
  ) : sync.status === 'fetching' ? (
    <Group gap="xs" wrap="nowrap">
      <Loader size={14} />
      <span>Buscando en Mercado Pago…</span>
    </Group>
  ) : sync.status === 'review' ? (
    <Group gap="xs" wrap="nowrap">
      <span>{sync.review_count} para revisar</span>
      <Button size="xs" onClick={() => setReviewing(true)}>
        Revisar
      </Button>
    </Group>
  ) : (
    <Group gap="xs" wrap="nowrap">
      <span>{sync.waiting ? 'Actualizando…' : `Al día${sync.last_sync_at ? ` · ${when(sync.last_sync_at)}` : ''}`}</span>
      {sync.review_count > 0 && (
        <Button size="compact-xs" variant="default" onClick={() => setReviewing(true)}>
          {sync.review_count} para revisar
        </Button>
      )}
      {!sync.waiting && (
        <Tooltip label="Buscar ahora">
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Buscar movimientos ahora" loading={busy === 'sync'} onClick={startSync}>
            <IconRefresh size={14} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );

  return (
    <Card maw={560} mx="auto">
      <MercadoPagoReview opened={reviewing} onClose={() => setReviewing(false)} onSaved={(r) => qc.setQueryData(KEY, r)} />
      <Stack>
        <Group justify="space-between" wrap="nowrap">
          <Title order={4}>Mercado Pago</Title>
          <Group gap="xs" wrap="nowrap">
            {c.readable ? <Badge color="teal">Conectada</Badge> : <Badge color="yellow">Volvé a conectar</Badge>}
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Más opciones">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setReplacing(true)}>Reemplazar token</Menu.Item>
                <Menu.Item color="red" onClick={disconnect}>
                  Desconectar
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        <dl className="pfd-mp-details">
          <dt>Cuenta</dt>
          <dd>
            <Text span fw={600}>
              {c.nickname ?? 'Sin nombre'}
            </Text>
            <Text span c="dimmed" className="num">
              {' '}
              · ID {c.mp_user_id}
              {c.site_id ? ` · ${c.site_id}` : ''}
            </Text>
          </dd>
          <dt>Desde</dt>
          <dd>
            {editingStart ? (
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <DateInput size="xs" valueFormat="DD/MM/YYYY" clearable maxDate={today()} value={start} onChange={setStart} placeholder="Sin fecha" error={bad.includes('history_start')} w={150} />
                <Button
                  size="xs"
                  variant="default"
                  loading={busy === 'start'}
                  onClick={async () => {
                    if (await run('start', () => api.put<Connection>('/me/mercadopago', { history_start: start }), 'Fecha guardada')) setEditingStart(false);
                  }}
                >
                  Guardar
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={() => setEditingStart(false)}>
                  Cancelar
                </Button>
              </Group>
            ) : (
              <Group gap={4} wrap="nowrap">
                <span>{c.history_start ? date(c.history_start, 'D MMM YYYY') : 'Sin fecha'}</span>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label="Cambiar fecha"
                  onClick={() => {
                    setStart(c.history_start);
                    setEditingStart(true);
                  }}
                >
                  <IconPencil size={14} />
                </ActionIcon>
              </Group>
            )}
          </dd>
          <dt>En Cuentas</dt>
          <dd>{c.account ? c.account.name : <Text span c="dimmed">Sin asignar</Text>}</dd>
          {movements && (
            <>
              <dt>Movimientos</dt>
              <dd>{movements}</dd>
            </>
          )}
          {sync?.balance != null && sync.balance_at && (
            <>
              <dt>Saldo</dt>
              <dd>
                <span className="num">{money(sync.balance, 'ARS')}</span>
                <Text span c="dimmed">
                  {' '}
                  · {when(sync.balance_at)}
                </Text>
                {sync.live && sync.app_balance != null && sync.app_balance !== sync.balance && (
                  <Text size="xs" c="dimmed">
                    En la app: <span className="num">{money(sync.app_balance, 'ARS')}</span>
                  </Text>
                )}
              </dd>
            </>
          )}
          <dt>Conectada</dt>
          <dd>{date(c.connected_at.slice(0, 10), 'D MMM YYYY')}</dd>
          <dt>Datos</dt>
          <dd>
            {c.checked_at ? (
              <UnstyledButton onClick={() => setShowSources((o) => !o)} aria-expanded={showSources}>
                <Group gap={4} wrap="nowrap">
                  {showSources ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  <span>
                    {available} de {checks.length} disponibles · {dayjs(c.checked_at).format('D MMM HH:mm')}
                  </span>
                </Group>
              </UnstyledButton>
            ) : (
              <Text span c="dimmed">
                Sin probar
              </Text>
            )}
          </dd>
        </dl>
        <Collapse in={showSources && !!c.checked_at}>
          <Stack gap={4} className="pfd-mp-sources">
            {checks.map((x) => (
              <Group key={x.key} justify="space-between" wrap="nowrap">
                <Text size="sm">{SOURCES[x.key]}</Text>
                <span className="pfd-tag" data-tone={STATUS[x.status].tone}>
                  {STATUS[x.status].label}
                </span>
              </Group>
            ))}
          </Stack>
        </Collapse>

        {(replacing || !c.readable) && (
          <Stack gap="xs">
            {tokenField}
            {help}
            <Group>
              <Button loading={busy === 'connect'} onClick={connect}>
                Guardar token
              </Button>
              {c.readable && (
                <Button
                  variant="subtle"
                  color="gray"
                  onClick={() => {
                    setToken('');
                    setReplacing(false);
                  }}
                >
                  Cancelar
                </Button>
              )}
            </Group>
          </Stack>
        )}

        {!replacing && c.readable && (
          <Group>
            <Button variant="default" loading={busy === 'check'} disabled={!!busy && busy !== 'check'} onClick={() => run('check', () => api.post<Connection>('/me/mercadopago/check'), 'Conexión probada')}>
              Probar conexión
            </Button>
            {unconfigured && (
              <Button variant="default" loading={busy === 'reports'} disabled={!!busy && busy !== 'reports'} onClick={setupReports}>
                Configurar reportes
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Once connected, the connection fills one account in Cuentas. With no Mercado Pago account there
 * yet, one is created; when there are some, this asks which one it is and can't be dismissed.
 * Mounted once in the layout, so it shows on whatever page you're on.
 */
export function MercadoPagoAccountPrompt() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<Connection>('/me/mercadopago'), staleTime: 60_000 });
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = q.data;
  const missing = !!c?.connected && c.readable && !c.account;

  useEffect(() => {
    // Nothing to choose from: make the account right away.
    if (!missing || !c?.connected || c.candidates.length || busy) return;
    setBusy(true);
    api
      .post<Connection & { linked: { name: string; created: boolean } }>('/me/mercadopago/account', {})
      .then((r) => {
        qc.setQueryData(KEY, r);
        qc.invalidateQueries({ queryKey: ['accounts'] });
        if (r.linked.created) notifyOk(`Se creó la cuenta «${r.linked.name}» en Cuentas`);
      })
      .catch(notifyError)
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  if (!missing || !c?.connected || !c.candidates.length) return null;
  const save = async () => {
    if (!choice) return;
    setBusy(true);
    try {
      const r = await api.post<Connection>('/me/mercadopago/account', { account_id: Number(choice) });
      qc.setQueryData(KEY, r);
      notifyOk('Cuenta de Mercado Pago asignada');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={() => {}} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} centered title={<Text fw={700}>¿Cuál es tu cuenta de Mercado Pago?</Text>}>
      <Stack gap="sm">
        <Text size="sm">Tu conexión con Mercado Pago va a cargar los movimientos en una de estas cuentas. Cada persona tiene una sola.</Text>
        <Radio.Group value={choice} onChange={setChoice}>
          <Stack gap="xs">
            {c.candidates.map((a) => (
              <Radio key={a.id} value={String(a.id)} label={a.name} />
            ))}
          </Stack>
        </Radio.Group>
        <Group justify="flex-end">
          <Button onClick={save} loading={busy} disabled={!choice}>
            Asignar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
