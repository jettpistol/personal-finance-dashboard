import { useEffect, useState } from 'react';
import { Anchor, Badge, Button, Card, Collapse, Group, NumberInput, PasswordInput, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { errorFields, notifyError, notifyOk } from '../lib/queries';

type MailSettings = {
  configured: boolean;
  source: 'app' | 'server' | null;
  host: string;
  port: number;
  user: string;
  from: string;
  has_password: boolean;
};

const GMAIL_HOST = 'smtp.gmail.com';
const GMAIL_PORT = 465;

/** The shared account (usually a Gmail with an app password) that sends everyone's notices. */
export function MailSetupCard({ myEmail }: { myEmail: string | null | undefined }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mail-settings'], queryFn: () => api.get<MailSettings>('/mail/settings') });
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [host, setHost] = useState(GMAIL_HOST);
  const [port, setPort] = useState<number | string>(GMAIL_PORT);
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ fields: string[]; message: string } | null>(null);

  const s = q.data;
  const fromApp = s?.source === 'app';

  // Load what's in use; the server's account only fills the address (its password isn't ours to keep).
  useEffect(() => {
    if (!s) return;
    setUser(s.user);
    setPass('');
    setHost(s.host || GMAIL_HOST);
    setPort(s.port || GMAIL_PORT);
    setOther((s.host || GMAIL_HOST) !== GMAIL_HOST || (s.port || GMAIL_PORT) !== GMAIL_PORT);
  }, [s]);

  const dirty = !!s && (!fromApp || user.trim() !== s.user || pass !== '' || host.trim() !== s.host || Number(port) !== s.port);

  const fail = (e: unknown) => {
    const fields = errorFields(e);
    setError({ fields, message: e instanceof Error ? e.message : String(e) });
    if (fields.includes('host') || fields.includes('port')) setOther(true);
    if (!fields.length) notifyError(e);
  };

  const errorFor = (field: string) => (error?.fields.includes(field) ? error.message : undefined);
  const clear = (field: string) => error?.fields.includes(field) && setError(null);

  const save = async () => {
    await api.put('/mail/settings', {
      user: user.trim(),
      ...(pass.trim() ? { pass } : {}),
      host: host.trim() || GMAIL_HOST,
      port: Number(port) || GMAIL_PORT,
      ...(fromApp ? { from: s?.from ?? '' } : {}),
    });
    setPass('');
    await Promise.all([qc.invalidateQueries({ queryKey: ['mail-settings'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const onSave = () =>
    run('save', async () => {
      await save();
      notifyOk('Cuenta guardada');
    });

  const onTest = () =>
    run('test', async () => {
      if (dirty) await save();
      const r = await api.post<{ to: string }>('/mail/settings/test', {});
      notifyOk(`Listo: te mandamos un correo de prueba a ${r.to}`);
    });

  const onForget = () =>
    run('forget', async () => {
      await api.del('/mail/settings');
      await Promise.all([qc.invalidateQueries({ queryKey: ['mail-settings'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
      notifyOk('Cuenta quitada');
    });

  if (!s) return null;

  return (
    <Card>
      <Stack>
        <Group justify="space-between">
          <Title order={4}>Cuenta que envía los avisos</Title>
          {s.configured ? <Badge color="teal">Configurado</Badge> : <Badge color="yellow">No configurado</Badge>}
        </Group>
        <Text size="sm" c="dimmed">
          {s.source === 'server'
            ? 'Hoy usa la configuración del servidor. Podés reemplazarla acá.'
            : 'Una sola cuenta de Gmail manda los avisos de los dos. Se usa una contraseña de aplicación, no la normal.'}
        </Text>
        <TextInput
          label="Correo de Gmail"
          placeholder="nombre@gmail.com"
          type="email"
          autoComplete="off"
          value={user}
          onChange={(e) => {
            clear('user');
            setUser(e.currentTarget.value);
          }}
          error={errorFor('user')}
        />
        <PasswordInput
          label="Contraseña de aplicación"
          placeholder={fromApp && s.has_password ? '•••• guardada' : 'abcd efgh ijkl mnop'}
          description={fromApp && s.has_password ? 'Dejala vacía para no cambiarla' : undefined}
          autoComplete="new-password"
          value={pass}
          onChange={(e) => {
            clear('pass');
            setPass(e.currentTarget.value);
          }}
          error={errorFor('pass')}
        />
        <Anchor component={Link} to="/ayuda/configurar-correo" size="sm">
          Cómo crear la contraseña de aplicación
        </Anchor>
        <UnstyledButton onClick={() => setOther((o) => !o)} aria-expanded={other}>
          <Group gap={4}>
            {other ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <Text size="sm" c="dimmed">
              Otro proveedor
            </Text>
          </Group>
        </UnstyledButton>
        <Collapse in={other}>
          <Group align="flex-start" grow>
            <TextInput
              label="Servidor"
              placeholder={GMAIL_HOST}
              value={host}
              onChange={(e) => {
                clear('host');
                setHost(e.currentTarget.value);
              }}
              error={errorFor('host')}
            />
            <NumberInput
              label="Puerto"
              placeholder={String(GMAIL_PORT)}
              min={1}
              max={65535}
              allowDecimal={false}
              value={port}
              onChange={(v) => {
                clear('port');
                setPort(v);
              }}
              error={errorFor('port')}
              maw={120}
            />
          </Group>
        </Collapse>
        {error && !['user', 'pass', 'host', 'port'].some((f) => error.fields.includes(f)) && error.fields.length > 0 && (
          <Text size="sm" c="red">
            {error.message}
          </Text>
        )}
        <Group>
          <Button loading={busy === 'save'} disabled={!!busy && busy !== 'save'} onClick={onSave}>
            Guardar
          </Button>
          <Button variant="default" loading={busy === 'test'} disabled={(!s.configured && !dirty) || (!!busy && busy !== 'test')} onClick={onTest}>
            Probar
          </Button>
          {fromApp && (
            <Button variant="subtle" color="gray" loading={busy === 'forget'} disabled={!!busy && busy !== 'forget'} onClick={onForget}>
              Quitar
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {myEmail ? `La prueba llega a ${myEmail}.` : 'La prueba llega a tu correo (guardalo en la tarjeta Correo).'}
        </Text>
      </Stack>
    </Card>
  );
}
