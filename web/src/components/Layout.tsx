import { useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  AppShell,
  Avatar,
  Burger,
  Button,
  Group,
  Indicator,
  Menu,
  NavLink,
  NumberInput,
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
  IconCalendar,
  IconDatabase,
  IconChevronDown,
  IconChevronUp,
  IconBuildingBank,
  IconCalendarCheck,
  IconChartPie,
  IconFileImport,
  IconFileText,
  IconHome,
  IconListDetails,
  IconLogout,
  IconMoon,
  IconPigMoney,
  IconPlus,
  IconRepeat,
  IconRefresh,
  IconSettings,
  IconSun,
  IconTarget,
  IconUserDollar,
  IconAlarm,
  IconWand,
  IconHistory,
} from '@tabler/icons-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import type { Notification, Scope } from '../lib/types';
import { TxFormModal } from './TxFormModal';
import { useProfiles, useSelectProfile } from '../lib/profiles';
import { date } from '../lib/format';
import { logoutAccount } from '../lib/accounts';
import { AccountMenuSection, AddAccountModal, LogoutAllItem } from './AccountSwitcher';
import { MercadoPagoAccountPrompt } from './MercadoPagoSettings';

const NAV = [
  { section: 'General' },
  { to: '/', label: 'Inicio', icon: IconHome },
  { to: '/movimientos', label: 'Movimientos', icon: IconListDetails },
  { to: '/cuentas', label: 'Cuentas', icon: IconBuildingBank },
  { to: '/saldos', label: 'Gastos compartidos', icon: IconArrowsExchange },
  { to: '/deudores', label: 'Deudores', icon: IconUserDollar },
  { to: '/pendientes', label: 'Pendientes', icon: IconAlarm },
  { section: 'Planificación' },
  { to: '/presupuestos', label: 'Presupuestos', icon: IconPigMoney },
  { to: '/metas', label: 'Objetivos', icon: IconTarget },
  { to: '/reportes', label: 'Reportes', icon: IconChartPie },
  { to: '/cierre', label: 'Cierre de mes', icon: IconCalendarCheck },
  { section: 'Automatización' },
  { to: '/importar', label: 'Importar', icon: IconFileImport },
  { to: '/resumenes', label: 'Resúmenes', icon: IconFileText },
  { to: '/reglas', label: 'Reglas', icon: IconWand },
  { to: '/recurrentes', label: 'Recurrentes', icon: IconRepeat },
  { section: '' },
  { to: '/perfiles', label: 'Perfil de datos', icon: IconDatabase },
  { to: '/actividad', label: 'Actividad', icon: IconHistory },
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

/** Data profile in use, always visible; the menu switches profile. */
function ProfileSwitcher() {
  const q = useProfiles();
  const select = useSelectProfile();
  const current = q.data?.profiles.find((p) => p.id === q.data?.current);
  if (!q.data?.profiles.length) return null;
  return (
    <Menu position="bottom-end" withArrow>
      <Menu.Target>
        <UnstyledButton className="pfd-bar-tab pfd-bar-tab-solo" aria-label="Perfil de datos">
          <IconDatabase size={15} style={{ marginRight: 6 }} />
          {current?.name ?? 'Perfil'}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Perfil de datos</Menu.Label>
        {q.data.profiles.map((p) => (
          <Menu.Item key={p.id} onClick={() => p.id !== current?.id && select(p.id, p.name)} fw={p.id === current?.id ? 700 : 400}>
            {p.name}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item component={Link} to="/perfiles">
          Administrar perfiles
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
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

// How wide each page's content may grow, so sparse screens stay together in the middle instead
// of spreading their few items across a wide monitor. Data-heavy pages get the widest column.
const PAGE_WIDTH: Record<string, 'narrow' | 'medium' | 'wide'> = {
  '/pendientes': 'narrow',
  '/perfiles': 'narrow',
  '/ajustes': 'medium',
  '/saldos': 'medium',
  '/deudores': 'medium',
  '/metas': 'medium',
  '/recurrentes': 'medium',
  '/reglas': 'medium',
  '/actividad': 'medium',
  '/importar': 'medium',
  '/resumenes': 'medium',
};

export function Layout({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const { me, openTx, txModal } = useApp();
  const location = useLocation();
  // What's due or late in Pendientes (Pagos plus Cobros), as a counter next to the menu entry.
  const pendingDue = useQuery({ queryKey: ['pending', 'summary'], queryFn: () => api.get<{ due: number }>('/pending/summary'), refetchInterval: 60_000 }).data?.due ?? 0;
  const qc = useQueryClient();
  const isMobile = useMediaQuery('(max-width: 48em)');
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const scoped = SCOPED.includes(location.pathname);

  const [addAccountOpen, addAccount] = useDisclosure();
  // Logs out the active user; if another account is logged in on this browser, the app continues as it.
  const logout = () => logoutAccount(qc);

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
          <Group gap="xs" wrap="nowrap" align="center" h="100%">
            {!isMobile && <ProfileSwitcher />}
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
                <AccountMenuSection onAdd={addAccount.open} />
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
                <LogoutAllItem />
              </Menu.Dropdown>
            </Menu>
            <AddAccountModal opened={addAccountOpen} onClose={addAccount.close} />
            <MercadoPagoAccountPrompt />
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
                rightSection={item.to === '/pendientes' && pendingDue > 0 ? <span className="pfd-nav-count">{pendingDue}</span> : undefined}
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
        <div className="pfd-page" data-width={PAGE_WIDTH[location.pathname] ?? 'wide'}>
          <VersionCheck />
          {children}
          <AppFooter />
        </div>
      </AppShell.Main>
      {txModal && <TxFormModal />}
    </AppShell>
  );
}

/** Simple page title row with optional actions on the right. */
// Page descriptions are intentionally not shown: the app should read without explanatory subtitles.
export function PageHeader({ title, actions, badge }: { title: string; description?: ReactNode; actions?: ReactNode; badge?: string }) {
  return (
    <nav className="pfd-crumbs" aria-label="Ubicación">
      <div className="pfd-crumbs-path">
        <div className="pfd-crumbs-title">
          <Group gap="xs" wrap="nowrap">
            <Text component="h1" fz={19} fw={700} m={0} lh={1.25}>
              {title}
            </Text>
            {badge && <span className="pfd-tag">{badge}</span>}
          </Group>
        </div>
      </div>
      {actions && <div className="pfd-crumbs-actions">{actions}</div>}
    </nav>
  );
}

/**
 * Warns when this page is older than the server (a cached tab, or an old copy still open),
 * which otherwise looks like "the update didn't apply".
 */
function VersionCheck() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ version?: string }>('/health'), refetchInterval: 5 * 60_000, refetchOnWindowFocus: true });
  const server = health.data?.version;
  if (!server || server === __APP_VERSION__) return null;
  return (
    <Alert color="yellow" icon={<IconRefresh size={16} />} mb="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">
          Esta pantalla es de la versión {__APP_VERSION__}, pero la app ya está en la {server}.
        </Text>
        <Button size="xs" variant="default" onClick={() => window.location.reload()}>
          Recargar
        </Button>
      </Group>
    </Alert>
  );
}

/** Slim footer strip: where the numbers come from and quick links. */
function AppFooter() {
  return (
    <footer className="pfd-footer">
      <span>Finanzas v{__APP_VERSION__} · uso privado del hogar</span>
      <span>Dólar: BNA · Inflación: IPC INDEC</span>
      <Link to="/ajustes">Ajustes</Link>
      <Link to="/importar">Importar</Link>
      <Link to="/cierre">Cierre de mes</Link>
      <Link to="/ayuda">Ayuda</Link>
      <a href="/patch-notes.html">Patch notes</a>
    </footer>
  );
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Month selector: up moves forward in time, down moves back; the field opens a month + year picker. */
export function MonthSelect({ value, onChange }: { value: string; onChange: (m: string) => void; months?: number }) {
  const [open, setOpen] = useState(false);
  const [y, m] = value.split('-').map(Number);
  const go = (year: number, month: number) => onChange(`${year}-${String(month).padStart(2, '0')}`);
  return (
    <Group gap={4} wrap="nowrap" className="pfd-month">
      <Popover opened={open} onChange={setOpen} position="bottom-end" withArrow trapFocus>
        <Popover.Target>
          <Button variant="default" size="xs" w={156} justify="space-between" rightSection={<IconCalendar size={14} />} onClick={() => setOpen((o) => !o)} aria-label="Elegir mes">
            {MONTHS[m - 1]} {y}
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Group gap="xs" wrap="nowrap" align="flex-end">
            <Select
              label="Mes"
              w={140}
              data={MONTHS.map((name, i) => ({ value: String(i + 1), label: name }))}
              value={String(m)}
              onChange={(v) => v && go(y, Number(v))}
              allowDeselect={false}
              comboboxProps={{ withinPortal: false }}
            />
            <NumberInput label="Año" w={92} min={2000} max={2100} value={y} onChange={(v) => typeof v === 'number' && v >= 2000 && v <= 2100 && go(v, m)} />
          </Group>
        </Popover.Dropdown>
      </Popover>
      <div className="pfd-month-arrows">
        <UnstyledButton aria-label="Mes siguiente" onClick={() => onChange(shiftMonth(value, 1))}>
          <IconChevronUp size={13} stroke={2.2} />
        </UnstyledButton>
        <UnstyledButton aria-label="Mes anterior" onClick={() => onChange(shiftMonth(value, -1))}>
          <IconChevronDown size={13} stroke={2.2} />
        </UnstyledButton>
      </div>
    </Group>
  );
}

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
