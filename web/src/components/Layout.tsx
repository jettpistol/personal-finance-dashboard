import type { ReactNode } from 'react';
import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Button,
  Group,
  Indicator,
  Menu,
  NavLink,
  Popover,
  ScrollArea,
  Select,
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
  return (
    <BarTabs value={scope} onChange={(v) => setScope(v as Scope)} data={data} label="Tablero" />
  );
}

/** Divided, pressed-in tabs for the dark top bar. */
function BarTabs({ value, onChange, data, label, compact }: { value: string; onChange: (v: string) => void; data: { value: string; label: string }[]; label: string; compact?: boolean }) {
  return (
    <div className="pfd-bar-tabs" role="tablist" aria-label={label} data-compact={compact || undefined}>
      {data.map((d) => (
        <UnstyledButton key={d.value} role="tab" aria-selected={d.value === value} className="pfd-bar-tab" data-active={d.value === value || undefined} onClick={() => onChange(d.value)}>
          {d.label}
        </UnstyledButton>
      ))}
    </div>
  );
}

export function CurrencyToggle() {
  const { currency, setCurrency } = useApp();
  return (
    <Tooltip label="Convertir montos al dólar BNA del día de cada movimiento" withArrow>
      <div style={{ height: '100%', display: 'flex' }}>
        <BarTabs compact value={currency} onChange={(v) => setCurrency(v as 'ARS' | 'USD')} data={[{ value: 'ARS', label: 'ARS' }, { value: 'USD', label: 'USD' }]} label="Moneda" />
      </div>
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
          <ActionIcon variant="transparent" size="lg" aria-label="Notificaciones" className="pfd-bar-icon">
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
    <AppShell layout="alt" header={{ height: 52 }} navbar={{ width: 224, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="lg">
      <AppShell.Header className="pfd-topbar">
        <Group h="100%" pl={isMobile ? 'md' : 0} pr="md" justify="space-between" wrap="nowrap" align="stretch">
          <Group gap="sm" wrap="nowrap" align="center">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="white" aria-label="Abrir menú" />
            {isMobile && (
              <Text fw={800} size="lg" component={Link} to="/" c="white" style={{ textDecoration: 'none' }}>
                Finanzas
              </Text>
            )}
            {scoped && !isMobile && <ScopeSelector />}
          </Group>
          <Group gap="xs" wrap="nowrap" align="center">
            <CurrencyToggle />
            <NotificationsBell />
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <UnstyledButton aria-label="Menú de usuario" px={4}>
                  <Group gap={8} wrap="nowrap">
                    <Avatar color={me.color} variant="filled" size={28}>
                      {me.display_name.slice(0, 1).toUpperCase()}
                    </Avatar>
                    {!isMobile && (
                      <Text size="sm" fw={600} c="#e6edf6">
                        {me.display_name}
                      </Text>
                    )}
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
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

      <AppShell.Navbar className="pfd-rail">
        <AppShell.Section px="md" pt="md" pb="sm">
          <Group justify="space-between" wrap="nowrap">
            <Text component={Link} to="/" className="pfd-brand">
              Finanzas
            </Text>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="white" aria-label="Cerrar menú" />
          </Group>
          <Button
            fullWidth
            mt="md"
            variant="white"
            color="navy"
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              close();
              openTx();
            }}
          >
            Nuevo movimiento
          </Button>
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea} pb="md">
          {NAV.map((item, i) =>
            'section' in item ? (
              item.section ? (
                <div key={i} className="nav-section-label">
                  {item.section}
                </div>
              ) : (
                <div key={i} style={{ height: 10 }} />
              )
            ) : (
              <NavLink
                key={item.to}
                component={Link}
                to={item.to}
                label={item.label}
                leftSection={<item.icon size={17} stroke={1.6} />}
                active={location.pathname === item.to}
                onClick={close}
              />
            ),
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        {scoped && isMobile && (
          <div className="pfd-topbar" style={{ height: 40, display: 'flex', margin: 'calc(var(--app-shell-padding) * -1) calc(var(--app-shell-padding) * -1) var(--app-shell-padding)' }}>
            <ScopeSelector />
          </div>
        )}
        {children}
        <AppFooter />
      </AppShell.Main>
      {txModal && <TxFormModal />}
    </AppShell>
  );
}

/** Simple page title row with optional actions on the right. */
export function PageHeader({ title, description, actions, badge }: { title: string; description?: ReactNode; actions?: ReactNode; badge?: string }) {
  return (
    <nav className="pfd-crumbs" aria-label="Ubicación">
      <div className="pfd-crumbs-path">
        <Link to="/" className="pfd-crumbs-home" aria-label="Inicio">
          <IconHome size={16} stroke={1.8} />
        </Link>
        <div className="pfd-crumbs-title">
          <Group gap="xs" wrap="nowrap">
            <Text component="h1" fz={19} fw={700} m={0} lh={1.25}>
              {title}
            </Text>
            {badge && <span className="pfd-tag">{badge}</span>}
          </Group>
          {description && (
            <Text c="var(--pfd-ink-2)" size="xs" mt={1}>
              {description}
            </Text>
          )}
        </div>
      </div>
      {actions && <div className="pfd-crumbs-actions">{actions}</div>}
    </nav>
  );
}

/** Slim footer strip: where the numbers come from and quick links. */
function AppFooter() {
  return (
    <footer className="pfd-footer">
      <span>Finanzas · uso privado del hogar</span>
      <span>Dólar: BNA · Inflación: IPC INDEC</span>
      <Link to="/ajustes">Ajustes</Link>
      <Link to="/importar">Importar</Link>
      <Link to="/cierre">Cierre de mes</Link>
    </footer>
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
