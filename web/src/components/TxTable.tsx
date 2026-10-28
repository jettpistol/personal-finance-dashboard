import { Badge, Checkbox, Group, Table, Text, Tooltip } from '@mantine/core';
import { IconArrowRight, IconPaperclip } from '@tabler/icons-react';
import { useApp } from '../lib/app-state';
import { date, money } from '../lib/format';
import { categoryColor, categoryLabel, useAccounts, useCategories } from '../lib/queries';
import type { Tx } from '../lib/types';

export function txSign(t: Tx): number {
  if (t.type === 'expense') return -1;
  if (t.type === 'income') return 1;
  if (t.type === 'adjustment') return Math.sign(t.amount);
  return 0;
}

export function TxAmount({ t }: { t: Tx }) {
  const sign = txSign(t);
  const color = sign < 0 ? undefined : sign > 0 ? 'teal' : 'dimmed';
  // A conversion between currencies shows what came in and the rate used.
  const toCurrency = t.currency === 'ARS' ? 'USD' : 'ARS';
  const rate = t.to_amount ? (t.currency === 'ARS' ? t.amount / t.to_amount : t.to_amount / t.amount) : null;
  return (
    <>
      <Text className="num" fw={600} c={color} size="sm" ta="right">
        {t.type === 'transfer' ? '' : sign < 0 ? '-' : sign > 0 ? '+' : ''}
        {money(Math.abs(t.amount), t.currency)}
      </Text>
      {t.type === 'transfer' && t.to_amount && rate && (
        <Text className="num" size="xs" c="dimmed" ta="right">
          → {money(t.to_amount, toCurrency)} · TC $ {rate.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
        </Text>
      )}
    </>
  );
}

/** Compact transaction list. Clicking a row opens it for editing. */
export function TxTable({
  rows,
  compact,
  selectable,
  selected,
  onSelect,
  hideOwner,
}: {
  rows: Tx[];
  compact?: boolean;
  selectable?: boolean;
  selected?: Set<number>;
  onSelect?: (ids: Set<number>) => void;
  /** Leave out the Compartido / person tag when the list is already grouped by it. */
  hideOwner?: boolean;
}) {
  const { openTx, users } = useApp();
  const accounts = useAccounts();
  const cats = useCategories();
  const accName = (id: number | null) => (id == null ? 'Cuenta privada' : (accounts.data?.find((a) => a.id === id)?.name ?? '—'));
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect?.(next);
  };

  if (!rows.length) {
    return (
      <Text c="dimmed" size="sm" py="md" ta="center">
        No hay movimientos.
      </Text>
    );
  }

  return (
    <Table.ScrollContainer minWidth={compact ? 0 : 640}>
      <Table verticalSpacing={compact ? 6 : 'xs'} highlightOnHover data-compact={compact || undefined}>
        {!compact && (
          <Table.Thead>
            <Table.Tr>
              {selectable && (
                <Table.Th w={32}>
                  <Checkbox
                    size="xs"
                    aria-label="Seleccionar todo"
                    checked={!!selected?.size && rows.every((r) => selected.has(r.id))}
                    indeterminate={!!selected?.size && !rows.every((r) => selected.has(r.id))}
                    onChange={(e) => onSelect?.(e.currentTarget.checked ? new Set(rows.filter((r) => r.can_edit).map((r) => r.id)) : new Set())}
                  />
                </Table.Th>
              )}
              <Table.Th w={90}>Fecha</Table.Th>
              <Table.Th>Descripción</Table.Th>
              <Table.Th>Categoría</Table.Th>
              <Table.Th>Cuenta</Table.Th>
              <Table.Th ta="right">Monto</Table.Th>
            </Table.Tr>
          </Table.Thead>
        )}
        <Table.Tbody>
          {rows.map((t) => {
            const payer = users.find((u) => u.id === t.paid_by);
            return (
              <Table.Tr key={t.id} className="clickable-row" onClick={() => openTx({ id: t.id })} opacity={t.status === 'pending' ? 0.7 : 1}>
                {selectable && (
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    <Checkbox size="xs" aria-label="Seleccionar" disabled={!t.can_edit} checked={!!selected?.has(t.id)} onChange={() => toggle(t.id)} />
                  </Table.Td>
                )}
                <Table.Td>
                  <Text size="sm" c="dimmed" className="num">
                    {date(t.date, compact ? 'D MMM' : 'DD/MM/YY')}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500} lineClamp={compact ? 2 : 1}>
                      {t.description || t.merchant || '(sin descripción)'}
                    </Text>
                    {t.status === 'pending' && (
                      <span className="pfd-tag" data-tone="ocre">
                        Pendiente
                      </span>
                    )}
                    {hideOwner ? null : t.owner === 'shared' ? (
                      <Tooltip label={!t.is_shared ? 'Cuenta común' : `${t.type === 'income' ? 'Lo recibió' : 'Pagó'} ${payer?.display_name ?? 'la cuenta común'}`}>
                        <span className="pfd-tag" data-tone="grape">
                          Compartido
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="pfd-tag">{users.find((u) => u.id === t.owner)?.display_name ?? '—'}</span>
                    )}
                    {!!t.is_private && (
                      <span className="pfd-tag" data-tone="gray">
                        Privado
                      </span>
                    )}
                    {t.recurring_id && !compact && <span className="pfd-tag">Recurrente</span>}
                    {t.has_receipt && <IconPaperclip size={14} color="var(--mantine-color-dimmed)" />}
                  </Group>
                  {!compact && t.tags.length > 0 && (
                    <Group gap={4} mt={2}>
                      {t.tags.map((tag) => (
                        <Badge key={tag} size="xs" variant="outline" color="gray">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  )}
                </Table.Td>
                {!compact && (
                  <>
                    <Table.Td>
                      {t.type === 'expense' || t.type === 'income' ? (
                        <Badge variant="light" color={categoryColor(cats.data, t.category_id)} size="md" className="pfd-cat-badge">
                          {categoryLabel(cats.data, t.category_id)}
                        </Badge>
                      ) : (
                        <Text size="xs" c="dimmed">
                          {t.type === 'transfer' ? (t.is_settlement ? 'Pago de deuda' : 'Transferencia') : 'Ajuste'}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Text size="sm" lineClamp={1}>
                          {accName(t.account_id)}
                        </Text>
                        {t.type === 'transfer' && (
                          <>
                            <IconArrowRight size={12} />
                            <Text size="sm" lineClamp={1}>
                              {accName(t.to_account_id)}
                            </Text>
                          </>
                        )}
                      </Group>
                    </Table.Td>
                  </>
                )}
                <Table.Td>
                  <TxAmount t={t} />
                  {compact && (
                    <Text size="xs" c="dimmed" ta="right" lineClamp={1}>
                      {t.type === 'expense' || t.type === 'income' ? categoryLabel(cats.data, t.category_id) : accName(t.account_id)}
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
