/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { coreDb, currentProfileId, db, getSetting, withDb, type DB } from '../db/index.js';
import { logAction, type AuditChange, type AuditDetails, type AuditInput, type AuditSection } from './audit.js';
import { formatMoney, type Currency } from './money.js';
import { getTx, fetchTxs, loadAccounts, loadCategories, loadUsers, parseScope, scopeUserId, txVisibility, type Account, type Category, type Tx } from './domain.js';
import { monthLabel } from './dates.js';
import { presentLoan, type LoanRow, type ReturnRow } from './loans.js';
import { pendingItems } from './commitments.js';
import { activeSmtp } from './mail.js';
import { getProfile, profileDb } from './profiles.js';
import { RULE_CATALOG } from './rule-catalog.js';
import { undoneAuditIds } from './undo.js';

// Turns each mutating API request into an Actividad entry, without touching the routes: a
// preHandler hook loads a "before" snapshot when an edit or delete needs one, onSend reads the
// response and the new state, and the descriptor for the route writes a short Spanish line.
// Only requests that succeed (2xx) are logged. Request bodies are never stored: every
// descriptor picks the fields it shows. A mutating route without a descriptor still gets a
// generic entry, so nothing is missed silently (and a test fails until it gets a real one).

export type AuditCtx = {
  userId: number;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: any;
  res: any;
  before: any;
};

type Entry = Omit<AuditInput, 'userId' | 'section'> & { section?: AuditSection; userId?: number | null };

type Descriptor = {
  section: AuditSection;
  /** Not tied to a data profile (logins, profiles, personal settings, the sending account). */
  global?: boolean;
  before?: (c: AuditCtx) => unknown;
  describe: (c: AuditCtx) => Entry | Entry[] | null;
};
type Skip = { skip: string };
type Manual = { manual: string };

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ---- Formatting helpers ----

const money = (cents: number | null | undefined, cur: Currency | string | null | undefined) => (cents == null ? '—' : formatMoney(cents, cur === 'USD' ? 'USD' : 'ARS'));
const fdate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const yes = (v: unknown) => (v ? 'Sí' : 'No');
const q = (s: string | null | undefined) => (s ? `«${s}»` : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
const pctText = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')}%`;
const clip = (s: string | null | undefined, n = 160) => (!s ? '' : s.length > n ? `${s.slice(0, n)}…` : s);

const TX_NOUN: Record<Tx['type'], [string, string]> = {
  expense: ['un', 'gasto'],
  income: ['un', 'ingreso'],
  transfer: ['una', 'transferencia'],
  adjustment: ['un', 'ajuste de saldo'],
};
const ACCOUNT_TYPE: Record<string, string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  credit_card: 'Tarjeta de crédito',
  savings: 'Ahorro',
  investment: 'Inversión',
  wallet: 'Billetera virtual',
};
const FX_SIDE: Record<string, string> = { sell: 'Vendedor', buy: 'Comprador', avg: 'Promedio' };
const FREQ: Record<string, [string, string]> = { weekly: ['semana', 'semanas'], monthly: ['mes', 'meses'], yearly: ['año', 'años'] };
const MATCH: Record<string, string> = { contains: 'contiene', starts_with: 'empieza con', equals: 'es igual a', regex: 'coincide con' };
const PRIORITY: Record<string, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };

function userName(id: number | null | undefined): string {
  if (id == null) return 'Común';
  const row = coreDb().prepare('SELECT display_name FROM users WHERE id = ?').get(id) as { display_name: string } | undefined;
  return row?.display_name ?? `Usuario ${id}`;
}

function scopeLabel(scope: string | null | undefined): string {
  const s = parseScope(scope);
  if (!s) return '—';
  const uid = scopeUserId(s);
  return uid === null ? 'Hogar' : userName(uid);
}

/** Personal dashboards that their owner hides are private to that person. */
function scopePrivacy(scope: string | null | undefined): number | null {
  const s = parseScope(scope);
  const uid = s ? scopeUserId(s) : null;
  if (uid === null) return null;
  const u = loadUsers().find((x) => x.id === uid);
  return u && !u.share_dashboard ? uid : null;
}

function catPath(cats: Map<number, Category>, id: number | null | undefined): string {
  if (id == null) return 'Sin categoría';
  const c = cats.get(id);
  if (!c) return 'Categoría borrada';
  const parent = c.parent_id != null ? cats.get(c.parent_id) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Field-by-field differences, using the labels and formatters given. */
function diff(before: Record<string, any> | null | undefined, after: Record<string, any> | null | undefined, fields: [key: string, label: string, fmt?: (v: any) => string][]): AuditChange[] {
  if (!before || !after) return [];
  const out: AuditChange[] = [];
  for (const [key, label, fmt] of fields) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    const show = fmt ?? ((v: any) => (v == null || v === '' ? '—' : String(v)));
    out.push({ field: label, from: show(a), to: show(b) });
  }
  return out;
}

/** "Monto: $ 5.000 → $ 6.000" for one change, "Monto, Categoría" for several. */
function changeText(changes: AuditChange[]): string {
  if (!changes.length) return '';
  if (changes.length === 1) {
    const [c] = changes;
    return c.from.length + c.to.length <= 70 ? `${c.field}: ${c.from} → ${c.to}` : c.field;
  }
  return changes.map((c) => c.field).join(', ');
}

// ---- Movements: summary lines and privacy ----

type Privacy = { privateTo: number | null; mask: Set<number>; publicOk: boolean };

const privateAccount = (a: Account | undefined) => !!a && a.owner_id !== null && !!a.is_private;

/** Who may see a movement's entry: the owner of a private side; others only what they see of it. */
function txPrivacy(tx: Tx, accounts: Map<number, Account>): Privacy {
  const mask = new Set<number>();
  let privateTo: number | null = null;
  for (const id of [tx.account_id, tx.to_account_id]) {
    const a = id == null ? undefined : accounts.get(id);
    if (privateAccount(a)) {
      mask.add(a!.id);
      privateTo ??= a!.owner_id;
    }
  }
  const owner = accounts.get(tx.account_id)?.owner_id ?? null;
  if (tx.is_private && owner !== null) privateTo ??= owner;
  if (privateTo === null) return { privateTo: null, mask, publicOk: true };
  const others = loadUsers().filter((u) => u.id !== privateTo);
  const publicOk = !tx.is_private && others.some((u) => txVisibility(tx, u.id, accounts) !== 'hidden');
  return { privateTo, mask, publicOk };
}

function accLabel(accounts: Map<number, Account>, id: number | null | undefined, mask: Set<number>): string {
  if (id == null) return '—';
  if (mask.has(id)) return 'cuenta privada';
  return accounts.get(id)?.name ?? 'cuenta borrada';
}

/** "gasto de $ 5.000 «Coto» · Supermercado › Almacén · Santander Iván" */
function txLine(tx: Tx, accounts: Map<number, Account>, cats: Map<number, Category>, mask: Set<number>, opts: { article?: boolean } = {}): string {
  const [art, noun] = TX_NOUN[tx.type];
  const head = `${opts.article ? `${art} ` : ''}${noun} de ${money(tx.amount, tx.currency)}${tx.description ? ` ${q(tx.description)}` : ''}`;
  const parts = [head];
  if (tx.type === 'expense' || tx.type === 'income') parts.push(catPath(cats, tx.category_id));
  if (tx.type === 'transfer') {
    const to = accLabel(accounts, tx.to_account_id, mask);
    const recv = tx.to_amount != null && tx.to_account_id != null ? ` (${money(tx.to_amount, accounts.get(tx.to_account_id)?.currency)})` : '';
    parts.push(`${accLabel(accounts, tx.account_id, mask)} → ${to}${recv}`);
  } else {
    parts.push(accLabel(accounts, tx.account_id, mask));
  }
  if (tx.is_shared) parts.push('compartido');
  if (tx.status === 'pending') parts.push('pendiente');
  return parts.join(' · ');
}

const splitText = (tx: Tx | null | undefined) =>
  !tx?.is_shared ? 'No' : tx.splits.map((s) => `${userName(s.user_id)} ${money(s.amount, tx.currency)}`).join(' / ') || 'Sí';

function txChanges(before: Tx, after: Tx, accounts: Map<number, Account>, cats: Map<number, Category>, mask: Set<number>): AuditChange[] {
  const cur = (t: Tx) => t.currency;
  const view = (t: Tx) => ({
    type: TX_NOUN[t.type][1],
    status: t.status === 'pending' ? 'Pendiente' : 'Confirmado',
    date: fdate(t.date),
    amount: money(t.amount, cur(t)),
    account: accLabel(accounts, t.account_id, mask),
    to_account: accLabel(accounts, t.to_account_id, mask),
    to_amount: t.to_amount == null ? '—' : money(t.to_amount, accounts.get(t.to_account_id ?? -1)?.currency),
    category: t.type === 'expense' || t.type === 'income' ? catPath(cats, t.category_id) : '—',
    description: t.description || '—',
    merchant: t.merchant || '—',
    notes: clip(t.notes) || '—',
    tags: (JSON.parse(t.tags || '[]') as string[]).join(', ') || '—',
    split: splitText(t),
    is_private: yes(t.is_private),
    is_settlement: yes(t.is_settlement),
  });
  return diff(view(before), view(after), [
    ['type', 'Tipo'],
    ['status', 'Estado'],
    ['date', 'Fecha'],
    ['amount', 'Monto'],
    ['account', 'Cuenta'],
    ['to_account', 'Cuenta destino'],
    ['to_amount', 'Monto recibido'],
    ['category', 'Categoría'],
    ['description', 'Descripción'],
    ['merchant', 'Comercio'],
    ['notes', 'Notas'],
    ['tags', 'Etiquetas'],
    ['split', 'División'],
    ['is_private', 'Privado'],
    ['is_settlement', 'Saldar deudas'],
  ]);
}

/** An entry about one movement, with the public version (private accounts hidden) when others can see it. */
function txEntry(tx: Tx, build: (mask: Set<number>) => { summary: string; details?: AuditDetails }, rest: Partial<Entry> = {}): Entry {
  const accounts = loadAccounts();
  const p = txPrivacy(tx, accounts);
  const full = build(new Set());
  const details: AuditDetails = { ...(full.details ?? {}) };
  if (p.privateTo !== null && p.publicOk) {
    const pub = build(p.mask);
    details.public = { summary: pub.summary, details: pub.details };
  }
  return { action: 'editar', entity: 'transaction', entityId: tx.id, ...rest, summary: full.summary, details, privateTo: p.privateTo };
}

const txFacts = (tx: Tx, accounts: Map<number, Account>, mask: Set<number>) => {
  const facts = [
    { label: 'Fecha', value: fdate(tx.date) },
    { label: 'Cuenta', value: accLabel(accounts, tx.account_id, mask) },
  ];
  if (tx.is_shared) facts.push({ label: 'División', value: splitText(tx) });
  if (tx.merchant) facts.push({ label: 'Comercio', value: tx.merchant });
  return facts;
};

const ctxTx = () => ({ accounts: loadAccounts(), cats: loadCategories() });

/** Several movements (bulk actions, CSV uploads): one entry for what everyone sees, one per private owner. */
function txGroupEntries(txs: Tx[], summaryFor: (n: number) => string, rest: Partial<Entry>): Entry[] {
  const { accounts, cats } = ctxTx();
  const groups = new Map<number | null, Tx[]>();
  for (const t of txs) {
    const p = txPrivacy(t, accounts);
    const key = p.privateTo !== null && !p.publicOk ? p.privateTo : null;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: Entry[] = [];
  for (const [privateTo, list] of groups) {
    if (!list.length) continue;
    const items = list.map((t) => {
      const p = txPrivacy(t, accounts);
      return `${fdate(t.date)} · ${txLine(t, accounts, cats, privateTo === null ? p.mask : new Set())}`;
    });
    out.push({ action: 'editar', ...rest, summary: summaryFor(list.length), details: { items }, privateTo });
  }
  return out;
}

// ---- Loaders for "before" snapshots ----

const id = (c: AuditCtx, key = 'id') => Number(c.params[key]);
const row = <T>(sql: string, ...args: unknown[]) => db().prepare(sql).get(...args) as T | undefined;
const accountRow = (accId: number) => loadAccounts().get(accId);

function accountView(a: Account | undefined) {
  if (!a) return null;
  return {
    name: a.name,
    type: ACCOUNT_TYPE[a.type] ?? a.type,
    currency: a.currency,
    owner: userName(a.owner_id),
    is_private: yes(a.is_private),
    opening_balance: money(a.opening_balance, a.currency),
    archived: yes(a.archived),
    color: a.color ?? '—',
    sort: String(a.sort),
  };
}

const settingsSnapshot = () => ({
  household_name: getSetting<string>('household_name'),
  default_split: getSetting<Record<string, number>>('default_split'),
  fx_side: getSetting<string>('fx_side'),
  budget_thresholds: getSetting<number[]>('budget_thresholds'),
  budget_indexing: getSetting<boolean>('budget_indexing'),
  hide_cents: getSetting<Record<string, boolean>>('hide_cents'),
});

function settingsView(s: ReturnType<typeof settingsSnapshot>) {
  const split = Object.entries(s.default_split ?? {}).filter(([, v]) => v > 0);
  return {
    household_name: s.household_name,
    default_split: split.length ? split.map(([uid, v]) => `${userName(Number(uid))} ${pctText(v)}`).join(' · ') : 'Partes iguales',
    fx_side: FX_SIDE[s.fx_side] ?? s.fx_side,
    budget_thresholds: (s.budget_thresholds ?? []).map((v) => `${v}%`).join(', ') || '—',
    budget_indexing: yes(s.budget_indexing),
    hide_ars: yes(s.hide_cents?.ARS),
    hide_usd: yes(s.hide_cents?.USD),
  };
}

const meSnapshot = (userId: number) =>
  coreDb().prepare('SELECT display_name, color, share_dashboard, email, telegram_chat_id, notify_budget, notify_recurring, notify_review FROM users WHERE id = ?').get(userId) as
    | Record<string, any>
    | undefined;

const meView = (u: Record<string, any> | undefined) =>
  u && {
    display_name: u.display_name,
    color: u.color,
    share_dashboard: yes(u.share_dashboard),
    // Contact details are personal: only whether there is one, never the value.
    email: u.email ? 'Cargado' : 'Sin correo',
    telegram: u.telegram_chat_id ? 'Vinculado' : 'Sin vincular',
    notify_budget: yes(u.notify_budget),
    notify_recurring: yes(u.notify_recurring),
    notify_review: yes(u.notify_review),
  };

const mailView = () => {
  const a = activeSmtp();
  if (!a) return null;
  const { host, port, user, from } = a.settings;
  return { host, port: String(port), user, from: from || '—' };
};

const categoryRow = (catId: number) => row<Category & { kind: string }>('SELECT * FROM categories WHERE id = ?', catId);

type RuleRow = Record<string, any> & { id: number; name: string };
const ruleRow = (ruleId: number) => row<RuleRow>('SELECT * FROM rules WHERE id = ?', ruleId);
function ruleView(r: RuleRow | undefined) {
  if (!r) return null;
  const cats = loadCategories();
  const accounts = loadAccounts();
  const tags = r.set_tags ? (JSON.parse(r.set_tags) as string[]) : [];
  return {
    name: r.name,
    priority: String(r.priority),
    condition: `${MATCH[r.match_type] ?? r.match_type} ${q(r.pattern)}`,
    account: r.account_id ? (accounts.get(r.account_id)?.name ?? '—') : 'Cualquiera',
    amount_min: r.amount_min == null ? '—' : String(r.amount_min / 100).replace('.', ','),
    amount_max: r.amount_max == null ? '—' : String(r.amount_max / 100).replace('.', ','),
    set_type: r.set_type ? TX_NOUN[r.set_type as Tx['type']]?.[1] ?? r.set_type : '—',
    set_category: r.set_category_id ? catPath(cats, r.set_category_id) : '—',
    set_merchant: r.set_merchant || '—',
    set_to_account: r.set_to_account_id ? (accounts.get(r.set_to_account_id)?.name ?? '—') : '—',
    set_shared: r.set_shared == null ? '—' : yes(r.set_shared),
    set_tags: tags.join(', ') || '—',
    active: yes(r.active),
  };
}
const RULE_FIELDS: [string, string][] = [
  ['name', 'Nombre'],
  ['priority', 'Prioridad'],
  ['condition', 'Condición'],
  ['account', 'Cuenta'],
  ['amount_min', 'Monto mínimo'],
  ['amount_max', 'Monto máximo'],
  ['set_type', 'Tipo'],
  ['set_category', 'Categoría'],
  ['set_merchant', 'Comercio'],
  ['set_to_account', 'Cuenta destino'],
  ['set_shared', 'Compartido'],
  ['set_tags', 'Etiquetas'],
  ['active', 'Activa'],
];

type RecurringRow = Record<string, any> & { id: number; description: string; amount: number; account_id: number; is_private: number };
const recurringRow = (recId: number) => row<RecurringRow>('SELECT * FROM recurring WHERE id = ?', recId);
function recurringPrivacy(r: RecurringRow | undefined): number | null {
  if (!r) return null;
  const a = accountRow(r.account_id);
  if (!a || a.owner_id === null) return null;
  return a.is_private || r.is_private ? a.owner_id : null;
}
function recurringView(r: RecurringRow | undefined) {
  if (!r) return null;
  const a = accountRow(r.account_id);
  const [one, many] = FREQ[r.frequency] ?? [r.frequency, r.frequency];
  return {
    description: r.description,
    type: r.type === 'income' ? 'Ingreso' : 'Gasto',
    amount: money(r.amount, a?.currency),
    account: a?.name ?? '—',
    category: catPath(loadCategories(), r.category_id),
    every: r.interval > 1 ? `cada ${r.interval} ${many}` : `por ${one}`,
    next_date: fdate(r.next_date),
    end_date: r.end_date ? fdate(r.end_date) : '—',
    merchant: r.merchant || '—',
    shared: yes(r.is_shared),
    is_private: yes(r.is_private),
    active: yes(r.active),
  };
}
const RECURRING_FIELDS: [string, string][] = [
  ['description', 'Descripción'],
  ['type', 'Tipo'],
  ['amount', 'Monto'],
  ['account', 'Cuenta'],
  ['category', 'Categoría'],
  ['every', 'Frecuencia'],
  ['next_date', 'Próxima fecha'],
  ['end_date', 'Hasta'],
  ['merchant', 'Comercio'],
  ['shared', 'Compartido'],
  ['is_private', 'Privado'],
  ['active', 'Activo'],
];

type GoalRow = Record<string, any> & { id: number; name: string; target_amount: number; currency: Currency; scope: string };
const goalRow = (goalId: number) => row<GoalRow>('SELECT * FROM goals WHERE id = ?', goalId);
function goalView(g: GoalRow | undefined) {
  if (!g) return null;
  return {
    name: g.name,
    target: money(g.target_amount, g.currency),
    deadline: g.deadline ? fdate(g.deadline) : '—',
    account: g.account_id ? (accountRow(g.account_id)?.name ?? '—') : '—',
    scope: scopeLabel(g.scope),
    archived: yes(g.archived),
    url: g.url || '—',
    notes: clip(g.notes) || '—',
    priority: g.priority ? PRIORITY[g.priority] : '—',
    color: g.color || '—',
  };
}
const GOAL_FIELDS: [string, string][] = [
  ['name', 'Nombre'],
  ['target', 'Meta'],
  ['deadline', 'Fecha límite'],
  ['account', 'Cuenta'],
  ['scope', 'Tablero'],
  ['archived', 'Archivado'],
  ['url', 'Enlace'],
  ['notes', 'Notas'],
  ['priority', 'Prioridad'],
  ['color', 'Color'],
];

const loanRow = (loanId: number) => row<LoanRow>('SELECT * FROM loans WHERE id = ?', loanId);
const loanState = (loanId: number) => {
  const loan = loanRow(loanId);
  if (!loan) return null;
  return presentLoan(loan, db().prepare('SELECT * FROM loan_returns WHERE loan_id = ?').all(loanId) as ReturnRow[]);
};
const loanWhat = (l: LoanRow) => (l.kind === 'item' ? q(l.item) : money(l.amount, l.currency));
function loanView(l: LoanRow | null | undefined) {
  if (!l) return null;
  return {
    person: l.person,
    kind: l.kind === 'item' ? 'Objeto' : 'Plata',
    item: l.item || '—',
    amount: l.kind === 'money' ? money(l.amount, l.currency) : '—',
    lent_on: fdate(l.lent_on),
    due_on: l.due_on ? fdate(l.due_on) : '—',
    notes: clip(l.notes) || '—',
  };
}
const LOAN_FIELDS: [string, string][] = [
  ['person', 'Persona'],
  ['kind', 'Tipo'],
  ['item', 'Qué'],
  ['amount', 'Monto'],
  ['lent_on', 'Fecha del préstamo'],
  ['due_on', 'Devolución'],
  ['notes', 'Notas'],
];

type CommitmentRow = Record<string, any> & { id: number; title: string; amount: number; currency: Currency; owner_id: number };
const commitmentRow = (cId: number) => row<CommitmentRow>('SELECT * FROM commitments WHERE id = ?', cId);
function commitmentView(c: CommitmentRow | undefined) {
  if (!c) return null;
  return {
    kind: c.kind === 'savings' ? 'Ahorro' : 'Pago a otra persona',
    title: c.title,
    person: c.person || '—',
    amount: money(c.amount, c.currency),
    account: c.account_id ? (accountRow(c.account_id)?.name ?? '—') : '—',
    day: String(c.day),
    start_month: c.start_month ? monthLabel(c.start_month) : '—',
    months: c.months ? String(c.months) : 'Sin fin',
    active: yes(c.active),
  };
}
const COMMITMENT_FIELDS: [string, string][] = [
  ['kind', 'Tipo'],
  ['title', 'Título'],
  ['person', 'Persona'],
  ['amount', 'Monto'],
  ['account', 'Cuenta'],
  ['day', 'Día'],
  ['start_month', 'Desde'],
  ['months', 'Meses'],
  ['active', 'Activo'],
];
const remainingOf = (userId: number, source: string, itemId: number): number | null => {
  try {
    return pendingItems(userId).find((i) => i.source === source && i.id === itemId)?.remaining ?? null;
  } catch {
    return null;
  }
};

/** Title of the Pendientes item a new movement pays (`pending: { source, id }` in the body). */
function pendingTitle(p: any): string | null {
  if (!p || typeof p !== 'object') return null;
  const pid = Number(p.id);
  if (!Number.isInteger(pid)) return null;
  if (p.source === 'commitment') return commitmentRow(pid)?.title ?? null;
  if (p.source === 'loan') {
    const l = loanRow(pid);
    return l ? `préstamo a ${l.person}` : null;
  }
  return null;
}

const budgetView = (b: { category_id: number; scope: string; amount: number; currency: Currency } | undefined) => b && { amount: money(b.amount, b.currency) };

// ---- Route descriptors ----
// Keys are "METHOD /api/path" exactly as registered (Fastify's route pattern).

const D = (section: AuditSection, d: Omit<Descriptor, 'section'>): Descriptor => ({ section, ...d });

export const AUDIT_ROUTES: Record<string, Descriptor | Skip | Manual> = {
  // ---- Accesos (logins are written by routes/auth.ts itself: the user isn't known before) ----
  'POST /api/auth/setup': { manual: 'routes/auth.ts' },
  'POST /api/auth/login': { manual: 'routes/auth.ts' },
  'POST /api/auth/accounts': { manual: 'routes/auth.ts' },
  'POST /api/auth/switch': { manual: 'routes/auth.ts' },
  'POST /api/auth/logout': { manual: 'routes/auth.ts' },
  'POST /api/auth/password': D('Accesos', {
    global: true,
    describe: () => ({ action: 'contraseña', summary: 'Cambió su contraseña (se cerraron sus otras sesiones)' }),
  }),
  'POST /api/users': D('Accesos', {
    global: true,
    describe: (c) => ({
      action: 'crear',
      entity: 'user',
      entityId: c.res?.id,
      summary: `Agregó a ${userName(c.res?.id)} al hogar (usuario ${String(c.body?.username ?? '').slice(0, 40)})`,
    }),
  }),

  // ---- Ajustes: personal ----
  'PATCH /api/me': D('Ajustes', {
    global: true,
    before: (c) => meView(meSnapshot(c.userId)),
    describe: (c) => {
      const changes = diff(c.before, meView(meSnapshot(c.userId)), [
        ['display_name', 'Nombre'],
        ['color', 'Color'],
        ['share_dashboard', 'Compartir mi tablero'],
        ['email', 'Correo'],
        ['telegram', 'Telegram'],
        ['notify_budget', 'Avisos de presupuesto'],
        ['notify_recurring', 'Avisos de recurrentes'],
        ['notify_review', 'Aviso de cierre de mes'],
      ]);
      if (!changes.length) return null;
      return { action: 'editar', entity: 'user', entityId: c.userId, summary: `Editó su perfil · ${changeText(changes)}`, details: { changes }, privateTo: c.userId };
    },
  }),
  'POST /api/me/email/test': { skip: 'Sends a test email; changes nothing.' },
  'POST /api/me/telegram/code': { skip: 'Only creates a short-lived link code.' },
  'POST /api/me/telegram/verify': D('Ajustes', {
    global: true,
    describe: (c) => ({ action: 'conectar', entity: 'user', entityId: c.userId, summary: 'Vinculó su Telegram para recibir avisos', privateTo: c.userId }),
  }),
  'POST /api/me/telegram/test': { skip: 'Sends a test message; changes nothing.' },

  // ---- Ajustes: the sending account (shared) ----
  'PUT /api/mail/settings': D('Ajustes', {
    global: true,
    before: () => mailView(),
    describe: (c) => {
      const after = mailView();
      const changes = diff(c.before ?? {}, after, [
        ['host', 'Servidor'],
        ['port', 'Puerto'],
        ['user', 'Cuenta'],
        ['from', 'Remitente'],
      ]);
      // The password itself is never stored here, only that a new one was typed.
      if (typeof c.body?.pass === 'string' && c.body.pass.trim()) changes.push({ field: 'Contraseña de aplicación', from: '••••', to: 'nueva' });
      return {
        action: c.before ? 'editar' : 'crear',
        entity: 'mail',
        summary: `${c.before ? 'Editó' : 'Configuró'} la cuenta que envía los avisos${after?.user ? `: ${after.user}` : ''}`,
        details: { changes },
      };
    },
  }),
  'DELETE /api/mail/settings': D('Ajustes', {
    global: true,
    before: () => mailView(),
    describe: (c) => ({ action: 'borrar', entity: 'mail', summary: `Borró la cuenta que envía los avisos${c.before?.user ? `: ${c.before.user}` : ''}` }),
  }),
  'POST /api/mail/settings/test': { skip: 'Sends a test email; changes nothing.' },

  // ---- Ajustes: household ----
  'PATCH /api/settings': D('Ajustes', {
    before: () => settingsView(settingsSnapshot()),
    describe: (c) => {
      const changes = diff(c.before, settingsView(settingsSnapshot()), [
        ['household_name', 'Nombre del hogar'],
        ['default_split', 'División por defecto'],
        ['fx_side', 'Cotización'],
        ['budget_thresholds', 'Alertas de presupuesto'],
        ['budget_indexing', 'Indexar presupuestos'],
        ['hide_ars', 'Ocultar centavos (ARS)'],
        ['hide_usd', 'Ocultar centavos (US$)'],
      ]);
      if (!changes.length) return null;
      return { action: 'editar', entity: 'settings', summary: `Editó los ajustes del hogar · ${changeText(changes)}`, details: { changes } };
    },
  }),
  'POST /api/notifications/read': { skip: 'Marks the bell as read; no figures change.' },

  // ---- Cuentas ----
  'POST /api/accounts': D('Cuentas', {
    describe: (c) => {
      const a = accountRow(Number(c.res?.id));
      if (!a) return null;
      const v = accountView(a)!;
      const kind = a.owner_id === null ? 'común' : a.is_private ? 'personal privada' : 'personal';
      return {
        action: 'crear',
        entity: 'account',
        entityId: a.id,
        summary: `Creó la cuenta ${q(a.name)}: ${v.type}, ${a.currency}, ${kind} · saldo inicial ${v.opening_balance}`,
        privateTo: privateAccount(a) ? a.owner_id : null,
      };
    },
  }),
  'PATCH /api/accounts/:id': D('Cuentas', {
    before: (c) => accountRow(id(c)),
    describe: (c) => {
      const before = c.before as Account | undefined;
      const after = accountRow(id(c));
      if (!before || !after) return null;
      const changes = diff(accountView(before), accountView(after), [
        ['name', 'Nombre'],
        ['type', 'Tipo'],
        ['currency', 'Moneda'],
        ['owner', 'Titular'],
        ['is_private', 'Privada'],
        ['opening_balance', 'Saldo inicial'],
        ['archived', 'Archivada'],
        ['color', 'Color'],
        ['sort', 'Orden'],
      ]);
      if (!changes.length) return null;
      const privateTo = privateAccount(before) ? before.owner_id : privateAccount(after) ? after.owner_id : null;
      const archived = changes.length === 1 && changes[0].field === 'Archivada';
      return {
        action: archived ? (after.archived ? 'archivar' : 'desarchivar') : 'editar',
        entity: 'account',
        entityId: after.id,
        summary: archived ? `${after.archived ? 'Archivó' : 'Desarchivó'} la cuenta ${q(after.name)}` : `Editó la cuenta ${q(after.name)} · ${changeText(changes)}`,
        details: { changes },
        privateTo,
      };
    },
  }),
  'DELETE /api/accounts/:id': D('Cuentas', {
    before: (c) => accountRow(id(c)),
    describe: (c) => {
      const a = c.before as Account | undefined;
      if (!a) return null;
      const n = num(c.res?.movements) || 0;
      const withTx = n ? ` con ${n === 1 ? 'su movimiento' : `sus ${n} movimientos`}` : '';
      return { action: 'borrar', entity: 'account', entityId: a.id, summary: `Borró la cuenta ${q(a.name)} (${a.currency})${withTx}`, privateTo: privateAccount(a) ? a.owner_id : null };
    },
  }),

  // ---- Ajustes: categories ----
  'POST /api/categories': D('Ajustes', {
    describe: (c) => {
      const cat = categoryRow(Number(c.res?.id));
      if (!cat) return null;
      return {
        action: 'crear',
        entity: 'category',
        entityId: cat.id,
        summary: `Creó la categoría ${q(catPath(loadCategories(), cat.id))} (${cat.kind === 'income' ? 'ingreso' : 'gasto'})`,
      };
    },
  }),
  'PATCH /api/categories/:id': D('Ajustes', {
    before: (c) => categoryRow(id(c)),
    describe: (c) => {
      const after = categoryRow(id(c));
      if (!c.before || !after) return null;
      const view = (x: Category) => ({ name: x.name, color: x.color ?? '—', icon: x.icon ?? '—', archived: yes(x.archived), sort: String(x.sort) });
      const changes = diff(view(c.before), view(after), [
        ['name', 'Nombre'],
        ['color', 'Color'],
        ['icon', 'Ícono'],
        ['archived', 'Archivada'],
        ['sort', 'Orden'],
      ]);
      if (!changes.length) return null;
      return { action: 'editar', entity: 'category', entityId: after.id, summary: `Editó la categoría ${q(catPath(loadCategories(), after.id))} · ${changeText(changes)}`, details: { changes } };
    },
  }),
  'DELETE /api/categories/:id': D('Ajustes', {
    before: (c) => {
      const cat = categoryRow(id(c));
      if (!cat) return null;
      const used = row<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?', cat.id)?.n ?? 0;
      return { name: catPath(loadCategories(), cat.id), used };
    },
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'category',
        entityId: id(c),
        summary: `Borró la categoría ${q(c.before.name)}${c.before.used ? ` (${c.before.used} movimientos quedaron sin categoría)` : ''}`,
      },
  }),

  // ---- Movimientos ----
  'POST /api/transactions/suggest': { skip: 'Suggests a category while typing; saves nothing.' },
  'POST /api/transactions': D('Movimientos', {
    describe: (c) => {
      const tx = getTx(Number(c.res?.id));
      if (!tx) return null;
      const { accounts, cats } = ctxTx();
      const entry = txEntry(tx, (mask) => ({ summary: `Registró ${txLine(tx, accounts, cats, mask, { article: true })}`, details: { facts: txFacts(tx, accounts, mask) } }), { action: 'crear' });
      // Paid for a Pendientes item in the same request: that item is personal, so only its owner
      // sees which one; everyone else keeps the plain line about the movement.
      const pending = c.body?.pending;
      const title = pendingTitle(pending);
      if (!title) return entry;
      const reason = typeof pending.reason === 'string' && pending.reason.trim() ? ` (parcial: ${q(clip(pending.reason.trim(), 140))})` : '';
      const plain = { summary: entry.summary, details: { facts: entry.details?.facts } };
      entry.summary = `${entry.summary} · para ${q(title)}${reason}`;
      if (entry.privateTo == null) {
        entry.privateTo = c.userId;
        entry.details = { ...(entry.details ?? {}), public: plain };
      }
      return entry;
    },
  }),
  'POST /api/transactions/csv': D('Movimientos', {
    before: () => (row<{ m: number }>('SELECT COALESCE(MAX(id), 0) AS m FROM transactions')?.m ?? 0),
    describe: (c) => {
      if (!c.res?.created) return null;
      const ids = (db().prepare('SELECT id FROM transactions WHERE id > ? AND import_hash IS NOT NULL AND created_by = ?').all(Number(c.before ?? 0), c.userId) as { id: number }[]).map((r) => r.id);
      const created = fetchTxs({ ids });
      return txGroupEntries(created, (n) => `Cargó ${n} ${n === 1 ? 'movimiento' : 'movimientos'} desde un archivo CSV`, { action: 'importar', entity: 'transaction' });
    },
  }),
  'POST /api/transactions/installments': D('Movimientos', {
    describe: (c) => {
      const planId = Number(c.res?.plan_id);
      const plan = row<{ description: string; total_amount: number; count: number; first_date: string }>('SELECT * FROM installment_plans WHERE id = ?', planId);
      const firstId = row<{ id: number }>('SELECT id FROM transactions WHERE installment_plan_id = ? AND installment_number = 1', planId)?.id;
      const first = firstId ? getTx(firstId) : null;
      if (!plan || !first) return null;
      const { accounts, cats } = ctxTx();
      const income = first.type === 'income';
      return txEntry(
        first,
        (mask) => ({
          summary: `Registró ${income ? 'un cobro' : 'una compra'} en ${plan.count} cuotas: ${money(plan.total_amount, first.currency)} ${q(plan.description)} · ${catPath(cats, first.category_id)} · ${accLabel(accounts, first.account_id, mask)}`,
          details: { facts: [{ label: 'Primera cuota', value: `${fdate(plan.first_date)} · ${money(first.amount, first.currency)}` }, ...txFacts(first, accounts, mask).slice(1)] },
        }),
        { action: 'crear', entity: 'installment_plan', entityId: planId },
      );
    },
  }),
  'PUT /api/transactions/:id': D('Movimientos', {
    before: (c) => getTx(id(c)),
    describe: (c) => {
      const before = c.before as Tx | null;
      const after = getTx(id(c));
      if (!before || !after) return null;
      const { accounts, cats } = ctxTx();
      const changes = txChanges(before, after, accounts, cats, new Set());
      if (!changes.length) return null;
      // Privacy of either version: moving a movement out of a private account must not reveal it.
      const entry = txEntry(after, (mask) => {
        const ch = txChanges(before, after, accounts, cats, mask);
        return { summary: `Editó ${TX_NOUN[after.type][0]} ${TX_NOUN[after.type][1]}${after.description ? ` ${q(after.description)}` : ''} · ${changeText(ch)}`, details: { changes: ch } };
      });
      const wasPrivate = txPrivacy(before, accounts);
      if (entry.privateTo == null && wasPrivate.privateTo != null) {
        entry.privateTo = wasPrivate.privateTo;
        if (wasPrivate.publicOk) {
          const ch = txChanges(before, after, accounts, cats, wasPrivate.mask);
          entry.details = { ...(entry.details ?? {}), public: { summary: `Editó ${TX_NOUN[after.type][0]} ${TX_NOUN[after.type][1]} · ${changeText(ch)}`, details: { changes: ch } } };
        }
      }
      return entry;
    },
  }),
  'POST /api/transactions/:id/confirm': D('Recurrentes', {
    before: (c) => getTx(id(c)),
    describe: (c) => {
      const before = c.before as Tx | null;
      const after = getTx(id(c));
      if (!before || !after) return null;
      const { accounts, cats } = ctxTx();
      const expected = before.amount !== after.amount ? ` (esperado ${money(before.amount, before.currency)})` : '';
      return txEntry(
        after,
        (mask) => ({
          summary: `Confirmó el pendiente ${q(after.description) || TX_NOUN[after.type][1]}: ${money(after.amount, after.currency)}${expected}`,
          details: { changes: txChanges(before, after, accounts, cats, mask).filter((ch) => ch.field !== 'Estado'), facts: txFacts(after, accounts, mask) },
        }),
        { action: 'confirmar', section: after.recurring_id ? 'Recurrentes' : 'Movimientos' },
      );
    },
  }),
  'DELETE /api/transactions/:id': D('Movimientos', {
    before: (c) => {
      const tx = getTx(id(c));
      if (!tx) return null;
      const plan = tx.installment_plan_id
        ? row<{ description: string; total_amount: number; count: number }>('SELECT description, total_amount, count FROM installment_plans WHERE id = ?', tx.installment_plan_id)
        : undefined;
      return { tx, plan };
    },
    describe: (c) => {
      const tx = c.before?.tx as Tx | undefined;
      if (!tx) return null;
      const { accounts, cats } = ctxTx();
      const all = ['1', 'true'].includes(String(c.query.all_installments)) && c.before.plan;
      if (all) {
        const p = c.before.plan;
        return txEntry(tx, (mask) => ({ summary: `Borró la compra en cuotas ${q(p.description)}: ${p.count} cuotas, ${money(p.total_amount, tx.currency)} · ${accLabel(accounts, tx.account_id, mask)}` }), {
          action: 'borrar',
          entity: 'installment_plan',
          entityId: tx.installment_plan_id,
        });
      }
      return txEntry(tx, (mask) => ({ summary: `Borró ${txLine(tx, accounts, cats, mask, { article: true })}`, details: { facts: txFacts(tx, accounts, mask) } }), { action: 'borrar' });
    },
  }),
  'POST /api/transactions/bulk': D('Movimientos', {
    before: (c) => (Array.isArray(c.body?.ids) ? fetchTxs({ ids: c.body.ids.filter((x: unknown) => Number.isInteger(x)).slice(0, 1000) }) : []),
    describe: (c) => {
      const txs = (c.before ?? []) as Tx[];
      if (!c.res?.changed || !txs.length) return null;
      if (c.body?.action === 'delete') {
        return txGroupEntries(txs, (n) => `Borró ${n} ${n === 1 ? 'movimiento' : 'movimientos'} de una vez`, { action: 'borrar', entity: 'transaction' });
      }
      const target = c.body?.category_id == null ? 'Sin categoría' : catPath(loadCategories(), Number(c.body.category_id));
      const changed = new Set(fetchTxs({ ids: txs.map((t) => t.id) }).filter((t) => (t.category_id ?? null) === (c.body?.category_id ?? null)).map((t) => t.id));
      return txGroupEntries(txs.filter((t) => changed.has(t.id)), (n) => `Cambió la categoría de ${n} ${n === 1 ? 'movimiento' : 'movimientos'} a ${q(target)}`, {
        action: 'categorizar',
        entity: 'transaction',
      });
    },
  }),
  'POST /api/transactions/:id/receipt': D('Movimientos', {
    describe: (c) => {
      const tx = getTx(id(c));
      if (!tx) return null;
      const { accounts, cats } = ctxTx();
      return txEntry(tx, (mask) => ({ summary: `Adjuntó un comprobante a ${txLine(tx, accounts, cats, mask, { article: true })}` }), { action: 'comprobante' });
    },
  }),
  'DELETE /api/transactions/:id/receipt': D('Movimientos', {
    describe: (c) => {
      const tx = getTx(id(c));
      if (!tx) return null;
      const { accounts, cats } = ctxTx();
      return txEntry(tx, (mask) => ({ summary: `Quitó el comprobante de ${txLine(tx, accounts, cats, mask, { article: true })}` }), { action: 'comprobante' });
    },
  }),

  // ---- Gastos compartidos ----
  'POST /api/balances/settle': D('Gastos compartidos', {
    describe: (c) => {
      const tx = getTx(Number(c.res?.id));
      if (!tx) return null;
      const accounts = loadAccounts();
      return txEntry(
        tx,
        (mask) => ({
          summary: `Saldó deudas: ${money(tx.amount, tx.currency)} de ${accLabel(accounts, tx.account_id, mask)} a ${accLabel(accounts, tx.to_account_id, mask)}`,
          details: { facts: [{ label: 'Fecha', value: fdate(tx.date) }, ...(tx.description ? [{ label: 'Nota', value: tx.description }] : [])] },
        }),
        { action: 'saldar' },
      );
    },
  }),

  // ---- Reglas ----
  'POST /api/rules': D('Reglas', {
    describe: (c) => {
      const r = ruleView(ruleRow(Number(c.res?.id)));
      if (!r) return null;
      return { action: 'crear', entity: 'rule', entityId: Number(c.res.id), summary: `Creó la regla ${q(r.name)}: si la descripción ${r.condition} → ${r.set_category}` };
    },
  }),
  'PUT /api/rules/:id': D('Reglas', {
    before: (c) => ruleView(ruleRow(id(c))),
    describe: (c) => {
      const after = ruleView(ruleRow(id(c)));
      const changes = diff(c.before, after, RULE_FIELDS);
      if (!after || !changes.length) return null;
      return { action: 'editar', entity: 'rule', entityId: id(c), summary: `Editó la regla ${q(after.name)} · ${changeText(changes)}`, details: { changes } };
    },
  }),
  'DELETE /api/rules/:id': D('Reglas', {
    before: (c) => ruleView(ruleRow(id(c))),
    describe: (c) => c.before && { action: 'borrar', entity: 'rule', entityId: id(c), summary: `Borró la regla ${q(c.before.name)} (${c.before.condition})` },
  }),
  'POST /api/rules/catalog': D('Reglas', {
    describe: (c) => {
      const n = Number(c.res?.created ?? 0);
      if (!n) return null;
      const wanted = new Set(Array.isArray(c.body?.ids) ? c.body.ids.map(String) : []);
      const names = RULE_CATALOG.filter((r) => wanted.has(r.id)).map((r) => r.name);
      return { action: 'crear', entity: 'rule', summary: `Agregó ${n} ${n === 1 ? 'regla sugerida' : 'reglas sugeridas'}`, details: { items: names } };
    },
  }),
  'POST /api/rules/test': { skip: 'Previews which movements a rule would match; saves nothing.' },
  'POST /api/rules/apply': D('Reglas', {
    describe: (c) => {
      const n = Number(c.res?.changed ?? 0);
      if (!n) return null;
      return { action: 'aplicar', entity: 'rule', summary: `Aplicó las reglas: ${n} ${n === 1 ? 'movimiento quedó categorizado' : 'movimientos quedaron categorizados'}` };
    },
  }),

  // ---- Recurrentes ----
  'POST /api/recurring': D('Recurrentes', {
    describe: (c) => {
      const r = recurringRow(Number(c.res?.id));
      const v = recurringView(r);
      if (!r || !v) return null;
      return {
        action: 'crear',
        entity: 'recurring',
        entityId: r.id,
        summary: `Creó el recurrente ${q(r.description)}: ${v.amount} ${v.every} · ${v.account} · próximo ${v.next_date}`,
        privateTo: recurringPrivacy(r),
      };
    },
  }),
  'PUT /api/recurring/:id': D('Recurrentes', {
    before: (c) => {
      const r = recurringRow(id(c));
      return r ? { view: recurringView(r), privateTo: recurringPrivacy(r) } : null;
    },
    describe: (c) => {
      const r = recurringRow(id(c));
      const changes = diff(c.before?.view, recurringView(r), RECURRING_FIELDS);
      if (!r || !changes.length) return null;
      return {
        action: 'editar',
        entity: 'recurring',
        entityId: r.id,
        summary: `Editó el recurrente ${q(r.description)} · ${changeText(changes)}`,
        details: { changes },
        privateTo: c.before?.privateTo ?? recurringPrivacy(r),
      };
    },
  }),
  'DELETE /api/recurring/:id': D('Recurrentes', {
    before: (c) => {
      const r = recurringRow(id(c));
      if (!r) return null;
      const pending = row<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE recurring_id = ? AND status = 'pending'`, r.id)?.n ?? 0;
      return { r, pending, privateTo: recurringPrivacy(r) };
    },
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'recurring',
        entityId: c.before.r.id,
        summary: `Borró el recurrente ${q(c.before.r.description)}${c.before.pending ? ` y ${c.before.pending} ${c.before.pending === 1 ? 'pendiente sin confirmar' : 'pendientes sin confirmar'}` : ''}`,
        privateTo: c.before.privateTo,
      },
  }),
  'POST /api/recurring/run': D('Recurrentes', {
    // Each generated item is also logged on its own, as Automático (lib/recurring.ts).
    describe: (c) => {
      const n = Number(c.res?.created ?? 0);
      return n ? { action: 'generar', entity: 'recurring', summary: `Generó a mano los recurrentes vencidos: ${n} ${n === 1 ? 'pendiente nuevo' : 'pendientes nuevos'}` } : null;
    },
  }),

  // ---- Presupuestos ----
  'PUT /api/budgets': D('Presupuestos', {
    before: (c) => row<{ category_id: number; scope: string; amount: number; currency: Currency }>('SELECT * FROM budgets WHERE category_id = ? AND scope = ?', Number(c.body?.category_id), String(c.body?.scope ?? '')),
    describe: (c) => {
      const after = row<{ id: number; category_id: number; scope: string; amount: number; currency: Currency }>(
        'SELECT * FROM budgets WHERE category_id = ? AND scope = ?',
        Number(c.body?.category_id),
        String(c.body?.scope ?? ''),
      );
      if (!after) return null;
      const name = `${q(catPath(loadCategories(), after.category_id))} (${scopeLabel(after.scope)})`;
      const was = budgetView(c.before)?.amount;
      const now = budgetView(after)!.amount;
      if (was === now) return null;
      return {
        action: c.before ? 'editar' : 'crear',
        entity: 'budget',
        entityId: after.id,
        summary: c.before ? `Editó el presupuesto de ${name}: ${was} → ${now}` : `Creó el presupuesto de ${name}: ${now}`,
        privateTo: scopePrivacy(after.scope),
      };
    },
  }),
  'DELETE /api/budgets/:id': D('Presupuestos', {
    before: (c) => row<{ category_id: number; scope: string; amount: number; currency: Currency }>('SELECT * FROM budgets WHERE id = ?', id(c)),
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'budget',
        entityId: id(c),
        summary: `Borró el presupuesto de ${q(catPath(loadCategories(), c.before.category_id))} (${scopeLabel(c.before.scope)}): ${money(c.before.amount, c.before.currency)}`,
        privateTo: scopePrivacy(c.before.scope),
      },
  }),
  'POST /api/budgets/suggest': { skip: 'Returns suggested amounts; saves nothing.' },

  // ---- Objetivos ----
  'POST /api/goals': D('Objetivos', {
    describe: (c) => {
      const g = goalRow(Number(c.res?.id));
      const v = goalView(g);
      if (!g || !v) return null;
      return {
        action: 'crear',
        entity: 'goal',
        entityId: g.id,
        summary: `Creó el objetivo ${q(g.name)}: ${v.target} · ${v.scope}${g.deadline ? ` · para el ${v.deadline}` : ''}`,
        privateTo: scopePrivacy(g.scope),
      };
    },
  }),
  'PUT /api/goals/:id': D('Objetivos', {
    before: (c) => {
      const g = goalRow(id(c));
      return g ? { view: goalView(g), scope: g.scope } : null;
    },
    describe: (c) => {
      const g = goalRow(id(c));
      const changes = diff(c.before?.view, goalView(g), GOAL_FIELDS);
      if (!g || !changes.length) return null;
      return {
        action: 'editar',
        entity: 'goal',
        entityId: g.id,
        summary: `Editó el objetivo ${q(g.name)} · ${changeText(changes)}`,
        details: { changes },
        privateTo: scopePrivacy(g.scope) ?? scopePrivacy(c.before?.scope),
      };
    },
  }),
  'DELETE /api/goals/:id': D('Objetivos', {
    before: (c) => goalRow(id(c)),
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'goal',
        entityId: id(c),
        summary: `Borró el objetivo ${q(c.before.name)}: ${money(c.before.target_amount, c.before.currency)} · ${scopeLabel(c.before.scope)}`,
        privateTo: scopePrivacy(c.before.scope),
      },
  }),
  'POST /api/goals/:id/image': D('Objetivos', {
    describe: (c) => {
      const g = goalRow(id(c));
      return g ? { action: 'imagen', entity: 'goal', entityId: g.id, summary: `Cambió la imagen del objetivo ${q(g.name)}`, privateTo: scopePrivacy(g.scope) } : null;
    },
  }),
  'DELETE /api/goals/:id/image': D('Objetivos', {
    describe: (c) => {
      const g = goalRow(id(c));
      return g ? { action: 'imagen', entity: 'goal', entityId: g.id, summary: `Quitó la imagen del objetivo ${q(g.name)}`, privateTo: scopePrivacy(g.scope) } : null;
    },
  }),
  'POST /api/goals/:id/contributions': D('Objetivos', {
    describe: (c) => {
      const g = goalRow(id(c));
      const amount = num(c.body?.amount);
      if (!g || !Number.isFinite(amount)) return null;
      const note = typeof c.body?.note === 'string' && c.body.note.trim() ? ` · ${clip(c.body.note.trim(), 120)}` : '';
      return {
        action: amount < 0 ? 'retiro' : 'aporte',
        entity: 'goal_contribution',
        entityId: Number(c.res?.id),
        summary: `${amount < 0 ? 'Registró un retiro' : 'Registró un aporte'} de ${money(Math.abs(amount), g.currency)} en el objetivo ${q(g.name)}${note}`,
        details: { facts: [{ label: 'Fecha', value: fdate(String(c.body?.date ?? '')) }] },
        privateTo: scopePrivacy(g.scope),
      };
    },
  }),
  'DELETE /api/goals/:goalId/contributions/:id': D('Objetivos', {
    before: (c) => {
      const g = goalRow(id(c, 'goalId'));
      const contrib = row<{ amount: number; date: string }>('SELECT * FROM goal_contributions WHERE id = ? AND goal_id = ?', id(c), id(c, 'goalId'));
      return g && contrib ? { g, contrib } : null;
    },
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'goal_contribution',
        entityId: id(c),
        summary: `Borró ${c.before.contrib.amount < 0 ? 'un retiro' : 'un aporte'} de ${money(Math.abs(c.before.contrib.amount), c.before.g.currency)} del ${fdate(c.before.contrib.date)} en el objetivo ${q(c.before.g.name)}`,
        privateTo: scopePrivacy(c.before.g.scope),
      },
  }),

  // ---- Importar ----
  'POST /api/presets': D('Importar', {
    describe: (c) => ({ action: 'crear', entity: 'preset', entityId: Number(c.res?.id), summary: `Creó el preset ${q(String(c.body?.name ?? '').trim().slice(0, 60))}` }),
  }),
  'PUT /api/presets/:id': D('Importar', {
    before: (c) => row<{ name: string; config: string }>('SELECT name, config FROM csv_presets WHERE id = ?', id(c)),
    describe: (c) => {
      const after = row<{ name: string; config: string }>('SELECT name, config FROM csv_presets WHERE id = ?', id(c));
      if (!after) return null;
      const changes = diff(c.before && { name: c.before.name, config: c.before.config }, after, [
        ['name', 'Nombre'],
        ['config', 'Columnas y formato', () => 'cambiados'],
      ]);
      if (!changes.length) return null;
      const config = changes.find((ch) => ch.field === 'Columnas y formato');
      if (config) config.from = 'anteriores';
      return { action: 'editar', entity: 'preset', entityId: id(c), summary: `Editó el preset ${q(after.name)} · ${changeText(changes)}`, details: { changes } };
    },
  }),
  'DELETE /api/presets/:id': D('Importar', {
    before: (c) => row<{ name: string }>('SELECT name FROM csv_presets WHERE id = ?', id(c)),
    describe: (c) => c.before && { action: 'borrar', entity: 'preset', entityId: id(c), summary: `Borró el preset ${q(c.before.name)}` },
  }),
  'POST /api/imports/upload': { skip: 'Keeps the file in memory for the preview; saves nothing.' },
  'POST /api/imports/raw': { skip: 'Shows the raw grid of an uploaded file; saves nothing.' },
  'POST /api/imports/preview': { skip: 'Previews the rows to import; saves nothing.' },
  'POST /api/statements/detect': { skip: 'Recognises and checks an uploaded statement; saves nothing.' },
  'POST /api/statements/preview': { skip: 'Previews the rows of a statement; saves nothing.' },
  'POST /api/imports/commit': D('Importar', {
    describe: (c) => {
      const a = accountRow(Number(c.body?.account_id));
      const n = Number(c.res?.imported ?? 0);
      const failed = Array.isArray(c.res?.failures) ? c.res.failures.length : 0;
      const file = String(c.body?.file_name ?? '').slice(0, 120);
      return {
        action: 'importar',
        entity: 'import_batch',
        entityId: Number(c.res?.batch_id),
        summary: `Importó ${n} ${n === 1 ? 'movimiento' : 'movimientos'}${file ? ` de ${q(file)}` : ''} en ${a ? q(a.name) : 'una cuenta'}${failed ? ` · ${failed} con error` : ''}`,
        details: failed ? { items: c.res.failures.slice(0, 50).map((f: { description?: string; error?: string }) => `${clip(f.description, 80)}: ${clip(f.error, 120)}`) } : null,
        privateTo: privateAccount(a) ? a!.owner_id : null,
      };
    },
  }),
  'DELETE /api/imports/:id': D('Importar', {
    before: (c) => {
      const b = row<{ file_name: string; account_id: number }>('SELECT file_name, account_id FROM import_batches WHERE id = ?', id(c));
      return b ? { ...b, account: accountRow(b.account_id) } : null;
    },
    describe: (c) => {
      const n = Number(c.res?.deleted ?? 0);
      const a = c.before?.account as Account | undefined;
      return {
        action: 'deshacer',
        entity: 'import_batch',
        entityId: id(c),
        summary: `Deshizo la importación${c.before?.file_name ? ` ${q(c.before.file_name)}` : ''}: borró ${n} ${n === 1 ? 'movimiento' : 'movimientos'}${a ? ` de ${q(a.name)}` : ''}`,
        privateTo: privateAccount(a) ? a!.owner_id : null,
      };
    },
  }),

  // ---- Deudores (each person sees only their own loans) ----
  'POST /api/loans': D('Deudores', {
    describe: (c) => {
      const l = loanRow(Number(c.res?.id));
      if (!l) return null;
      const terms = l.installments && l.installments > 1 ? ` en ${l.installments} cuotas` : '';
      const rate = l.interest_rate ? ` al ${pctText(l.interest_rate)} mensual` : '';
      const total = l.total && l.total !== l.amount ? ` (a devolver ${money(l.total, l.currency)})` : '';
      return { action: 'crear', entity: 'loan', entityId: l.id, summary: `Prestó ${loanWhat(l)} a ${l.person}${terms}${rate}${total}`, privateTo: c.userId };
    },
  }),
  'PUT /api/loans/:id': D('Deudores', {
    before: (c) => loanView(loanRow(id(c))),
    describe: (c) => {
      const l = loanRow(id(c));
      const changes = diff(c.before, loanView(l), LOAN_FIELDS);
      if (!l || !changes.length) return null;
      return { action: 'editar', entity: 'loan', entityId: l.id, summary: `Editó el préstamo a ${l.person} · ${changeText(changes)}`, details: { changes }, privateTo: c.userId };
    },
  }),
  'DELETE /api/loans/:id': D('Deudores', {
    before: (c) => loanState(id(c)),
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'loan',
        entityId: id(c),
        summary: `Borró el préstamo a ${c.before.person}: ${loanWhat(c.before)}${c.before.outstanding ? ` (faltaban ${money(c.before.outstanding, c.before.currency)})` : ''}`,
        privateTo: c.userId,
      },
  }),
  'POST /api/loans/:id/returns': D('Deudores', {
    describe: (c) => {
      const l = loanState(id(c));
      if (!l) return null;
      if (l.kind === 'item') return { action: 'devolucion', entity: 'loan', entityId: l.id, summary: `${l.person} devolvió ${q(l.item)}`, privateTo: c.userId };
      const amount = num(c.body?.amount);
      const note = typeof c.body?.note === 'string' ? c.body.note.trim() : '';
      const left = l.outstanding ?? 0;
      const summary = l.closed_on
        ? `${l.person} devolvió ${money(amount, l.currency)}: préstamo saldado`
        : `${note ? 'Devolución parcial' : 'Devolución'} de ${l.person}: ${money(amount, l.currency)} (falta ${money(left, l.currency)})${note ? ` · motivo: ${clip(note, 140)}` : ''}`;
      return { action: 'devolucion', entity: 'loan', entityId: l.id, summary, details: { facts: [{ label: 'Fecha', value: fdate(String(c.body?.date ?? '')) || '—' }] }, privateTo: c.userId };
    },
  }),
  'DELETE /api/loans/:id/returns/:returnId': D('Deudores', {
    before: (c) => {
      const l = loanRow(id(c));
      const r = row<ReturnRow>('SELECT * FROM loan_returns WHERE id = ? AND loan_id = ?', Number(c.params.returnId), id(c));
      return l && r ? { l, r } : null;
    },
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'loan_return',
        entityId: Number(c.params.returnId),
        summary:
          c.before.l.kind === 'item'
            ? `Borró la devolución de ${q(c.before.l.item)} de ${c.before.l.person}`
            : `Borró la devolución de ${c.before.l.person} del ${fdate(c.before.r.date)}: ${money(c.before.r.amount, c.before.l.currency)}`,
        privateTo: c.userId,
      },
  }),
  'POST /api/loans/:id/close': D('Deudores', {
    before: (c) => loanState(id(c)),
    describe: (c) => {
      const l = c.before;
      if (!l) return null;
      if (c.body?.reason === 'reopen') return { action: 'reabrir', entity: 'loan', entityId: l.id, summary: `Reabrió el préstamo a ${l.person}`, privateTo: c.userId };
      return {
        action: 'perdonar',
        entity: 'loan',
        entityId: l.id,
        summary: `Perdonó lo que faltaba del préstamo a ${l.person}${l.outstanding ? `: ${money(l.outstanding, l.currency)}` : ''}`,
        privateTo: c.userId,
      };
    },
  }),

  // ---- Pendientes (each person sees only what they're responsible for) ----
  'POST /api/commitments': D('Pendientes', {
    describe: (c) => {
      const cm = commitmentRow(Number(c.res?.id));
      const v = commitmentView(cm);
      if (!cm || !v) return null;
      return {
        action: 'crear',
        entity: 'commitment',
        entityId: cm.id,
        summary: `Creó el pendiente ${q(cm.title)}: ${v.amount} por mes, día ${v.day}${cm.months ? ` · ${cm.months} meses` : ''}`,
        privateTo: c.userId,
      };
    },
  }),
  'PUT /api/commitments/:id': D('Pendientes', {
    before: (c) => commitmentView(commitmentRow(id(c))),
    describe: (c) => {
      const cm = commitmentRow(id(c));
      const changes = diff(c.before, commitmentView(cm), COMMITMENT_FIELDS);
      if (!cm || !changes.length) return null;
      return { action: 'editar', entity: 'commitment', entityId: cm.id, summary: `Editó el pendiente ${q(cm.title)} · ${changeText(changes)}`, details: { changes }, privateTo: c.userId };
    },
  }),
  'DELETE /api/commitments/:id': D('Pendientes', {
    before: (c) => commitmentRow(id(c)),
    describe: (c) => c.before && { action: 'borrar', entity: 'commitment', entityId: id(c), summary: `Borró el pendiente ${q(c.before.title)}: ${money(c.before.amount, c.before.currency)} por mes`, privateTo: c.userId },
  }),
  'POST /api/pending/:source/:id/link': D('Pendientes', {
    describe: (c) => {
      const tx = getTx(num(c.body?.transaction_id));
      const reason = typeof c.body?.reason === 'string' ? c.body.reason.trim() : '';
      const motive = reason ? ` · motivo: ${clip(reason, 140)}` : '';
      const txText = tx ? `${TX_NOUN[tx.type][1]} ${q(tx.description)} del ${fdate(tx.date)}`.replace(/\s+/g, ' ') : 'un movimiento';
      if (c.params.source === 'loan') {
        const l = loanState(id(c));
        if (!l) return null;
        const left = l.outstanding ?? 0;
        return {
          action: 'vincular',
          entity: 'loan',
          entityId: l.id,
          summary: `Vinculó el cobro de ${l.person}: ${money(tx?.amount, l.currency)}${l.closed_on ? ' · préstamo saldado' : ` (falta ${money(left, l.currency)})`}${motive}`,
          details: { facts: [{ label: 'Movimiento', value: txText }] },
          privateTo: c.userId,
        };
      }
      const cm = commitmentRow(id(c));
      if (!cm) return null;
      const left = remainingOf(c.userId, 'commitment', cm.id);
      const paid = tx ? (cm.kind === 'savings' ? (tx.to_amount ?? tx.amount) : tx.amount) : null;
      return {
        action: 'vincular',
        entity: 'commitment',
        entityId: cm.id,
        summary: `Vinculó un pago a ${q(cm.title)}: ${money(paid, cm.currency)}${left ? ` (falta ${money(left, cm.currency)})` : ''}${motive}`,
        details: { facts: [{ label: 'Movimiento', value: txText }] },
        privateTo: c.userId,
      };
    },
  }),
  'POST /api/pending/commitment/:id/payments': D('Pendientes', {
    describe: (c) => {
      const cm = commitmentRow(id(c));
      if (!cm) return null;
      const amount = num(c.body?.amount);
      const reason = typeof c.body?.reason === 'string' ? c.body.reason.trim() : '';
      const left = remainingOf(c.userId, 'commitment', cm.id);
      return {
        action: 'pagar',
        entity: 'commitment',
        entityId: cm.id,
        summary: `${reason ? 'Pago parcial' : 'Registró un pago'} de ${money(amount, cm.currency)} para ${q(cm.title)}${left ? ` (falta ${money(left, cm.currency)})` : ''}${reason ? ` · motivo: ${clip(reason, 140)}` : ''}`,
        details: { facts: [{ label: 'Fecha', value: fdate(String(c.body?.date ?? '')) }, { label: 'Cómo', value: 'Cargado a mano, sin movimiento' }] },
        privateTo: c.userId,
      };
    },
  }),
  'DELETE /api/pending/payments/:id': D('Pendientes', {
    before: (c) =>
      row<{ amount: number; date: string; title: string; currency: Currency; commitment_id: number }>(
        'SELECT p.amount, p.date, p.commitment_id, c.title, c.currency FROM commitment_payments p JOIN commitments c ON c.id = p.commitment_id WHERE p.id = ?',
        id(c),
      ),
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'commitment',
        entityId: c.before.commitment_id,
        summary: `Borró el pago de ${money(c.before.amount, c.before.currency)} del ${fdate(c.before.date)} en ${q(c.before.title)}`,
        privateTo: c.userId,
      },
  }),

  // ---- Mercado Pago (personal connection: only its owner sees these) ----
  'PUT /api/me/mercadopago': D('Mercado Pago', {
    global: true,
    describe: (c) => {
      if (c.body?.access_token === undefined) {
        const start = typeof c.body?.history_start === 'string' && c.body.history_start ? fdate(c.body.history_start) : 'la fecha por defecto';
        return { action: 'editar', entity: 'mercadopago', summary: `Cambió desde cuándo se lee Mercado Pago: ${start}`, privateTo: c.userId };
      }
      const nick = typeof c.res?.nickname === 'string' ? ` (${c.res.nickname.slice(0, 40)})` : '';
      return { action: 'conectar', entity: 'mercadopago', summary: `Conectó su cuenta de Mercado Pago${nick}`, privateTo: c.userId };
    },
  }),
  'POST /api/me/mercadopago/check': D('Mercado Pago', {
    global: true,
    describe: (c) => ({ action: 'probar', entity: 'mercadopago', summary: 'Probó la conexión con Mercado Pago', privateTo: c.userId }),
  }),
  'POST /api/me/mercadopago/reports': D('Mercado Pago', {
    global: true,
    describe: (c) => {
      const label: Record<string, string> = { exists: 'ya estaba', created: 'guardada', failed: 'falló' };
      const items = Array.isArray(c.res?.setup) ? c.res.setup.map((s: { key?: string; result?: string }) => `${String(s.key ?? '')}: ${label[String(s.result)] ?? String(s.result ?? '')}`) : [];
      return { action: 'configurar', entity: 'mercadopago', summary: 'Guardó la configuración de los reportes de Mercado Pago', details: { items }, privateTo: c.userId };
    },
  }),
  'POST /api/me/mercadopago/account': D('Mercado Pago', {
    describe: (c) => {
      const l = c.res?.linked;
      if (!l?.name) return null;
      return {
        action: 'vincular',
        entity: 'account',
        entityId: Number(l.id) || null,
        summary: `Vinculó Mercado Pago con la cuenta ${q(String(l.name).slice(0, 60))}${l.created ? ' (cuenta nueva)' : ''}`,
        privateTo: c.userId,
      };
    },
  }),
  // The automatic sync logs its own imports (lib/mp-sync.ts); a click that only asks for a report isn't worth a line.
  'POST /api/me/mercadopago/sync': D('Mercado Pago', {
    describe: (c) => (c.body?.start === true ? { action: 'sincronizar', entity: 'mercadopago', summary: 'Pidió a Mercado Pago los movimientos nuevos', privateTo: c.userId } : null),
  }),
  'POST /api/me/mercadopago/review': D('Mercado Pago', {
    describe: (c) => {
      const n = Number(c.res?.imported ?? 0);
      const m = Number(c.res?.merged ?? 0);
      const opening = typeof c.res?.opening === 'number' ? ` · saldo inicial ${money(c.res.opening, 'ARS')}` : '';
      return {
        action: 'importar',
        entity: 'import_batch',
        entityId: Number(c.res?.batch_id) || null,
        summary: `Revisó y guardó ${n} movimiento${n === 1 ? '' : 's'} de Mercado Pago${m ? `, completó ${m} cargado${m === 1 ? '' : 's'} a mano` : ''}${opening}`,
        privateTo: c.userId,
      };
    },
  }),
  'DELETE /api/me/mercadopago': D('Mercado Pago', {
    global: true,
    describe: (c) => ({ action: 'desconectar', entity: 'mercadopago', summary: 'Desconectó su cuenta de Mercado Pago', privateTo: c.userId }),
  }),

  // ---- Resúmenes por correo (personal connection: only its owner sees these) ----
  'POST /api/me/gmail/connect': { skip: 'Only returns the address of Google\'s consent page.' },
  'DELETE /api/me/gmail': D('Ajustes', {
    global: true,
    describe: (c) => ({ action: 'desconectar', entity: 'gmail', summary: 'Desconectó su Gmail de los resúmenes por correo', privateTo: c.userId }),
  }),
  'PUT /api/me/gmail/sync': D('Importar', {
    describe: (c) => ({ action: 'activar', entity: 'gmail', summary: `Activó la búsqueda de resúmenes en su correo desde el ${fdate(c.body?.since)}`, privateTo: c.userId }),
  }),
  'DELETE /api/me/gmail/sync': D('Importar', {
    describe: (c) => ({ action: 'desactivar', entity: 'gmail', summary: 'Desactivó la búsqueda de resúmenes en su correo', privateTo: c.userId }),
  }),
  'POST /api/me/gmail/fetch': D('Importar', {
    describe: (c) => {
      const n = Number(c.res?.found?.recognised ?? 0);
      return { action: 'buscar', entity: 'gmail', summary: `Buscó resúmenes en su correo: ${n ? `${n} nuevo${n === 1 ? '' : 's'}` : 'ninguno nuevo'}`, privateTo: c.userId };
    },
  }),
  'POST /api/mail-statements/:id/open': { skip: 'Opens a received statement in the wizard; saves nothing.' },
  'POST /api/mail-statements/:id/imported': { skip: 'Marks a received statement as imported; the import itself is logged by POST /api/imports/commit.' },
  'POST /api/mail-statements/:id/dismiss': D('Importar', {
    describe: (c) => ({ action: 'descartar', entity: 'mail_statement', entityId: Number(c.params.id) || null, summary: `Descartó el resumen recibido por correo ${q(clip(c.res?.file_name, 80))}`, privateTo: c.userId }),
  }),

  // ---- Perfil de datos ----
  'POST /api/profiles': D('Perfil de datos', {
    global: true,
    describe: (c) => ({ action: 'crear', entity: 'profile', entityId: Number(c.res?.id), summary: `Creó el perfil ${q(getProfile(Number(c.res?.id))?.name)}` }),
  }),
  'PATCH /api/profiles/:id': D('Perfil de datos', {
    global: true,
    before: (c) => getProfile(id(c))?.name,
    describe: (c) => {
      const name = getProfile(id(c))?.name;
      return name && name !== c.before ? { action: 'renombrar', entity: 'profile', entityId: id(c), summary: `Renombró el perfil ${q(c.before)} a ${q(name)}` } : null;
    },
  }),
  'DELETE /api/profiles/:id': D('Perfil de datos', {
    global: true,
    before: (c) => {
      const p = getProfile(id(c));
      if (!p) return null;
      try {
        const d = profileDb(p);
        const n = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
        return { name: p.name, accounts: n('SELECT COUNT(*) AS n FROM accounts'), txs: n('SELECT COUNT(*) AS n FROM transactions') };
      } catch {
        return { name: p.name };
      }
    },
    describe: (c) =>
      c.before && {
        action: 'borrar',
        entity: 'profile',
        entityId: id(c),
        summary: `Borró el perfil ${q(c.before.name)}${c.before.txs != null ? ` (${c.before.accounts} cuentas, ${c.before.txs} movimientos)` : ''}`,
      },
  }),
  'POST /api/profiles/select': D('Perfil de datos', {
    global: true,
    describe: (c) => {
      const p = getProfile(num(c.body?.id));
      return p ? { action: 'cambiar', entity: 'profile', entityId: p.id, summary: `Pasó al perfil ${q(p.name)}` } : null;
    },
  }),

  // ---- Ajustes: rates, CPI, backups ----
  'POST /api/fx': D('Ajustes', {
    before: (c) => row<{ buy: number; sell: number; source: string }>('SELECT buy, sell, source FROM fx_rates WHERE date = ?', String(c.body?.date ?? '')),
    describe: (c) => {
      const r = (v: number) => money(Math.round(v * 100), 'ARS');
      const changes = [
        { field: 'Compra', from: c.before ? r(c.before.buy) : '—', to: r(num(c.body?.buy)) },
        { field: 'Venta', from: c.before ? r(c.before.sell) : '—', to: r(num(c.body?.sell)) },
      ];
      return {
        action: 'cotizacion',
        entity: 'fx',
        summary: `Cargó a mano el dólar del ${fdate(String(c.body?.date))}: compra ${r(num(c.body?.buy))} / venta ${r(num(c.body?.sell))}`,
        details: { changes, facts: c.before ? [{ label: 'Fuente anterior', value: String(c.before.source) }] : [] },
      };
    },
  }),
  'POST /api/fx/refresh': D('Ajustes', {
    describe: (c) => {
      const l = c.res?.latest;
      const latest = l ? `: venta ${money(Math.round(num(l.sell) * 100), 'ARS')} del ${fdate(l.date)}` : '';
      return { action: 'actualizar', entity: 'fx', summary: `Actualizó las cotizaciones desde BNA${latest}${c.res?.ok === false ? ' (con errores)' : ''}` };
    },
  }),
  'POST /api/cpi': D('Ajustes', {
    before: (c) => row<{ pct: number }>('SELECT pct FROM cpi_monthly WHERE month = ?', String(c.body?.month ?? '')),
    describe: (c) => {
      const month = String(c.body?.month ?? '');
      const was = c.before ? `${pctText(c.before.pct)} → ` : '';
      const changes = [{ field: 'IPC mensual', from: c.before ? pctText(c.before.pct) : '—', to: pctText(num(c.body?.pct)) }];
      return { action: 'ipc', entity: 'cpi', summary: `Cargó a mano el IPC de ${/^\d{4}-\d{2}$/.test(month) ? monthLabel(month) : month}: ${was}${pctText(num(c.body?.pct))}`, details: { changes } };
    },
  }),
  'POST /api/cpi/refresh': D('Ajustes', {
    describe: (c) => ({ action: 'actualizar', entity: 'cpi', summary: `Actualizó el IPC desde INDEC${c.res?.ok === false ? ' (no se pudo)' : ''}` }),
  }),
  'POST /api/backups': D('Ajustes', {
    describe: (c) => ({ action: 'copia', entity: 'backup', summary: `Creó una copia de seguridad${c.res?.file ? ` (${String(c.res.file).slice(0, 80)})` : ''}` }),
  }),

  // ---- Cierre de mes ----
  'PUT /api/reviews/:month': D('Cierre de mes', {
    before: (c) => row<{ notes: string | null; closed_at: string | null }>('SELECT notes, closed_at FROM month_reviews WHERE month = ? AND scope = ?', c.params.month, String(c.body?.scope ?? '')),
    describe: (c) => {
      const scope = String(c.body?.scope ?? '');
      const label = `${monthLabel(c.params.month)} (${scopeLabel(scope)})`;
      const closing = !!c.body?.closed && !c.before?.closed_at;
      const notesChanged = (c.before?.notes ?? '') !== String(c.body?.notes ?? '');
      if (!closing && !notesChanged) return null;
      const notes = String(c.body?.notes ?? '');
      return {
        action: closing ? 'cerrar' : 'notas',
        entity: 'review',
        summary: closing ? `Cerró el mes de ${label}` : `Editó las notas del cierre de ${label}`,
        details: notesChanged && notes ? { facts: [{ label: 'Notas', value: clip(notes, 300) }] } : null,
        privateTo: scopePrivacy(scope),
      };
    },
  }),
  'POST /api/reviews/:month/send': D('Cierre de mes', {
    describe: (c) => {
      const scope = String(c.body?.scope ?? 'household');
      return { action: 'enviar', entity: 'review', summary: `Envió por Telegram el cierre de ${monthLabel(c.params.month)} (${scopeLabel(scope)})`, privateTo: scopePrivacy(scope) };
    },
  }),

  // ---- Actividad (clearing is logged by the route itself, after the delete) ----
  'DELETE /api/audit': { manual: 'routes/audit.ts' },

  // ---- Deshacer: one line per entry of the undone action, in its section and with its privacy ----
  'POST /api/undo/:token': D('Actividad', {
    describe: (c) => {
      const ids = undoneAuditIds(String(c.params.token ?? ''));
      const rows = ids.length
        ? (coreDb().prepare(`SELECT * FROM audit_log WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`).all(...ids) as {
            section: AuditSection;
            summary: string;
            entity: string | null;
            entity_id: number | null;
            details: string | null;
            private_to: number | null;
          }[])
        : [];
      if (!rows.length) return { action: 'deshacer', summary: 'Deshizo la última acción' };
      return rows.map((r) => {
        let pub: string | undefined;
        try {
          pub = r.details ? (JSON.parse(r.details) as AuditDetails).public?.summary : undefined;
        } catch {
          pub = undefined;
        }
        return {
          section: r.section,
          action: 'deshacer',
          entity: r.entity,
          entityId: r.entity_id,
          summary: `Deshizo: ${r.summary}`,
          privateTo: r.private_to,
          details: pub ? { public: { summary: `Deshizo: ${pub}` } } : null,
        };
      });
    },
  }),
};

/** Section for a mutating route with no descriptor, from its path. */
function guessSection(url: string): AuditSection {
  const p = url.replace(/^\/api\//, '');
  const map: [RegExp, AuditSection][] = [
    [/^(transactions|tags|installments)/, 'Movimientos'],
    [/^accounts/, 'Cuentas'],
    [/^balances/, 'Gastos compartidos'],
    [/^loans/, 'Deudores'],
    [/^(pending|commitments)/, 'Pendientes'],
    [/^budgets/, 'Presupuestos'],
    [/^goals/, 'Objetivos'],
    [/^(imports|presets)/, 'Importar'],
    [/^rules/, 'Reglas'],
    [/^recurring/, 'Recurrentes'],
    [/^reviews/, 'Cierre de mes'],
    [/^profiles/, 'Perfil de datos'],
    [/^me\/mercadopago|^mercadopago/, 'Mercado Pago'],
    [/^(auth|users)/, 'Accesos'],
    [/^audit/, 'Actividad'],
  ];
  return map.find(([re]) => re.test(p))?.[1] ?? 'Ajustes';
}

// ---- The hook ----

type State = { key: string; desc: Descriptor | null; db: DB; profileId: number | null; ctx: AuditCtx };

declare module 'fastify' {
  interface FastifyRequest {
    auditState?: State;
  }
}

const registered = new Set<string>();

/** Mutating API routes seen while the app was built, as "METHOD /api/path". */
export function mutatingRoutes(): string[] {
  return [...registered].sort();
}

/** Mutating routes with no descriptor (they still get a generic entry). */
export function unmappedRoutes(): string[] {
  return mutatingRoutes().filter((k) => !(k in AUDIT_ROUTES));
}

function parsePayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Call before the routes are registered. */
export function installAuditHooks(app: FastifyInstance) {
  app.addHook('onRoute', (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) if (MUTATING.has(m) && r.url.startsWith('/api/')) registered.add(`${m} ${r.url}`);
  });

  app.addHook('preHandler', async (req) => {
    try {
      if (!MUTATING.has(req.method)) return;
      const url = req.routeOptions.url;
      if (!url?.startsWith('/api/') || !req.userId) return;
      const key = `${req.method} ${url}`;
      const known = AUDIT_ROUTES[key];
      if (known && ('skip' in known || 'manual' in known)) return;
      const ctx: AuditCtx = {
        userId: req.userId,
        params: (req.params ?? {}) as Record<string, string>,
        query: (req.query ?? {}) as Record<string, string | undefined>,
        body: req.isMultipart() ? null : req.body,
        res: null,
        before: null,
      };
      const desc = (known as Descriptor | undefined) ?? null;
      req.auditState = { key, desc, db: db(), profileId: currentProfileId(), ctx };
      if (desc?.before) {
        try {
          ctx.before = desc.before(ctx) ?? null;
        } catch (e) {
          console.error(`[audit] before snapshot failed for ${key}:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.error('[audit] preHandler failed:', (e as Error).message);
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const st = req.auditState;
    if (!st) return payload;
    req.auditState = undefined;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;
    try {
      st.ctx.res = parsePayload(payload);
      withDb(st.db, st.profileId, () => {
        const { desc, ctx } = st;
        let entries: Entry[];
        if (desc) {
          try {
            const out = desc.describe(ctx);
            entries = out == null ? [] : Array.isArray(out) ? out : [out];
          } catch (e) {
            console.error(`[audit] could not describe ${st.key}:`, (e as Error).message);
            entries = [{ action: 'otro', summary: `Acción registrada sin detalle (${st.key.replace(' /api', '')})` }];
          }
        } else {
          entries = [{ action: 'otro', summary: `Acción registrada sin detalle (${st.key.replace(' /api', '')})` }];
        }
        const section = desc?.section ?? guessSection(st.key.split(' ')[1]);
        for (const e of entries) {
          if (!e) continue;
          const { section: own, userId, ...rest } = e;
          const entryId = logAction({ ...rest, userId: userId === undefined ? ctx.userId : userId, section: own ?? section, profileId: desc?.global ? null : st.profileId });
          // Deshacer (lib/undo.ts) keeps these with the undo token, for its "Deshizo: …" line.
          if (entryId) (req.auditIds ??= []).push(entryId);
        }
      });
    } catch (e) {
      console.error('[audit] onSend failed:', (e as Error).message);
    }
    return payload;
  });
}
