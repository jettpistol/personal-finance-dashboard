import { useEffect, useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Collapse,
  FileButton,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconAlertCircle, IconPaperclip, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import { fromCents, money, toCents, today } from '../lib/format';
import { compressImage } from '../lib/image';
import { notifyError, notifyOk, useAccounts, useRefreshData, useSettings, useTags } from '../lib/queries';
import type { SplitMethod, Tx, TxType } from '../lib/types';
import { AccountSelect, CategorySelect, MoneyInput } from './inputs';
import { SplitEditor, splitProblem } from './SplitEditor';

type Form = {
  type: TxType;
  date: string;
  amount: number | string;
  account_id: number | null;
  to_account_id: number | null;
  to_amount: number | string;
  category_id: number | null;
  description: string;
  merchant: string;
  notes: string;
  tags: string[];
  is_shared: boolean;
  split_method: SplitMethod;
  split_values: Record<number, number | string>;
  is_private: boolean;
  is_settlement: boolean;
  installments: boolean;
  count: number | string;
  first_date: string;
};

const empty = (type: TxType = 'expense', accountId: number | null = null): Form => ({
  type,
  date: today(),
  amount: '',
  account_id: accountId,
  to_account_id: null,
  to_amount: '',
  category_id: null,
  description: '',
  merchant: '',
  notes: '',
  tags: [],
  is_shared: false,
  split_method: 'default',
  split_values: {},
  is_private: false,
  is_settlement: true,
  installments: false,
  count: 3,
  first_date: today(),
});

function fromTx(t: Tx): Form {
  const method = (t.split_method ?? 'default') as SplitMethod;
  const values: Record<number, number> = {};
  if (t.is_shared) {
    for (const s of t.splits) values[s.user_id] = method === 'percent' ? Math.round((s.amount / t.amount) * 10000) / 100 : fromCents(s.amount);
  }
  return {
    ...empty(t.type),
    date: t.date,
    amount: fromCents(Math.abs(t.amount)) * (t.type === 'adjustment' && t.amount < 0 ? -1 : 1),
    account_id: t.account_id,
    to_account_id: t.to_account_id,
    to_amount: t.to_amount ? fromCents(t.to_amount) : '',
    category_id: t.category_id,
    description: t.description,
    merchant: t.merchant ?? '',
    notes: t.notes ?? '',
    tags: t.tags,
    is_shared: !!t.is_shared,
    split_method: method,
    split_values: values,
    is_private: !!t.is_private,
    is_settlement: !!t.is_settlement,
  };
}

export function TxFormModal() {
  const { txModal, closeTx, users, me } = useApp();
  const editId = txModal?.id;
  const accounts = useAccounts();
  const settings = useSettings();
  const tags = useTags();
  const refresh = useRefreshData();
  const existing = useQuery({ queryKey: ['transactions', 'one', editId], queryFn: () => api.get<Tx>(`/transactions/${editId}`), enabled: !!editId });
  const [form, setForm] = useState<Form>(() => ({ ...empty(txModal?.type ?? 'expense', txModal?.accountId ?? null), installments: !!txModal?.installments }));
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data) setForm(fromTx(existing.data));
  }, [existing.data]);

  // Default account: the first writable personal account, else the first joint one.
  useEffect(() => {
    if (editId || form.account_id || !accounts.data?.length) return;
    const mine = accounts.data.find((a) => a.owner_id === me.id && !a.archived) ?? accounts.data.find((a) => a.owner_id === null && !a.archived);
    if (mine) setForm((f) => ({ ...f, account_id: mine.id }));
  }, [accounts.data, editId, form.account_id, me.id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const account = accounts.data?.find((a) => a.id === form.account_id);
  const toAccount = accounts.data?.find((a) => a.id === form.to_account_id);
  const crossCurrency = form.type === 'transfer' && account && toAccount && account.currency !== toAccount.currency;
  const crossOwner = form.type === 'transfer' && account && toAccount && account.owner_id !== null && toAccount.owner_id !== null && account.owner_id !== toAccount.owner_id;
  const personalAccount = account && account.owner_id !== null;
  const tx = existing.data;
  const readOnly = !!tx && !tx.can_edit;


  const suggest = async () => {
    if (editId || !form.description.trim() || (form.type !== 'expense' && form.type !== 'income')) return;
    try {
      const s = await api.post<{ category_id?: number; merchant?: string; is_shared?: boolean; tags?: string[]; rule_name?: string }>('/transactions/suggest', {
        description: form.description,
        amount: toCents(form.amount) * (form.type === 'expense' ? -1 : 1),
        account_id: form.account_id,
      });
      setForm((f) => ({
        ...f,
        category_id: f.category_id ?? s.category_id ?? null,
        merchant: f.merchant || s.merchant || '',
        is_shared: s.is_shared ?? f.is_shared,
        tags: f.tags.length ? f.tags : (s.tags ?? []),
      }));
      setSuggested(s.rule_name ? `Regla aplicada: ${s.rule_name}` : s.category_id ? 'Categoría sugerida según movimientos anteriores' : null);
    } catch {
      /* suggestions are optional */
    }
  };

  const splitPayload = () => {
    if (!form.is_shared) return null;
    if (form.split_method === 'default' || form.split_method === 'equal') return { method: form.split_method };
    return {
      method: form.split_method,
      values: users.map((u) => ({
        user_id: u.id,
        value: form.split_method === 'exact' ? toCents(form.split_values[u.id] ?? 0) : Number(form.split_values[u.id] ?? 0),
      })),
    };
  };

  const save = async () => {
    if (!form.account_id) return notifyError(new Error('Elegí una cuenta.'));
    const splitIssue = form.type === 'expense' && form.is_shared ? splitProblem(form.split_method, form.split_values, users, toCents(form.amount), account?.currency) : null;
    if (splitIssue) return notifyError(new Error(splitIssue));
    setSaving(true);
    try {
      const base = {
        date: form.date,
        amount: toCents(form.amount),
        account_id: form.account_id,
        category_id: form.type === 'expense' || form.type === 'income' ? form.category_id : null,
        description: form.description,
        merchant: form.merchant || null,
        notes: form.notes || null,
        tags: form.tags,
        is_shared: form.type === 'expense' && form.is_shared,
        split: form.type === 'expense' ? splitPayload() : null,
        is_private: form.is_private,
      };
      let id = editId;
      if (form.installments && !editId && form.type === 'expense') {
        await api.post('/transactions/installments', { ...base, count: Number(form.count), purchase_date: form.date, first_date: form.first_date });
        notifyOk(`Compra en ${form.count} cuotas registrada`);
      } else {
        const body = {
          ...base,
          type: form.type,
          to_account_id: form.type === 'transfer' ? form.to_account_id : null,
          to_amount: crossCurrency ? toCents(form.to_amount) : null,
          is_settlement: crossOwner ? form.is_settlement : null,
          status: tx?.status,
        };
        const saved = editId ? await api.put<Tx>(`/transactions/${editId}`, body) : await api.post<Tx>('/transactions', body);
        id = saved.id;
        notifyOk(editId ? 'Movimiento actualizado' : 'Movimiento guardado');
      }
      if (receipt && id) {
        const blob = await compressImage(receipt);
        await api.upload(`/transactions/${id}/receipt`, blob, 'file', receipt.type === 'application/pdf' ? receipt.name : 'comprobante.jpg');
      }
      refresh();
      closeTx();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const confirmPending = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      await api.post(`/transactions/${editId}/confirm`, { amount: toCents(form.amount), date: form.date });
      notifyOk('Movimiento confirmado');
      refresh();
      closeTx();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = (all = false) =>
    modals.openConfirmModal({
      title: all ? 'Eliminar todas las cuotas' : 'Eliminar movimiento',
      children: <Text size="sm">{all ? 'Se eliminan todas las cuotas de esta compra, pasadas y futuras.' : '¿Seguro? Esta acción no se puede deshacer.'}</Text>,
      labels: { confirm: 'Eliminar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/transactions/${editId}${all ? '?all_installments=1' : ''}`);
          refresh();
          closeTx();
        } catch (e) {
          notifyError(e);
        }
      },
    });

  const removeReceipt = async () => {
    try {
      await api.del(`/transactions/${editId}/receipt`);
      existing.refetch();
    } catch (e) {
      notifyError(e);
    }
  };


  return (
    <Modal opened onClose={closeTx} title={<Text fw={700}>{editId ? 'Editar movimiento' : 'Nuevo movimiento'}</Text>} size="lg" fullScreen={window.innerWidth < 600}>
      {editId && existing.isLoading ? (
        <Loader />
      ) : (
        <Stack gap="sm">
          {tx?.status === 'pending' && (
            <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
              Movimiento recurrente pendiente. Revisá el monto real y confirmalo para que cuente en los totales.
            </Alert>
          )}
          {readOnly && <Alert color="gray">Este movimiento está en una cuenta privada o de solo lectura.</Alert>}
          {tx?.installment_plan_id && <Alert color="blue">Cuota {tx.installment_number} de una compra en cuotas. Los cambios afectan solo a esta cuota.</Alert>}

          <SegmentedControl
            fullWidth
            disabled={!!editId}
            value={form.type}
            onChange={(v) => set('type', v as TxType)}
            data={[
              { value: 'expense', label: 'Gasto' },
              { value: 'income', label: 'Ingreso' },
              { value: 'transfer', label: 'Transferencia' },
              { value: 'adjustment', label: 'Ajuste' },
            ]}
          />

          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <MoneyInput
              label={form.installments ? 'Monto total de la compra' : 'Monto'}
              currency={account?.currency}
              value={form.amount}
              onChange={(v) => set('amount', v)}
              allowNegative={form.type === 'adjustment'}
              description={form.type === 'adjustment' ? 'Negativo para restar del saldo' : undefined}
              required
              data-autofocus
            />
            <DateInput label={form.installments ? 'Fecha de compra' : 'Fecha'} value={form.date} onChange={(v) => v && set('date', v)} valueFormat="DD/MM/YYYY" required />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, xs: form.type === 'transfer' ? 2 : 1 }}>
            <AccountSelect label={form.type === 'transfer' ? 'Desde' : 'Cuenta'} value={form.account_id} onChange={(v) => set('account_id', v)} writableOnly required />
            {form.type === 'transfer' && <AccountSelect label="Hacia" value={form.to_account_id} onChange={(v) => set('to_account_id', v)} required />}
          </SimpleGrid>
          {crossCurrency && (
            <MoneyInput
              label={`Monto recibido en ${toAccount!.currency}`}
              description="Ej: compra de dólares: cuántos dólares entraron."
              currency={toAccount!.currency}
              value={form.to_amount}
              onChange={(v) => set('to_amount', v)}
              required
            />
          )}
          {crossOwner && (
            <Checkbox
              label="Es un pago para saldar deudas entre nosotros"
              description="Si está marcado, reduce lo que uno le debe al otro en Gastos compartidos."
              checked={form.is_settlement}
              onChange={(e) => set('is_settlement', e.currentTarget.checked)}
            />
          )}

          <TextInput
            label="Descripción"
            placeholder="Ej: Supermercado, Alquiler, Sueldo…"
            value={form.description}
            onChange={(e) => set('description', e.currentTarget.value)}
            onBlur={suggest}
          />
          {(form.type === 'expense' || form.type === 'income') && (
            <>
              <CategorySelect label="Categoría" kind={form.type} value={form.category_id} onChange={(v) => set('category_id', v)} placeholder="Elegí una categoría" />
              {suggested && (
                <Text size="xs" c="dimmed" mt={-6}>
                  {suggested}
                </Text>
              )}
            </>
          )}

          {form.type === 'expense' && !editId && (
            <Switch label="Compra en cuotas" checked={form.installments} onChange={(e) => set('installments', e.currentTarget.checked)} />
          )}
          <Collapse in={form.installments && form.type === 'expense' && !editId}>
            <SimpleGrid cols={2}>
              <NumberInput label="Cantidad de cuotas" min={2} max={72} value={form.count} onChange={(v) => set('count', v)} />
              <DateInput label="Primera cuota" description="Mes en que llega el primer resumen" value={form.first_date} onChange={(v) => v && set('first_date', v)} valueFormat="DD/MM/YYYY" />
            </SimpleGrid>
            {Number(form.count) > 1 && toCents(form.amount) > 0 && (
              <Text size="sm" c="dimmed" mt={4}>
                {form.count} cuotas de {money(Math.round(toCents(form.amount) / Number(form.count)), account?.currency)}
              </Text>
            )}
          </Collapse>

          {form.type === 'expense' && (
            <Stack gap={6}>
              <Switch
                label="Gasto compartido"
                description="Se divide entre ustedes y suma a lo que uno le debe al otro (si se pagó con una cuenta personal)."
                checked={form.is_shared}
                onChange={(e) => set('is_shared', e.currentTarget.checked)}
              />
              <Collapse in={form.is_shared}>
                <Stack gap="xs">
                  <SplitEditor
                    method={form.split_method}
                    values={form.split_values}
                    onChange={(m, v) => setForm((f) => ({ ...f, split_method: m, split_values: v }))}
                    users={users}
                    total={toCents(form.amount)}
                    currency={account?.currency}
                    defaultSplit={settings.data?.default_split}
                  />
                  {account?.owner_id === null && <Text size="xs" c="dimmed">Pagado con una cuenta común: se reparte en los totales personales pero no genera deuda.</Text>}
                </Stack>
              </Collapse>
            </Stack>
          )}

          {personalAccount && !form.is_shared && form.type !== 'transfer' && (
            <Switch label="Privado" description="Tu pareja no verá este movimiento." checked={form.is_private} onChange={(e) => set('is_private', e.currentTarget.checked)} />
          )}

          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <TextInput label="Comercio" placeholder="Opcional" value={form.merchant} onChange={(e) => set('merchant', e.currentTarget.value)} />
            <TagsInput label="Etiquetas" placeholder="Ej: vacaciones-2027" data={tags.data ?? []} value={form.tags} onChange={(v) => set('tags', v)} clearable />
          </SimpleGrid>
          <Textarea label="Notas" autosize minRows={1} maxRows={4} value={form.notes} onChange={(e) => set('notes', e.currentTarget.value)} />

          <Group gap="xs">
            <FileButton onChange={setReceipt} accept="image/jpeg,image/png,image/webp,application/pdf">
              {(props) => (
                <Button {...props} variant="default" size="xs" leftSection={<IconPaperclip size={14} />} disabled={readOnly}>
                  {receipt ? receipt.name : tx?.has_receipt ? 'Reemplazar comprobante' : 'Adjuntar comprobante'}
                </Button>
              )}
            </FileButton>
            {tx?.has_receipt && (
              <>
                <Anchor size="xs" href={`/api/transactions/${tx.id}/receipt`} target="_blank" rel="noopener">
                  Ver comprobante
                </Anchor>
                <Anchor size="xs" c="red" onClick={removeReceipt}>
                  Quitar
                </Anchor>
              </>
            )}
          </Group>

          <Group justify="space-between" mt="sm">
            <Group gap="xs">
              {editId && !readOnly && (
                <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => remove(false)}>
                  Eliminar
                </Button>
              )}
              {editId && tx?.installment_plan_id && !readOnly && (
                <Button variant="subtle" color="red" onClick={() => remove(true)}>
                  Eliminar todas las cuotas
                </Button>
              )}
            </Group>
            <Group gap="xs">
              <Button variant="default" onClick={closeTx}>
                Cancelar
              </Button>
              {tx?.status === 'pending' ? (
                <Button onClick={confirmPending} loading={saving} color="teal" disabled={readOnly}>
                  Confirmar
                </Button>
              ) : (
                <Button onClick={save} loading={saving} disabled={readOnly}>
                  Guardar
                </Button>
              )}
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
