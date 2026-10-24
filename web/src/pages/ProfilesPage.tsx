import { useState } from 'react';
import { Badge, Button, Card, Group, Radio, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { notifyError, notifyOk } from '../lib/queries';
import { PageHeader } from '../components/Layout';
import { useProfiles, useSelectProfile, type ProfileInfo } from '../lib/profiles';

export function ProfilesPage() {
  const q = useProfiles();
  const qc = useQueryClient();
  const select = useSelectProfile();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/profiles', { name });
      setName('');
      await qc.invalidateQueries({ queryKey: ['profiles'] });
      notifyOk('Perfil creado, vacío y listo para usar');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  const rename = (p: ProfileInfo) => {
    let next = p.name;
    modals.openConfirmModal({
      title: 'Renombrar perfil',
      children: <TextInput label="Nombre" defaultValue={p.name} onChange={(e) => (next = e.currentTarget.value)} data-autofocus />,
      labels: { confirm: 'Guardar', cancel: 'Cancelar' },
      onConfirm: async () => {
        try {
          await api.patch(`/profiles/${p.id}`, { name: next });
          qc.invalidateQueries({ queryKey: ['profiles'] });
        } catch (e) {
          notifyError(e);
        }
      },
    });
  };

  const remove = (p: ProfileInfo) =>
    modals.openConfirmModal({
      title: `Borrar «${p.name}»`,
      children: <Text size="sm">Se borran para siempre sus {p.accounts} cuentas y {p.transactions} movimientos. Los usuarios no se tocan.</Text>,
      labels: { confirm: 'Borrar perfil', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/profiles/${p.id}`);
          if (q.data?.current === p.id) {
            qc.clear();
            await qc.invalidateQueries();
          } else {
            qc.invalidateQueries({ queryKey: ['profiles'] });
          }
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const current = q.data?.current;
  return (
    <>
      <PageHeader title="Perfil de datos" />
      <Stack gap="md">
        <Card>
          <Title order={4}>Perfiles</Title>
          <Radio.Group value={current ? String(current) : null}>
            <Table verticalSpacing={8}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>En uso</Table.Th>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th ta="right">Cuentas</Table.Th>
                  <Table.Th ta="right">Movimientos</Table.Th>
                  <Table.Th w={90} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data?.profiles.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Radio value={String(p.id)} aria-label={`Usar ${p.name}`} onChange={() => p.id !== current && select(p.id, p.name)} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={8}>
                        <Text fw={p.id === current ? 700 : 500}>{p.name}</Text>
                        {p.is_default && <span className="pfd-tag" data-tone="gray">Por defecto</span>}
                        {p.id === current && <Badge size="sm">En uso</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right" className="num">
                      {p.accounts}
                    </Table.Td>
                    <Table.Td ta="right" className="num">
                      {p.transactions}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Button size="compact-xs" variant="default" onClick={() => rename(p)} aria-label={`Renombrar ${p.name}`}>
                          <IconPencil size={13} />
                        </Button>
                        {!p.is_default && (
                          <Button size="compact-xs" variant="default" color="red" onClick={() => remove(p)} aria-label={`Borrar ${p.name}`}>
                            <IconTrash size={13} />
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Radio.Group>
        </Card>
        <Card>
          <Title order={4}>Nuevo perfil</Title>
          <Group align="flex-end" gap="sm">
            <TextInput label="Nombre" placeholder="Ej: Producción, Pruebas de importación" value={name} onChange={(e) => setName(e.currentTarget.value)} w={320} onKeyDown={(e) => e.key === 'Enter' && create()} />
            <Button leftSection={<IconPlus size={14} />} onClick={create} loading={busy} disabled={!name.trim()}>
              Crear perfil vacío
            </Button>
          </Group>
        </Card>
      </Stack>
    </>
  );
}
