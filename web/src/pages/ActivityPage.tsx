import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Button, Card, Group, Menu, Pagination, Popover, Select, SimpleGrid, Stack, Table, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { DateInput, DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconChevronDown, IconChevronRight, IconDots, IconDownload, IconLock, IconPencil, IconRefresh, IconSearch } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download, qs } from '../lib/api';
import { useApp } from '../lib/app-state';
import { notifyError, notifyOk } from '../lib/queries';
import { PageHeader } from '../components/Layout';
import { DEFAULT_ZONE, allZones, dayKey, dayTitle, deviceZone, fullTimeIn, isValidZone, nextDay, startOfDayUtc, timeIn, zoneLabel } from '../lib/timezone';

// Actividad: who did what, when. The server sends UTC instants; every time on this page is shown
// in the zone picked here (Argentina by default), and date filters are converted to UTC instants
// in that same zone before asking the server.

type Change = { field: string; from: string; to: string };
type Details = { changes?: Change[]; facts?: { label: string; value: string }[]; items?: string[]; truncated?: boolean };
type Entry = {
  id: number;
  at_ms: number;
  user_id: number | null;
  user_name: string | null;
  profile_id: number | null;
  profile_name: string | null;
  section: string;
  action: string;
  summary: string;
  details: Details | null;
  private: boolean;
};
type Page = { total: number; page: number; page_size: number; items: Entry[] };
type Count = { section: string; count: number };

const PAGE_SIZE = 50;
const ZONE_KEY = 'pfd.activity.tz';

function storedZone(): string {
  try {
    const z = localStorage.getItem(ZONE_KEY);
    if (z && isValidZone(z)) return z;
  } catch {
    /* private mode */
  }
  return DEFAULT_ZONE;
}

function storeZone(z: string) {
  try {
    localStorage.setItem(ZONE_KEY, z);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

export function ActivityPage() {
  const { users } = useApp();
  const qc = useQueryClient();
  const [zone, setZoneRaw] = useState(storedZone);
  const setZone = (z: string) => {
    setZoneRaw(z);
    storeZone(z);
  };
  const [section, setSection] = useState('all');
  const [user, setUser] = useState('all');
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search.trim(), 300);
  const [allProfiles, setAllProfiles] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);

  // Date range: whole calendar days in the chosen zone, as UTC instants.
  const from = range[0] ? startOfDayUtc(range[0], zone) : undefined;
  const end = range[1] ?? range[0];
  const to = end ? startOfDayUtc(nextDay(end), zone) : undefined;
  const filters = {
    user: user === 'all' ? undefined : user,
    profile: allProfiles ? 'all' : 'current',
    from,
    to,
    q: q || undefined,
  };
  const listParams = { ...filters, section: section === 'all' ? undefined : section, page, page_size: PAGE_SIZE };

  useEffect(() => setPage(1), [section, user, range, q, allProfiles, zone]);

  const list = useQuery({ queryKey: ['audit', 'list', listParams], queryFn: () => api.get<Page>(`/audit${qs(listParams)}`), placeholderData: (prev) => prev });
  const counts = useQuery({ queryKey: ['audit', 'sections', filters], queryFn: () => api.get<Count[]>(`/audit/sections${qs(filters)}`) });

  const total = counts.data?.reduce((s, c) => s + c.count, 0) ?? 0;
  const sectionCount = counts.data?.find((c) => c.section === section)?.count ?? 0;
  const sectionData = [
    { value: 'all', label: `Todas las secciones · ${total}` },
    ...(counts.data ?? []).filter((c) => c.count > 0 || c.section === section).map((c) => ({ value: c.section, label: `${c.section} · ${c.count}` })),
  ];
  const userData = [{ value: 'all', label: 'Todas las personas' }, ...users.map((u) => ({ value: String(u.id), label: u.display_name })), { value: 'auto', label: 'Automático' }];
  const colorOf = (id: number | null) => users.find((u) => u.id === id)?.color ?? 'gray';

  // Entries grouped by calendar day in the chosen zone.
  const days = useMemo(() => {
    const out: { key: string; items: Entry[] }[] = [];
    for (const e of list.data?.items ?? []) {
      const key = dayKey(e.at_ms, zone);
      if (out.at(-1)?.key !== key) out.push({ key, items: [] });
      out.at(-1)!.items.push(e);
    }
    return out;
  }, [list.data, zone]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['audit'] });
  const where = allProfiles ? 'de todos los perfiles' : 'de este perfil';

  const clear = async (params: Record<string, string | number | undefined>) => {
    try {
      const r = await api.del<{ deleted: number }>(`/audit${qs({ ...params, profile: allProfiles ? 'all' : 'current', tz: zone })}`);
      notifyOk(r.deleted === 1 ? 'Se borró 1 entrada' : `Se borraron ${r.deleted} entradas`);
      setOpen(null);
      refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  const confirmClear = (title: string, text: string, params: Record<string, string>) =>
    modals.openConfirmModal({
      title,
      centered: true,
      children: <Text size="sm">{text}</Text>,
      labels: { confirm: 'Borrar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => clear(params),
    });

  const clearBefore = () =>
    modals.open({
      title: 'Borrar anteriores a una fecha',
      centered: true,
      children: <ClearBeforeForm zone={zone} where={where} onConfirm={(ms) => clear({ scope: 'before', before: ms })} />,
    });

  return (
    <>
      <PageHeader
        title="Actividad"
        actions={
          <Group gap={6} wrap="nowrap">
            <Tooltip label="Actualizar" withArrow>
              <ActionIcon variant="default" size="md" onClick={refresh} aria-label="Actualizar" loading={list.isFetching && !list.isLoading}>
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Descargar CSV" withArrow>
              <ActionIcon variant="default" size="md" aria-label="Descargar CSV" onClick={() => download(`/audit/export.csv${qs({ ...filters, section: section === 'all' ? undefined : section, tz: zone })}`)}>
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <ActionIcon variant="default" size="md" aria-label="Más acciones">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  color="red"
                  disabled={section === 'all' || !sectionCount}
                  onClick={() => confirmClear(`Borrar ${section}`, `Se borran ${sectionCount} entradas de ${section} ${where}. Las privadas de otra persona se conservan.`, { scope: 'section', section })}
                >
                  Borrar esta sección
                </Menu.Item>
                <Menu.Item color="red" disabled={!total} onClick={clearBefore}>
                  Borrar anteriores a…
                </Menu.Item>
                <Menu.Item color="red" disabled={!total} onClick={() => confirmClear('Borrar toda la actividad', `Se borran ${total} entradas ${where}. Las privadas de otra persona se conservan.`, { scope: 'all' })}>
                  Borrar todo
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        }
      />
      <Stack gap="md">
        <Card>
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <Select aria-label="Sección" data={sectionData} value={section} onChange={(v) => setSection(v ?? 'all')} allowDeselect={false} />
              <Select aria-label="Persona" data={userData} value={user} onChange={(v) => setUser(v ?? 'all')} allowDeselect={false} />
              <DatePickerInput type="range" placeholder="Fechas" aria-label="Fechas" value={range} onChange={(v) => setRange(v as [string | null, string | null])} valueFormat="DD/MM/YYYY" clearable allowSingleDateInRange />
              <TextInput placeholder="Buscar" aria-label="Buscar" leftSection={<IconSearch size={15} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
            </SimpleGrid>
            <Group justify="space-between" gap="xs">
              <Button size="compact-xs" variant="default" className="pfd-toggle" data-on={allProfiles || undefined} aria-pressed={allProfiles} onClick={() => setAllProfiles(!allProfiles)}>
                Todos los perfiles
              </Button>
              <ZonePicker zone={zone} onChange={setZone} />
            </Group>
          </Stack>
        </Card>

        <Card p={0}>
          {!list.data?.items.length ? (
            <Text c="dimmed" size="sm" p="md">
              {list.isLoading ? 'Cargando…' : 'Sin actividad.'}
            </Text>
          ) : (
            days.map((d) => (
              <div key={d.key}>
                <div className="pfd-act-day">{dayTitle(d.key)}</div>
                {d.items.map((e) => (
                  <div key={e.id} className="pfd-act-entry" data-open={open === e.id || undefined}>
                    <UnstyledButton className="pfd-act-row" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                      <span className="pfd-act-time num">{timeIn(e.at_ms, zone)}</span>
                      <span className="pfd-act-who">
                        <span className="pfd-act-dot" style={{ background: e.user_id ? `var(--mantine-color-${colorOf(e.user_id)}-6)` : 'var(--pfd-rule-strong)' }} />
                        {e.user_name ?? 'Automático'}
                      </span>
                      <span className="pfd-act-text">{e.summary}</span>
                      <span className="pfd-act-meta">
                        {section === 'all' && <span className="pfd-act-section">{e.section}</span>}
                        {e.private && <IconLock size={13} aria-label="Solo lo ves vos" />}
                        {open === e.id ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                      </span>
                    </UnstyledButton>
                    {open === e.id && <EntryDetails e={e} zone={zone} />}
                  </div>
                ))}
              </div>
            ))
          )}
          {list.data && list.data.total > PAGE_SIZE && (
            <Group justify="center" p="md">
              <Pagination total={Math.ceil(list.data.total / PAGE_SIZE)} value={page} onChange={setPage} size="sm" />
            </Group>
          )}
        </Card>
      </Stack>
    </>
  );
}

function EntryDetails({ e, zone }: { e: Entry; zone: string }) {
  const d = e.details ?? {};
  return (
    <div className="pfd-act-detail">
      {!!d.changes?.length && (
        <Table withTableBorder={false} verticalSpacing={4} className="pfd-act-changes">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Campo</Table.Th>
              <Table.Th>Antes</Table.Th>
              <Table.Th>Después</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.changes.map((c, i) => (
              <Table.Tr key={i}>
                <Table.Td>{c.field}</Table.Td>
                <Table.Td c="dimmed">{c.from}</Table.Td>
                <Table.Td>{c.to}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {!!d.items?.length && (
        <ul className="pfd-act-items">
          {d.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
          {d.truncated && <li>…</li>}
        </ul>
      )}
      <dl className="pfd-act-facts">
        {(d.facts ?? []).map((f, i) => (
          <div key={i}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
        <div>
          <dt>Sección</dt>
          <dd>{e.section}</dd>
        </div>
        <div>
          <dt>Perfil</dt>
          <dd>{e.profile_name ?? 'Todos'}</dd>
        </div>
        <div>
          <dt>Hora</dt>
          <dd className="num">{fullTimeIn(e.at_ms, zone)}</dd>
        </div>
        <div>
          <dt>UTC</dt>
          <dd className="num">{new Date(e.at_ms).toISOString().replace('T', ' ').replace('Z', ' UTC')}</dd>
        </div>
        {e.private && (
          <div>
            <dt>Visible</dt>
            <dd>Solo para vos</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** The zone in use as text with a pencil; the pencil opens a searchable list of zones. */
function ZonePicker({ zone, onChange }: { zone: string; onChange: (z: string) => void }) {
  const [opened, setOpened] = useState(false);
  const zones = useMemo(() => allZones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), []);
  const device = deviceZone();
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" withArrow shadow="md" width={300}>
      <Popover.Target>
        <UnstyledButton className="pfd-act-zone" onClick={() => setOpened((o) => !o)} aria-label="Cambiar zona horaria">
          <span>{zoneLabel(zone)}</span>
          <IconPencil size={13} />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Select
            label="Zona horaria"
            data={zones}
            value={zone}
            searchable
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
            onChange={(v) => {
              if (v) {
                onChange(v);
                setOpened(false);
              }
            }}
          />
          {device !== zone && (
            <Button size="xs" variant="default" onClick={() => (onChange(device), setOpened(false))}>
              Usar la de este dispositivo
            </Button>
          )}
          {zone !== DEFAULT_ZONE && (
            <Button size="xs" variant="default" onClick={() => (onChange(DEFAULT_ZONE), setOpened(false))}>
              Volver a la hora de Argentina
            </Button>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function ClearBeforeForm({ zone, where, onConfirm }: { zone: string; where: string; onConfirm: (ms: number) => void }) {
  const [day, setDay] = useState<string | null>(null);
  const ms = day ? startOfDayUtc(day, zone) : null;
  return (
    <Stack gap="sm">
      <DateInput label="Anteriores al día" value={day} onChange={setDay} valueFormat="DD/MM/YYYY" data-autofocus maxDate={new Date()} />
      {ms != null && (
        <Text size="sm">
          Se borran las entradas {where} anteriores al {fullTimeIn(ms, zone).replace(/:\d\d \(.*$/, '')} ({zoneLabel(zone, ms)}).
        </Text>
      )}
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={() => modals.closeAll()}>
          Cancelar
        </Button>
        <Button
          color="red"
          disabled={ms == null}
          onClick={() => {
            modals.closeAll();
            if (ms != null) onConfirm(ms);
          }}
        >
          Borrar
        </Button>
      </Group>
    </Stack>
  );
}
