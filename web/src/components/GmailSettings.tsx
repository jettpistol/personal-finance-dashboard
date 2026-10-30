import { useEffect, useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, CopyButton, Group, Menu, Stack, Text, Title, Tooltip } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconCheck, IconCopy, IconDots, IconPencil, IconRefresh } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { date, today } from '../lib/format';
import { errorFields, notifyError, notifyOk } from '../lib/queries';

type Connection = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connected_at: string | null;
  error: string | null;
  redirect_uri: string;
  default_since: string;
  sync: { on: boolean; since: string | null; last_fetch_at: string | null; error: string | null };
};

export const GMAIL_KEY = ['gmail'];
const RESULT: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: 'Gmail conectado' },
  denied: { ok: false, text: 'No se dio permiso en Google, así que Gmail no quedó conectado.' },
  error: { ok: false, text: 'No se pudo conectar Gmail. Probá de nuevo.' },
};

/**
 * Ajustes → Gmail: each person connects their own Gmail (read-only) so the app can bring the
 * statements that banks send by email. Google's consent page opens in this tab and comes back here
 * with ?gmail=ok|denied|error. Nothing secret ever reaches the browser.
 */
export function GmailSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: GMAIL_KEY, queryFn: () => api.get<Connection>('/me/gmail') });
  const [params, setParams] = useSearchParams();
  const [since, setSince] = useState<string | null>(null);
  const [editingSince, setEditingSince] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [bad, setBad] = useState<string[]>([]);

  // Back from Google: say how it went once, then clean the address.
  useEffect(() => {
    const r = params.get('gmail');
    if (!r) return;
    const res = RESULT[r] ?? RESULT.error;
    if (res.ok) notifyOk(res.text);
    else notifyError(new Error(res.text));
    setParams({ tab: 'gmail' }, { replace: true });
  }, [params, setParams]);

  const c = q.data;
  if (!c) return null;

  const run = async (key: string, fn: () => Promise<Connection>, ok?: string) => {
    setBusy(key);
    setBad([]);
    try {
      qc.setQueryData(GMAIL_KEY, await fn());
      qc.invalidateQueries({ queryKey: ['mail-statements'] });
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
    setBusy('connect');
    try {
      const { url } = await api.post<{ url: string }>('/me/gmail/connect');
      window.location.assign(url);
    } catch (e) {
      notifyError(e);
      setBusy(null);
    }
  };

  const disconnect = () =>
    modals.openConfirmModal({
      title: 'Desconectar Gmail',
      centered: true,
      children: <Text size="sm">Se borra el permiso guardado y se le pide a Google que lo anule. Los resúmenes ya recibidos quedan en Resúmenes.</Text>,
      labels: { confirm: 'Desconectar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => run('disconnect', () => api.del<Connection>('/me/gmail'), 'Gmail desconectado'),
    });

  const saveSince = async () => {
    const value = since ?? c.sync.since ?? c.default_since;
    if (await run('sync', () => api.put<Connection>('/me/gmail/sync', { since: value }), c.sync.on ? 'Fecha guardada' : 'Búsqueda activada')) setEditingSince(false);
  };
  const stop = () => run('stop', () => api.del<Connection>('/me/gmail/sync'), 'Búsqueda desactivada');
  const fetchNow = async () => {
    setBusy('fetch');
    try {
      const r = await api.post<Connection & { found: { recognised: number } }>('/me/gmail/fetch');
      const { found, ...view } = r;
      qc.setQueryData(GMAIL_KEY, view);
      qc.invalidateQueries({ queryKey: ['mail-statements'] });
      notifyOk(found.recognised ? `${found.recognised} resumen${found.recognised === 1 ? '' : 'es'} nuevo${found.recognised === 1 ? '' : 's'}` : 'No hay resúmenes nuevos');
    } catch (e) {
      qc.invalidateQueries({ queryKey: GMAIL_KEY });
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const help = (
    <Anchor component={Link} to="/ayuda/resumenes-por-correo" size="sm">
      Cómo se configura
    </Anchor>
  );
  const when = (iso: string) => dayjs(iso).format(dayjs(iso).isSame(dayjs(), 'day') ? '[hoy] HH:mm' : 'D MMM HH:mm');

  if (!c.configured) {
    return (
      <Card maw={560} mx="auto">
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Gmail</Title>
            <Badge color="gray">Sin configurar</Badge>
          </Group>
          <Text size="sm">Quien administra la app crea una vez el acceso de Google y lo carga en el servidor. Esta es la dirección de retorno que pide Google:</Text>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
              {c.redirect_uri}
            </Text>
            <CopyButton value={c.redirect_uri}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copiada' : 'Copiar'}>
                  <ActionIcon variant="subtle" color="gray" onClick={copy} aria-label="Copiar dirección">
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          {help}
        </Stack>
      </Card>
    );
  }

  if (!c.connected) {
    return (
      <Card maw={560} mx="auto">
        <Stack>
          <Group justify="space-between">
            <Title order={4}>Gmail</Title>
            <Badge color="gray">Sin conectar</Badge>
          </Group>
          <Text size="sm">Trae los resúmenes que los bancos mandan por correo (hoy, Naranja X). Solo lectura: la app no envía ni borra correos.</Text>
          {help}
          <Group>
            <Button loading={busy === 'connect'} onClick={connect}>
              Conectar Gmail
            </Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  const sinceField = (
    <DateInput
      size="xs"
      valueFormat="DD/MM/YYYY"
      maxDate={today()}
      value={since ?? c.sync.since ?? c.default_since}
      onChange={setSince}
      error={bad.includes('since')}
      w={150}
      aria-label="Buscar desde"
    />
  );

  return (
    <Card maw={560} mx="auto">
      <Stack>
        <Group justify="space-between" wrap="nowrap">
          <Title order={4}>Gmail</Title>
          <Group gap="xs" wrap="nowrap">
            {c.error ? <Badge color="yellow">Volvé a conectar</Badge> : <Badge color="teal">Conectado</Badge>}
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Más opciones">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={connect}>Conectar de nuevo</Menu.Item>
                {c.sync.on && <Menu.Item onClick={stop}>Dejar de buscar en este perfil</Menu.Item>}
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
              {c.email ?? 'Gmail'}
            </Text>
          </dd>
          <dt>Desde</dt>
          <dd>
            {!c.sync.on || editingSince ? (
              <Group gap="xs" wrap="nowrap" align="flex-start">
                {sinceField}
                <Button size="xs" loading={busy === 'sync'} onClick={saveSince}>
                  {c.sync.on ? 'Guardar' : 'Buscar resúmenes'}
                </Button>
                {editingSince && (
                  <Button size="xs" variant="default" onClick={() => setEditingSince(false)}>
                    Cancelar
                  </Button>
                )}
              </Group>
            ) : (
              <Group gap={4} wrap="nowrap">
                <span>{date(c.sync.since!, 'DD/MM/YYYY')}</span>
                <Tooltip label="Cambiar fecha">
                  <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Cambiar fecha" onClick={() => setEditingSince(true)}>
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
          </dd>
          {c.sync.on && (
            <>
              <dt>Resúmenes</dt>
              <dd>
                <Group gap="xs" wrap="nowrap">
                  <span>{c.sync.last_fetch_at ? `Revisado ${when(c.sync.last_fetch_at)}` : 'Sin revisar todavía'}</span>
                  <Tooltip label="Buscar ahora">
                    <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Buscar resúmenes ahora" loading={busy === 'fetch'} onClick={fetchNow}>
                      <IconRefresh size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Anchor component={Link} to="/resumenes" size="sm">
                    Ver en Resúmenes
                  </Anchor>
                </Group>
                {(c.sync.error || c.error) && (
                  <Text size="xs" c="red">
                    {c.error ?? c.sync.error}
                  </Text>
                )}
              </dd>
            </>
          )}
        </dl>
      </Stack>
    </Card>
  );
}
