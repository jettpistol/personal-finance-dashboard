import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Collapse, Group, Menu, PasswordInput, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconChevronDown, IconChevronRight, IconDots, IconPencil } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { date, today } from '../lib/format';
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
  const [start, setStart] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [bad, setBad] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const c = q.data;
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
      <Card maw={560}>
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

  return (
    <Card maw={560}>
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
