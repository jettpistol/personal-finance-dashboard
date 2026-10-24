import { useEffect, useState } from 'react';
import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconChartBar, IconLock } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

export function LoginPage({ setup }: { setup: boolean }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== password2) return setError('Las contraseñas no coinciden.');
    setLoading(true);
    try {
      if (setup) await api.post('/auth/setup', { username, display_name: displayName || username, password });
      else await api.post('/auth/login', { username, password });
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && err.status === 429) setWait((err.data as { retryAfter?: number })?.retryAfter ?? 30);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={400}>
        <form onSubmit={submit}>
          <Stack>
            <Stack gap={4} align="center">
              <ThemeIcon size={48} radius="xl">
                <IconChartBar />
              </ThemeIcon>
              <Title order={2}>Finanzas</Title>
              <Text c="dimmed" size="sm" ta="center">
                {setup ? 'Primera configuración: creá tu usuario. Después vas a poder agregar a tu pareja.' : 'Ingresá con tu usuario'}
              </Text>
            </Stack>
            {error && (
              <Alert color="red" icon={<IconLock size={16} />}>
                {wait > 0 ? `${error.replace(/\d+ segundos/, `${wait} segundos`)}` : error}
              </Alert>
            )}
            <TextInput label="Usuario" value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoComplete="username" required autoFocus />
            {setup && <TextInput label="Nombre para mostrar" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} placeholder="Ej: Ana" />}
            <PasswordInput
              label="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              autoComplete={setup ? 'new-password' : 'current-password'}
              description={setup ? 'Mínimo 10 caracteres' : undefined}
              required
            />
            {setup && <PasswordInput label="Repetir contraseña" value={password2} onChange={(e) => setPassword2(e.currentTarget.value)} autoComplete="new-password" required />}
            <Button type="submit" loading={loading} disabled={wait > 0} fullWidth>
              {wait > 0 ? `Esperá ${wait} s` : setup ? 'Crear usuario' : 'Ingresar'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
