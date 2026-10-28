import { useEffect, useRef, useState } from 'react';
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
import { IconAlertCircle, IconFileImport, IconPaperclip, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApp } from '../lib/app-state';
import { fromCents, money, toCents, today } from '../lib/format';
import { compressImage } from '../lib/image';
import { errorFields, FieldError, notifyError, notifyOk, useAccounts, useRefreshData, useSettings, useTags } from '../lib/queries';
import type { SplitMethod, Tx, TxType } from '../lib/types';
import { AccountSelect, CategorySelect, MoneyInput } from './inputs';
import { SplitEditor, splitProblem } from './SplitEditor';
import { CsvImportModal } from './CsvImportModal';

type Form = {
  type: TxType;
  date: string;
  amount: number | string;
  account_id: number | null;
  to_account_id: number | null;
  to_amount: number | string;
  /** Pesos per dollar for a conversion between an ARS and a USD account. */
  rate: number | string;
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
  rate: '',
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

/** Pesos per dollar implied by a conversion, whichever way it goes. */
function impliedRate(fromCurrency: string, amount: number, toAmount: number): number {
  const ars = fromCurrency === 'ARS' ? amount : toAmount;
  const usd = fromCurrency === 'ARS' ? toAmount : amount;
  return usd ? Math.round((ars / usd) * 100) / 100 : 0;
}

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
    rate: t.to_amount ? impliedRate(t.currency, t.amount, t.to_amount) : '',
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
  const [form, setForm] = useState<Form>(() => ({
    ...empty(txModal?.type ?? 'expense', txModal?.accountId ?? null),
    installments: !!txModal?.installments,
    amount: txModal?.prefill?.amount ?? '',
    to_account_id: txModal?.prefill?.toAccountId ?? null,
    to_amount: '',
    description: txModal?.prefill?.description ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [bad, setBad] = useState<Set<string>>(new Set());
  // From Pendientes: what this movement pays, and why it's partial when it's less.
  const pending = !editId ? txModal?.pending : undefined;
  const [reason, setReason] = useState('');
  const clearBad = (field: string) =>
    setBad((b) => {
      if (!b.has(field)) return b;
      const next = new Set(b);
      next.delete(field);
      return next;
    });
  const fail = (e: unknown) => {
    setBad(new Set(errorFields(e)));
    notifyError(e);
  };

  useEffect(() => {
    if (existing.data) setForm(fromTx(existing.data));
  }, [existing.data]);

  // Default account: the first writable personal account, else the first joint one.
  useEffect(() => {
    if (editId || form.account_id || !accounts.data?.length) return;
    const mine = accounts.data.find((a) => a.owner_id === me.id && !a.archived) ?? accounts.data.find((a) => a.owner_id === null && !a.archived);
    if (mine) setForm((f) => ({ ...f, account_id: mine.id }));
  }, [accounts.data, editId, form.account_id, me.id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    clearBad(k === 'date' ? 'purchase_date' : k);
    clearBad(k);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const splittable = form.type === 'expense' || form.type === 'income';
  // Purchases and sales in installments: expense cuotas are committed spending, income cuotas are pending until collected.
  const inCuotas = form.installments && splittable && !editId;
  const account = accounts.data?.find((a) => a.id === form.account_id);
  const toAccount = accounts.data?.find((a) => a.id === form.to_account_id);
  const crossCurrency = form.type === 'transfer' && account && toAccount && account.currency !== toAccount.currency;
  const fromArs = account?.currency === 'ARS';
  const latestFx = useQuery({ queryKey: ['fx', 'latest'], queryFn: () => api.get<{ latest: { date: string; sell: number; buy: number } | null }>('/fx?from=9999-01-01'), enabled: !!crossCurrency });
  // The amount received is never typed: it follows from the amount sent and the rate.
  const received = (amount: number | string, rate: number | string) => {
    const a = Number(amount);
    const r = Number(rate);
    if (!a || !r) return '';
    return Math.round((fromArs ? a / r : a * r) * 100) / 100;
  };
  // A known amount to receive (e.g. USD 200 to save, from Pendientes): the amount sent follows the rate until you type it.
  const [target, setTarget] = useState(Number(txModal?.prefill?.toAmount) || 0);
  const sentFor = (want: number, rate: number | string) => (Number(rate) ? Math.round((fromArs ? want * Number(rate) : want / Number(rate)) * 100) / 100 : '');
  const setRate = (rate: number | string) =>
    setForm((f) => {
      const amount = target ? sentFor(target, rate) || f.amount : f.amount;
      return { ...f, rate, amount, to_amount: received(amount, rate) };
    });
  // Start conversions at today's BNA rate: sell when buying dollars, buy when selling them.
  const rateStarted = useRef(false);
  useEffect(() => {
    const fx = latestFx.data?.latest;
    if (!crossCurrency) rateStarted.current = false;
    if (!crossCurrency || !fx || rateStarted.current) return;
    rateStarted.current = true;
    if (form.rate === '') setRate(fromArs ? fx.sell : fx.buy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossCurrency, latestFx.data, fromArs]);
  // Swapping the accounts flips the conversion; an edit keeps its stored amount until something changes.
  useEffect(() => {
    if (crossCurrency && !editId) setForm((f) => ({ ...f, to_amount: received(f.amount, f.rate) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossCurrency, fromArs, form.to_account_id]);
  // What the movement counts for the pending item: the dollars a conversion delivers, else its amount.
  const pendingValue = pending ? toCents(pending.kind === 'savings' && crossCurrency ? form.to_amount : form.amount) : 0;
  const pendingPartial = !!pending && pendingValue > 0 && pendingValue < pending.remaining;
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
    if (!toCents(form.amount) || (form.type !== 'adjustment' && toCents(form.amount) < 0)) return fail(new FieldError('Ingresá el monto.', ['amount']));
    if (!form.account_id) return fail(new FieldError('Elegí una cuenta.', ['account_id']));
    if (form.type === 'transfer' && !form.to_account_id) return fail(new FieldError('Elegí la cuenta destino.', ['to_account_id']));
    if (crossCurrency && !(toCents(form.to_amount) > 0)) return fail(new FieldError('Indicá el tipo de cambio.', ['rate']));
    const splitIssue = splittable && form.is_shared ? splitProblem(form.split_method, form.split_values, users, toCents(form.amount), account?.currency) : null;
    if (splitIssue) return fail(new FieldError(splitIssue, ['split']));
    if (pendingPartial && !reason.trim()) return fail(new FieldError(pending!.kind === 'collect' ? 'Es un cobro parcial: escribí por qué no se cobró todo.' : 'Es un pago parcial: escribí por qué no se pagó todo.', ['reason']));
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
        is_shared: splittable && form.is_shared,
        split: splittable ? splitPayload() : null,
        is_private: form.is_private,
      };
      let id = editId;
      if (inCuotas) {
        await api.post('/transactions/installments', { ...base, type: form.type, count: Number(form.count), purchase_date: form.date, first_date: form.first_date });
        notifyOk(form.type === 'income' ? `Cobro en ${form.count} cuotas registrado: confirmá cada cuota cuando la cobres` : `Compra en ${form.count} cuotas registrada`);
      } else {
        const body = {
          ...base,
          type: form.type,
          to_account_id: form.type === 'transfer' ? form.to_account_id : null,
          to_amount: crossCurrency ? toCents(form.to_amount) : null,
          is_settlement: crossOwner ? form.is_settlement : null,
          status: tx?.status,
          // Linked to the Pendientes item in the same save: nothing is saved if it can't count.
          ...(pending ? { pending: { source: pending.source, id: pending.id, reason: pendingPartial ? reason.trim() : null } } : {}),
        };
        const saved = editId ? await api.put<Tx>(`/transactions/${editId}`, body) : await api.post<Tx>('/transactions', body);
        id = saved.id;
        notifyOk(editId ? 'Movimiento actualizado' : pending ? `Registrado en «${pending.title}»` : 'Movimiento guardado');
      }
      if (receipt && id) {
        const blob = await compressImage(receipt);
        await api.upload(`/transactions/${id}/receipt`, blob, 'file', receipt.type === 'application/pdf' ? receipt.name : 'comprobante.jpg');
      }
      refresh();
      closeTx();
    } catch (e) {
      fail(e);
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
      fail(e);
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
          {tx?.installment_plan_id && (
            <Alert color="blue">
              Cuota {tx.installment_number} de {tx.type === 'income' ? 'un cobro' : 'una compra'} en cuotas. Los cambios afectan solo a esta cuota.
            </Alert>
          )}

          {pending && (
            <div className="pfd-tx-pending">
              <Text size="sm">
                Para <b>{pending.title}</b> · faltan <b className="num">{money(pending.remaining, pending.currency)}</b>
              </Text>
            </div>
          )}
          {!editId && !pending && (
            <Group justify="flex-end" mb={-6}>
              <Button variant="subtle" size="compact-xs" leftSection={<IconFileImport size={14} />} onClick={() => setCsvOpen(true)}>
                Importar CSV
              </Button>
            </Group>
          )}
          <SegmentedControl
            fullWidth
            disabled={!!editId}
            value={form.type}
            onChange={(v) => set('type', v as TxType)}
            data={[
              { value: 'expense', label: 'Gasto' },
              { value: 'income', label: 'Ingreso' },
              { value: 'transfer', label: 'Transf. propia' },
              { value: 'adjustment', label: 'Ajuste' },
            ]}
          />

          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <MoneyInput
              label={inCuotas ? (form.type === 'income' ? 'Monto total a cobrar' : 'Monto total de la compra') : 'Monto'}
              currency={account?.currency}
              value={form.amount}
              onChange={(v) => {
                set('amount', v);
                setTarget(0);
                if (crossCurrency) setForm((f) => ({ ...f, amount: v, to_amount: received(v, f.rate) }));
              }}
              allowNegative={form.type === 'adjustment'}
              description={form.type === 'adjustment' ? 'Negativo para restar del saldo' : undefined}
              required
              data-autofocus
              error={bad.has('amount')}
            />
            <DateInput
              label={inCuotas ? (form.type === 'income' ? 'Fecha de venta' : 'Fecha de compra') : 'Fecha'}
              value={form.date}
              onChange={(v) => v && set('date', v)}
              valueFormat="DD/MM/YYYY"
              required
              error={bad.has('date') || bad.has('purchase_date')}
            />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, xs: form.type === 'transfer' ? 2 : 1 }}>
            <AccountSelect label={form.type === 'transfer' ? 'Desde' : 'Cuenta'} value={form.account_id} onChange={(v) => set('account_id', v)} writableOnly required error={bad.has('account_id')} />
            {form.type === 'transfer' && <AccountSelect label="Hacia" value={form.to_account_id} onChange={(v) => set('to_account_id', v)} required error={bad.has('to_account_id')} />}
          </SimpleGrid>
          {crossCurrency && (
            <SimpleGrid cols={{ base: 1, xs: 2 }}>
              <NumberInput
                label="Tipo de cambio"
                description={latestFx.data?.latest ? `Pesos por dólar. BNA vendedor: $ ${latestFx.data.latest.sell.toLocaleString('es-AR')}` : 'Pesos por dólar'}
                prefix="$ "
                decimalSeparator=","
                thousandSeparator="."
                decimalScale={2}
                hideControls
                value={form.rate}
                onChange={(v) => {
                  clearBad('rate');
                  setRate(v);
                }}
                error={bad.has('rate') || bad.has('to_amount')}
              />
              <div className="pfd-received">
                <Text size="sm" fw={500}>
                  Monto recibido en {toAccount!.currency}
                </Text>
                <Text size="xs" c="dimmed">
                  Sale del monto y el tipo de cambio
                </Text>
                <Text className="num" fw={700} size="lg" mt={4}>
                  {toCents(form.to_amount) > 0 ? money(toCents(form.to_amount), toAccount!.currency) : '—'}
                </Text>
              </div>
            </SimpleGrid>
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
            error={bad.has('description')}
          />
          {(form.type === 'expense' || form.type === 'income') && (
            <>
              <CategorySelect
                label="Categoría"
                kind={form.type}
                value={form.category_id}
                onChange={(v) => set('category_id', v)}
                placeholder="Elegí una categoría"
                error={bad.has('category_id')}
              />
              {suggested && (
                <Text size="xs" c="dimmed" mt={-6}>
                  {suggested}
                </Text>
              )}
            </>
          )}

          {pendingPartial && (
            <Textarea
              label={pending!.kind === 'collect' ? '¿Por qué es un cobro parcial?' : '¿Por qué es un pago parcial?'}
              description={`Faltan ${money(pending!.remaining - pendingValue, pending!.currency)}: ${pending!.source === 'loan' ? 'siguen pendientes.' : 'pasan al mes siguiente.'}`}
              autosize
              minRows={2}
              required
              value={reason}
              onChange={(e) => {
                clearBad('reason');
                setReason(e.currentTarget.value);
              }}
              error={bad.has('reason')}
            />
          )}

          {splittable && !editId && !pending && (
            <Switch
              label={form.type === 'income' ? 'Cobro en cuotas' : 'Compra en cuotas'}
              description={form.type === 'income' ? 'Cada cuota queda pendiente hasta que confirmes que la cobraste.' : undefined}
              checked={form.installments}
              onChange={(e) => set('installments', e.currentTarget.checked)}
            />
          )}
          <Collapse in={inCuotas}>
            <SimpleGrid cols={2}>
              <NumberInput label="Cantidad de cuotas" min={2} max={72} value={form.count} onChange={(v) => set('count', v)} error={bad.has('count')} />
              <DateInput
                label={form.type === 'income' ? 'Primer cobro' : 'Primera cuota'}
                description={form.type === 'income' ? 'Las demás vencen el mismo día de cada mes' : 'Mes en que llega el primer resumen'}
                value={form.first_date}
                onChange={(v) => v && set('first_date', v)}
                valueFormat="DD/MM/YYYY"
              />
            </SimpleGrid>
            {Number(form.count) > 1 && toCents(form.amount) > 0 && (
              <Text size="sm" c="dimmed" mt={4}>
                {form.count} cuotas de {money(Math.round(toCents(form.amount) / Number(form.count)), account?.currency)}
              </Text>
            )}
          </Collapse>

          {splittable && (
            <Stack gap={6}>
              <Switch
                label={form.type === 'income' ? 'Ingreso compartido' : 'Gasto compartido'}
                description={
                  form.type === 'income'
                    ? 'Es de los dos: se reparte y, si entró a una cuenta personal, quien lo recibió le debe su parte al otro.'
                    : 'Se divide entre ustedes y suma a lo que uno le debe al otro (si se pagó con una cuenta personal).'
                }
                checked={form.is_shared}
                onChange={(e) => set('is_shared', e.currentTarget.checked)}
              />
              <Collapse in={form.is_shared}>
                <Stack gap="xs">
                  <SplitEditor
                    method={form.split_method}
                    values={form.split_values}
                    onChange={(m, v) => {
                      clearBad('split');
                      setForm((f) => ({ ...f, split_method: m, split_values: v }));
                    }}
                    users={users}
                    total={toCents(form.amount)}
                    currency={account?.currency}
                    defaultSplit={settings.data?.default_split}
                    invalid={bad.has('split')}
                  />
                  {account?.owner_id === null && (
                    <Text size="xs" c="dimmed">
                      {form.type === 'income' ? 'Entró a una cuenta común' : 'Pagado con una cuenta común'}: se reparte en los totales personales pero no genera deuda.
                    </Text>
                  )}
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
      {csvOpen && <CsvImportModal onClose={() => setCsvOpen(false)} onDone={() => { setCsvOpen(false); closeTx(); }} />}
    </Modal>
  );
}
