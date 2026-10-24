import type { ReactNode } from 'react';
import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Burger,
  Button,
  Group,
  Indicator,
  Menu,
  NavLink,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  IconArrowsExchange,
  IconBell,
  IconBuildingBank,
  IconCalendarCheck,
  IconChartPie,
  IconFileImport,
  IconHome,
  IconListDetails,
  IconLogout,
  IconMoon,
  IconPigMoney,
  IconPlus,
  IconRepeat,
  IconSettings,
  IconSun,
  IconTarget,
  IconWand,
} from '@tabler/icons-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import type { Notification, Scope } from '../lib/types';
import { TxFormModal } from './TxFormModal';
import { date } from '../lib/format';

const NAV = [
  { section: 'General' },
  { to: '/', label: 'Inicio', icon: IconHome },
  { to: '/movimientos', label: 'Movimientos', icon: IconListDetails },
  { to: '/cuentas', label: 'Cuentas', icon: IconBuildingBank },
  { to: '/saldos', label: 'Gastos compartidos', icon: IconArrowsExchange },
  { section: 'Planificación' },
  { to: '/presupuestos', label: 'Presupuestos', icon: IconPigMoney },
  { to: '/metas', label: 'Metas de ahorro', icon: IconTarget },
  { to: '/reportes', label: 'Reportes', icon: IconChartPie },
  { to: '/cierre', label: 'Cierre de mes', icon: IconCalendarCheck },
  { section: 'Automatización' },
  { to: '/importar', label: 'Importar', icon: IconFileImport },
  { to: '/reglas', label: 'Reglas', icon: IconWand },
  { to: '/recurrentes', label: 'Recurrentes', icon: IconRepeat },
  { section: '' },
  { to: '/ajustes', label: 'Ajustes', icon: IconSettings },
] as const;

/** Pages whose content depends on the selected scope (Hogar / personal). */
const SCOPED = ['/', '/movimientos', '/presupuestos', '/metas', '/reportes', '/cierre'];

export function ScopeSelector() {
  const { scope, setScope, users, me } = useApp();
  const data = [
    { value: 'household', label: 'Hogar' },
    { value: `user:${me.id}`, label: 'Mío' },
    ...users.filter((u) => u.id !== me.id && u.share_dashboard).map((u) => ({ value: `user:${u.id}`, label: u.display_name })),
  ];
  return <SegmentedControl size="xs" value={scope} onChange={(v) => setScope(v as Scope)} data={data} />;
}

export function CurrencyToggle() {
  const { currency, setCurrency } = useApp();
  return (
    <Tooltip label="Convertir montos al dólar BNA del día de cada movimiento" withArrow>
      <SegmentedControl size="xs" value={currency} onChange={(v) => setCurrency(v as 'ARS' | 'USD')} data={[{ value: 'ARS', label: 'ARS' }, { value: 'USD', label: 'USD' }]} />
    </Tooltip>
  );
}

function NotificationsBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/notifications'), refetchInterval: 60_000 });
  const unread = q.data?.filter((n) => !n.read).length ?? 0;
  return (
    <Popover
      width={340}
      position="bottom-end"
      shadow="md"
      onClose={async () => {
        if (unread) {
          await api.post('/notifications/read');
          qc.invalidateQueries({ queryKey: ['notifications'] });
        }
      }}
    >
      <Popover.Target>
        <Indicator disabled={!unread} label={unread} size={16} offset={4}>
          <ActionIcon variant="subtle" size="lg" aria-label="Notificaciones">
            <IconBell size={20} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <ScrollArea.Autosize mah={420}>
          {!q.data?.length && (
            <Text p="md" c="dimmed" size="sm">
              Sin notificaciones.
            </Text>
          )}
          {q.data?.map((n) => (
            <UnstyledButton key={n.id} p="sm" w="100%" className="clickable-row" onClick={() => n.link && navigate(n.link)} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Text size="sm" fw={n.read ? 400 : 700}>
                  {n.title}
                </Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {date(n.created_at.slice(0, 10), 'D MMM')}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {n.body}
              </Text>
            </UnstyledButton>
          ))}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const { me, openTx, txModal } = useApp();
  const location = useLocation();
  const qc = useQueryClient();
  const isMobile = useMediaQuery('(max-width: 48em)');
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const scoped = SCOPED.includes(location.pathname);

  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    qc.invalidateQueries({ queryKey: ['auth'] });
  };

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={800} size="lg" component={Link} to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
              Finanzas
            </Text>
            {scoped && !isMobile && <ScopeSelector />}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <CurrencyToggle />
            {!isMobile && (
              <Button leftSection={<IconPlus size={16} />} size="xs" onClick={() => openTx()}>
                Movimiento
              </Button>
            )}
            <NotificationsBell />
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <ActionIcon variant="transparent" size="lg" aria-label="Menú de usuario">
                  <Avatar color={me.color} radius="xl" size={32}>
                    {me.display_name.slice(0, 1).toUpperCase()}
                  </Avatar>
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me.display_name}</Menu.Label>
                <Menu.Item
                  leftSection={colorScheme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
                  onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
                >
                  {colorScheme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                </Menu.Item>
                <Menu.Item component={Link} to="/ajustes" leftSection={<IconSettings size={16} />}>
                  Ajustes
                </Menu.Item>
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={logout}>
                  Cerrar sesión
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          <Stack gap={2}>
            {NAV.map((item, i) =>
              'section' in item ? (
                item.section ? (
                  <div key={i} className="nav-section-label">
                    {item.section}
                  </div>
                ) : (
                  <div key={i} style={{ height: 8 }} />
                )
              ) : (
                <NavLink
                  key={item.to}
                  component={Link}
                  to={item.to}
                  label={item.label}
                  leftSection={<item.icon size={18} stroke={1.6} />}
                  active={location.pathname === item.to}
                  onClick={close}
                  style={{ borderRadius: 8 }}
                />
              ),
            )}
          </Stack>
        </AppShell.Section>
        {isMobile && (
          <AppShell.Section>
            <Button fullWidth leftSection={<IconPlus size={16} />} onClick={() => { close(); openTx(); }}>
              Nuevo movimiento
            </Button>
          </AppShell.Section>
        )}
      </AppShell.Navbar>

      <AppShell.Main>
        {scoped && isMobile && (
          <Group mb="sm">
            <ScopeSelector />
          </Group>
        )}
        {children}
      </AppShell.Main>
      {txModal && <TxFormModal />}
    </AppShell>
  );
}

/** Simple page title row with optional actions on the right. */
export function PageHeader({ title, description, actions, badge }: { title: string; description?: ReactNode; actions?: ReactNode; badge?: string }) {
  return (
    <Group justify="space-between" mb="lg" align="flex-end" wrap="wrap" gap="sm">
      <div>
        <Group gap="xs">
          <Text component="h1" fz={26} fw={800} m={0}>
            {title}
          </Text>
          {badge && <Badge variant="light">{badge}</Badge>}
        </Group>
        {description && (
          <Text c="dimmed" size="sm">
            {description}
          </Text>
        )}
      </div>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}

/** Month selector used across pages (previous / next / pick). */
export function MonthSelect({ value, onChange, months = 24 }: { value: string; onChange: (m: string) => void; months?: number }) {
  const now = new Date();
  const data: { value: string; label: string }[] = [];
  for (let i = -3; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    data.push({ value: v, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return <Select size="xs" w={170} data={data} value={value} onChange={(v) => v && onChange(v)} allowDeselect={false} aria-label="Mes" />;
}
