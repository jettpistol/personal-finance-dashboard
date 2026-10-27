import { useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Group, Modal, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconSearch } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { notifyError, notifyOk } from '../lib/queries';

type CatalogRule = {
  id: string;
  section: string;
  name: string;
  pattern: string;
  category: string | null;
  category_id: number | null;
  merchant: string;
  tags: string[];
  added: boolean;
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * The bank of suggested rules for Buenos Aires (stores, apps, services, taxes). Browse by section,
 * tick what you use and add it: nothing is applied until you pick it.
 */
export function RuleCatalogModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ['rules', 'catalog'], queryFn: () => api.get<CatalogRule[]>('/rules/catalog') });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const sections = useMemo(() => {
    const q = fold(search.trim());
    const rows = (catalog.data ?? []).filter((r) => !q || fold(`${r.name} ${r.category ?? ''} ${r.tags.join(' ')} ${r.section}`).includes(q));
    const map = new Map<string, CatalogRule[]>();
    for (const r of rows) map.set(r.section, [...(map.get(r.section) ?? []), r]);
    return [...map.entries()];
  }, [catalog.data, search]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleSection = (rows: CatalogRule[], on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      for (const r of rows) if (!r.added) on ? n.add(r.id) : n.delete(r.id);
      return n;
    });

  const add = async () => {
    setSaving(true);
    try {
      const r = await api.post<{ created: number }>('/rules/catalog', { ids: [...picked] });
      notifyOk(r.created === 1 ? '1 regla agregada' : `${r.created} reglas agregadas`);
      qc.invalidateQueries({ queryKey: ['rules'] });
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={onClose} size="xl" title={<Text fw={700}>Reglas sugeridas</Text>} fullScreen={window.innerWidth < 600}>
      <Stack gap="sm">
        <Text size="sm">Comercios y servicios habituales en Buenos Aires. Marcá los que usás: cada regla pone la categoría, el comercio y etiquetas.</Text>
        <TextInput leftSection={<IconSearch size={16} />} placeholder="Buscar: Coto, nafta, streaming…" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <ScrollArea.Autosize mah="55vh" type="auto">
          <Stack gap={0} className="pfd-catalog">
            {catalog.isLoading && <Text c="dimmed">Cargando…</Text>}
            {catalog.data && !sections.length && <Text c="dimmed">Sin coincidencias.</Text>}
            {sections.map(([section, rows]) => {
              const expanded = !!search.trim() || open.has(section);
              const available = rows.filter((r) => !r.added);
              const all = available.length > 0 && available.every((r) => picked.has(r.id));
              const some = available.some((r) => picked.has(r.id));
              return (
                <div key={section}>
                  <Group className="pfd-catalog-head" gap="xs" wrap="nowrap">
                    <Checkbox
                      size="xs"
                      aria-label={`Elegir todas: ${section}`}
                      checked={all}
                      indeterminate={some && !all}
                      disabled={!available.length}
                      onChange={(e) => toggleSection(rows, e.currentTarget.checked)}
                    />
                    <UnstyledButton
                      style={{ flex: 1 }}
                      onClick={() =>
                        setOpen((o) => {
                          const n = new Set(o);
                          if (n.has(section)) n.delete(section);
                          else n.add(section);
                          return n;
                        })
                      }
                    >
                      <Group gap={6} wrap="nowrap">
                        {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        <Text fw={700} size="sm">
                          {section}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {rows.length}
                          {rows.some((r) => picked.has(r.id)) && ` · ${rows.filter((r) => picked.has(r.id)).length} elegidas`}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  </Group>
                  {expanded &&
                    rows.map((r) => (
                      <label key={r.id} className="pfd-catalog-row" data-added={r.added || undefined}>
                        <Checkbox size="xs" checked={r.added || picked.has(r.id)} disabled={r.added} onChange={() => toggle(r.id)} aria-label={r.name} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm" fw={600} lineClamp={1}>
                              {r.name}
                            </Text>
                            {r.added && (
                              <span className="pfd-tag" data-tone="gray">
                                Ya está
                              </span>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {r.category ? r.category.replace(' > ', ' › ') : 'Sin categoría'}
                            {r.category && !r.category_id && ' (no existe en este perfil)'}
                          </Text>
                        </div>
                        <Group gap={4} wrap="nowrap" visibleFrom="xs">
                          {r.tags.map((t) => (
                            <Badge key={t} size="xs" variant="outline" color="gray" style={{ textTransform: 'none' }}>
                              {t}
                            </Badge>
                          ))}
                        </Group>
                      </label>
                    ))}
                </div>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Después podés usar «Aplicar reglas» para categorizar lo que ya cargaste.
          </Text>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={add} loading={saving} disabled={!picked.size}>
              {picked.size === 1 ? 'Agregar 1 regla' : `Agregar ${picked.size} reglas`}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
