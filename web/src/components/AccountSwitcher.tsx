import { useEffect, useState } from 'react';
import { Alert, Avatar, Button, Menu, Modal, PasswordInput, Stack, TextInput } from '@mantine/core';
import { IconLock, IconLogout2, IconUserPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app-state';
import { logoutAccount, refreshAsNewUser, switchAccount, useLoggedAccounts } from '../lib/accounts';
import { notifyOk } from '../lib/queries';

/** User-menu section: the other accounts logged in on this browser (one click switches) and "Agregar cuenta". */
export function AccountMenuSection({ onAdd }: { onAdd: () => void }) {
  const qc = useQueryClient();
  const { me, users } = useApp();
  const q = useLoggedAccounts();
  const others = (q.data ?? []).filter((a) => a.id !== me.id);
  // Nobody else to log in as (single-user install), or everyone already is.
  const canAdd = users.some((u) => u.id !== me.id && !others.some((a) => a.id === u.id));
  if (!others.length && !canAdd) return null;
  return (
    <>
      <Menu.Label>Cuentas</Menu.Label>
      {others.map((a) => (
        <Menu.Item
          key={a.id}
          leftSection={
            <Avatar color={a.color} variant="filled" size={20}>
              {a.display_name.slice(0, 1).toUpperCase()}
            </Avatar>
          }
          onClick={() => switchAccount(qc, a)}
        >
          {a.display_name}
        </Menu.Item>
      ))}
      {canAdd && (
        <Menu.Item leftSection={<IconUserPlus size={16} />} onClick={onAdd}>
          Agregar cuenta
        </Menu.Item>
      )}
      <Menu.Divider />
    </>
  );
}

/** Shown under "Cerrar sesión" when more than one account is logged in on this browser. */
export function LogoutAllItem() {
  const qc = useQueryClient();
  const q = useLoggedAccounts();
  if ((q.data?.length ?? 0) < 2) return null;
  return (
    <Menu.Item color="red" leftSection={<IconLogout2 size={16} />} onClick={() => logoutAccount(qc, true)}>
      Cerrar todas las sesiones
    </Menu.Item>
  );
}

/** Logs another user in on this browser and switches to them, keeping the current session open. */
export function AddAccountModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const close = () => {
    setUsername('');
    setPassword('');
    setError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ accounts: { display_name: string; active: boolean }[] }>('/auth/accounts', { username, password, switch: true });
      close();
      await refreshAsNewUser(qc);
      const now = r.accounts.find((a) => a.active);
      if (now) notifyOk(`Ahora estás como ${now.display_name}`);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && err.status === 429) setWait((err.data as { retryAfter?: number })?.retryAfter ?? 30);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} title="Agregar cuenta" size="sm">
      <form onSubmit={submit}>
        <Stack>
          {error && (
            <Alert color="red" icon={<IconLock size={16} />}>
              {wait > 0 ? error.replace(/\d+ segundos/, `${wait} segundos`) : error}
            </Alert>
          )}
          <TextInput label="Usuario" value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoComplete="off" required data-autofocus />
          <PasswordInput label="Contraseña" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="off" required />
          <Button type="submit" loading={loading} disabled={wait > 0} fullWidth>
            {wait > 0 ? `Esperá ${wait} s` : 'Ingresar'}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
