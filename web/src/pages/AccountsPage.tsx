import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDots, IconEdit, IconListDetails, IconLock, IconPlus, IconTrash } from '@tabler/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { MoneyInput } from '../components/inputs';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app-state';
import { ACCOUNT_TYPE_LABEL, MANTINE_COLORS, fromCents, money, toCents } from '../lib/format';
import { notifyError, notifyOk, useAccounts, useRefreshData } from '../lib/queries';
import type { Account, AccountType, Currency } from '../lib/types';

type Form = {
  name: string;
  type: AccountType;
  currency: Currency;
  owner: 'joint' | 'me';
  is_private: boolean;
  opening_balance: number | string;
  color: string | null;
  archived: boolean;
};

const emptyForm: Form = { name: '', type: 'bank', currency: 'ARS', owner: 'me', is_private: false, opening_balance: 0, color: null, archived: false };

function AccountModal({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const refresh = useRefreshData();
  const [form, setForm] = useState<Form>(() =>
    account
      ? {
          name: account.name,
          type: account.type,
          currency: account.currency,
          owner: account.owner_id === null ? 'joint' : 'me',
          is_private: !!account.is_private,
          opening_balance: fromCents(account.opening_balance),
          color: account.color,
          archived: !!account.archived,
        }
      : emptyForm,
  );
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, is_private: form.owner === 'me' && form.is_private, opening_balance: toCents(form.opening_balance) };
      if (account) await api.patch(`/accounts/${account.id}`, body);
      else await api.post('/accounts', body);
      notifyOk(account ? 'Cuenta actualizada' : 'Cuenta creada');
      refresh();
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>{account ? 'Editar cuenta' : 'Nueva cuenta'}</Text>}>
      <Stack gap="sm">
        <TextInput label="Nombre" placeholder="Ej: Banco Nación, Mercado Pago, Visa" value={form.name} onChange={(e) => set('name', e.currentTarget.value)} required data-autofocus />
        <SimpleGrid cols={2}>
          <Select
            label="Tipo"
            value={form.type}
            onChange={(v) => v && set('type', v as AccountType)}
            data={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            allowDeselect={false}
          />
          <Select label="Moneda" value={form.currency} onChange={(v) => v && set('currency', v as Currency)} data={['ARS', 'USD']} allowDeselect={false} />
        </SimpleGrid>
        <Select
          label="Titular"
          value={form.owner}
          onChange={(v) => v && set('owner', v as 'joint' | 'me')}
          data={[
            { value: 'me', label: 'Mía (personal)' },
            { value: 'joint', label: 'Común (de los dos)' },
          ]}
          allowDeselect={false}
        />
        {form.owner === 'me' && (
          <Switch
            label="Cuenta privada"
            description="Tu pareja no verá la cuenta ni sus movimientos (salvo gastos compartidos y pagos de deuda)."
            checked={form.is_private}
            onChange={(e) => set('is_private', e.currentTarget.checked)}
          />
        )}
        <MoneyInput
          label="Saldo inicial"
          description={form.type === 'credit_card' ? 'Para tarjetas, una deuda es un saldo negativo.' : 'Saldo al empezar a registrar movimientos.'}
          currency={form.currency}
          allowNegative
          value={form.opening_balance}
          onChange={(v) => set('opening_balance', v)}
        />
        <Select
          label="Color"
          clearable
          value={form.color}
          onChange={(v) => set('color', v)}
          data={MANTINE_COLORS}
          renderOption={({ option }) => (
            <Group gap="xs">
              <ColorSwatchDot color={option.value} />
              {option.label}
            </Group>
          )}
        />
        {account && <Switch label="Archivada" description="Se oculta de los formularios y del tablero." checked={form.archived} onChange={(e) => set('archived', e.currentTarget.checked)} />}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!form.name.trim()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ColorSwatchDot({ color }: { color: string }) {
  return <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: `var(--mantine-color-${color}-6)` }} />;
}

function AccountCard({ a, onEdit }: { a: Account; onEdit: () => void }) {
  const { currency, openTx } = useApp();
  const navigate = useNavigate();
  const refresh = useRefreshData();
  const converted = currency === 'ARS' ? a.balance_ars : a.balance_usd;
  const isDebt = a.type === 'credit_card' && a.balance < 0;

  const remove = () =>
    modals.openConfirmModal({
      title: 'Eliminar cuenta',
      children: <Text size="sm">¿Eliminar «{a.name}»? Solo se puede si no tiene movimientos.</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/accounts/${a.id}`);
          notifyOk('Cuenta eliminada');
          refresh();
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) notifyError(new Error('La cuenta tiene movimientos. Editala y marcala como archivada en lugar de borrarla.'));
          else notifyError(e);
        }
      },
    });

  return (
    <Card opacity={a.archived ? 0.6 : 1}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <span className="pfd-swatch" style={{ background: `var(--mantine-color-${a.color ?? 'gray'}-6)` }} />
            <Text fw={700} lineClamp={1}>
              {a.name}
            </Text>
            {!!a.is_private && (
              <IconLock size={11} color="var(--pfd-ink-2)" />
            )}
          </Group>
          <Group gap={4} mt={2}>
            <Badge size="xs" variant="light" color="gray">
              {ACCOUNT_TYPE_LABEL[a.type]}
            </Badge>
            <Badge size="xs" variant="outline" color="gray">
              {a.currency}
            </Badge>
            {!!a.archived && (
              <Badge size="xs" color="gray">
                Archivada
              </Badge>
            )}
          </Group>
        </div>
        <Menu position="bottom-end" withArrow>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label="Acciones">
              <IconDots size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconListDetails size={16} />} onClick={() => navigate(`/movimientos?account_id=${a.id}`)}>
              Ver movimientos
            </Menu.Item>
            <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => openTx({ accountId: a.id })}>
              Nuevo movimiento
            </Menu.Item>
            {a.can_edit && (
              <>
                <Menu.Divider />
                <Menu.Item leftSection={<IconEdit size={16} />} onClick={onEdit}>
                  Editar
                </Menu.Item>
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={remove}>
                  Eliminar
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
      <Text mt="md" size="xs" c="dimmed">
        {isDebt ? 'Deuda' : 'Saldo'}
      </Text>
      <Text className="num" fz={22} fw={800} c={isDebt ? 'red' : a.balance < 0 ? 'red' : undefined}>
        {money(isDebt ? -a.balance : a.balance, a.currency)}
      </Text>
      {a.currency !== currency && (
        <Text size="xs" c="dimmed" className="num">
          ≈ {money(converted, currency)}
        </Text>
      )}
      <Group gap="xs" mt="sm">
        <Button size="compact-xs" variant="light" onClick={() => navigate(`/movimientos?account_id=${a.id}`)}>
          Ver movimientos
        </Button>
        <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => openTx({ accountId: a.id })}>
          Movimiento
        </Button>
      </Group>
    </Card>
  );
}

/** URL value for a group: `compartido` for joint accounts, the username for a person. */
const JOINT = 'compartido';

export function AccountsPage() {
  const { users, currency } = useApp();
  const accounts = useAccounts();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Account | null | 'new'>(null);
  const [params, setParams] = useSearchParams();

  const list = (accounts.data ?? []).filter((a) => showArchived || !a.archived);
  const conv = (a: Account) => (currency === 'ARS' ? a.balance_ars : a.balance_usd) ?? 0;
  const allGroups = [
    { key: JOINT, title: 'Compartido', items: list.filter((a) => a.owner_id === null) },
    ...users.map((u) => ({ key: u.username.toLowerCase(), title: u.display_name, items: list.filter((a) => a.owner_id === u.id) })),
  ];
  const requested = params.get('ver');
  const view = allGroups.some((g) => g.key === requested) ? requested : null;
  const groups = view ? allGroups.filter((g) => g.key === view) : allGroups.filter((g) => g.items.length);
  const total = list.filter((a) => !a.archived).reduce((s, a) => s + conv(a), 0);
  const missing = list.some((a) => !a.archived && (currency === 'ARS' ? a.balance_ars : a.balance_usd) == null);

  const select = (key: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (key) next.set('ver', key);
        else next.delete('ver');
        return next;
      },
      { replace: true },
    );

  const entries = [{ key: null as string | null, title: 'Todas', count: list.length }, ...allGroups.map((g) => ({ key: g.key as string | null, title: g.title, count: g.items.length }))];

  return (
    <>
      <PageHeader
        title="Cuentas"
        description="Bancos, efectivo, tarjetas, billeteras virtuales, ahorros e inversiones."
        actions={
          <>
            <Switch size="sm" label="Mostrar archivadas" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              Nueva cuenta
            </Button>
          </>
        }
      />

      <Card mb="lg">
        <Text size="sm" c="var(--pfd-ink-2)" fw={650}>
          Patrimonio visible
        </Text>
        <Text className="num" fz={30} fw={800} c={total < 0 ? 'red' : undefined}>
          {money(total, currency)}
        </Text>
        <Text size="xs" c="dimmed">
          Suma de todas las cuentas que podés ver, convertidas a {currency} con el dólar BNA de hoy.
          {missing && ' Algunas cuentas no se pudieron convertir porque no hay cotización cargada.'}
        </Text>
      </Card>

      <div className="pfd-acct-layout">
        <nav className="pfd-acct-nav" aria-label="Titular">
          {entries.map((e) => (
            <button key={e.key ?? 'all'} type="button" className="pfd-acct-nav-item" data-active={e.key === view || undefined} aria-pressed={e.key === view} onClick={() => select(e.key)}>
              <span className="pfd-acct-nav-label">{e.title}</span>
              <span className="pfd-acct-nav-count num">{e.count}</span>
            </button>
          ))}
        </nav>

        <div style={{ minWidth: 0 }}>
          {accounts.isLoading && <Text c="dimmed">Cargando…</Text>}
          {!accounts.isLoading && !groups.some((g) => g.items.length) && (
            <Card>
              <Text c="dimmed" ta="center">
                {view ? 'No hay cuentas en este grupo.' : 'Todavía no hay cuentas. Creá la primera para empezar a registrar movimientos.'}
              </Text>
            </Card>
          )}

          <Stack gap="xl">
            {groups
              .filter((g) => g.items.length)
              .map((g) => {
                const sub = g.items.filter((a) => !a.archived).reduce((s, a) => s + conv(a), 0);
                return (
                  <section key={g.key}>
                    <Group justify="space-between" mb="xs">
                      <Text component="h2" m={0} fw={700} size="lg">
                        {g.title}
                      </Text>
                      <Text className="num" fw={700} c={sub < 0 ? 'red' : 'dimmed'}>
                        {money(sub, currency)}
                      </Text>
                    </Group>
                    <SimpleGrid type="container" cols={{ base: 1, '520px': 2, '820px': 3, '1120px': 4 }}>
                      {g.items.map((a) => (
                        <AccountCard key={a.id} a={a} onEdit={() => setEditing(a)} />
                      ))}
                    </SimpleGrid>
                  </section>
                );
              })}
          </Stack>
        </div>
      </div>

      {editing && <AccountModal account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
