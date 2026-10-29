import { useEffect, useState } from 'react';
import { Button, Checkbox, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { notifyError, notifyOk } from '../lib/queries';
import type { ImportItem } from '../lib/types';
import { ImportReview } from './ImportReview';

type Review = { items: ImportItem[]; skipped: number; opening: { date: string; amount: number } | null; first: boolean; account: { id: number; name: string } | null };
type Saved = { imported: number; merged: number; failures: { description: string; error: string }[]; opening: number | null };

/**
 * The Mercado Pago movements waiting for a look: the whole history the first time, then only the
 * ones that need a choice (where a withdrawal went). Same table as Importar and Resúmenes.
 */
export function MercadoPagoReview({ opened, onClose, onSaved }: { opened: boolean; onClose: () => void; onSaved: (view: unknown) => void }) {
  const qc = useQueryClient();
  const [review, setReview] = useState<Review | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [useOpening, setUseOpening] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setReview(null);
    api
      .get<Review>('/me/mercadopago/review')
      .then((r) => {
        setReview(r);
        setItems(r.items);
        setUseOpening(true);
      })
      .catch((e) => {
        notifyError(e);
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const save = async () => {
    const bad = items.find((r) => r.include && r.type === 'transfer' && !r.to_account_id);
    if (bad) return notifyError(new Error(`Falta la cuenta destino de «${bad.description}».`));
    setSaving(true);
    try {
      const r = await api.post<Saved>('/me/mercadopago/review', { rows: items, use_opening: useOpening });
      onSaved(r);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      if (r.failures.length) notifyError(new Error(`${r.failures.length} movimientos no se pudieron guardar: ${r.failures[0].error}`));
      notifyOk(`Guardados ${r.imported} movimientos de Mercado Pago${r.merged ? ` y completados ${r.merged} cargados a mano` : ''}.`);
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const opening = review?.first ? review.opening : null;
  return (
    <Modal opened={opened} onClose={onClose} centered size={1100} title={<Text fw={700}>Movimientos de Mercado Pago</Text>}>
      {!review ? (
        <Group justify="center" p="xl">
          <Loader size="sm" />
        </Group>
      ) : (
        <Stack gap="sm">
          {opening && (
            <Checkbox
              checked={useOpening}
              onChange={(e) => setUseOpening(e.currentTarget.checked)}
              label={
                <>
                  Usar <b className="num">{money(opening.amount, 'ARS')}</b> como saldo inicial de «{review.account?.name}» (saldo de Mercado Pago al {date(opening.date, 'D MMM')})
                </>
              }
            />
          )}
          {review.skipped > 0 && (
            <Text size="xs" c="dimmed">
              {review.skipped} filas del reporte no son movimientos (dinero retenido o reservado) y no se importan.
            </Text>
          )}
          {items.length ? (
            <ImportReview errors={[]} items={items} setItems={setItems} currency="ARS" onBack={onClose} backLabel="Cerrar" onCommit={save} committing={saving} />
          ) : (
            <>
              <Text size="sm">No hay movimientos nuevos.</Text>
              <Group>
                <Button onClick={save} loading={saving}>
                  Guardar
                </Button>
              </Group>
            </>
          )}
        </Stack>
      )}
    </Modal>
  );
}
