import { config } from '../config.js';
import { coreDb } from '../db/index.js';
import { HttpError } from './http.js';
import { decryptSecret, encryptSecret } from './secrets.js';

// Mercado Pago, one personal account per person. See docs/mercadopago/ for what the API offers.
//
// The production access token can move money (there is no read-only scope), so:
// - it is stored only encrypted, bound to its user, and is never returned by the API or logged;
// - reads go through mpGet(): GET only, and only to the paths in READ_ONLY;
// - the only writes are the report ones the owner approved (save a report's settings, ask for a
//   report for a date range), through mpWrite() and the exact method + path pairs in WRITES.
//   Nothing here can create payments, refunds, transfers or anything else that moves money.
//   Adding any other write needs the owner's explicit approval first.

const READ_ONLY: RegExp[] = [
  /^\/users\/me$/,
  /^\/v1\/payments\/search$/,
  /^\/v1\/payments\/\d+$/,
  /^\/users\/\d+\/mercadopago_account\/balance$/,
  /^\/v1\/account\/(release|settlement)_report\/(config|list)$/,
  /^\/v1\/account\/(release|settlement)_report\/[\w.-]+\.(csv|xlsx)$/,
];

// Approved by the owner on 2026-10-28: report settings and report generation, nothing else.
const WRITES: { method: 'POST' | 'PUT'; path: RegExp }[] = [
  { method: 'POST', path: /^\/v1\/account\/(release|settlement)_report\/config$/ },
  { method: 'PUT', path: /^\/v1\/account\/(release|settlement)_report\/config$/ },
  { method: 'POST', path: /^\/v1\/account\/(release|settlement)_report$/ },
];

const TIMEOUT_MS = 10_000;

export type MpResponse = { status: number; body: unknown };

async function send(token: string, method: 'GET' | 'POST' | 'PUT', url: URL, payload?: unknown): Promise<MpResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    // The underlying error may carry request details; never pass it on.
    throw new HttpError(502, 'No se pudo contactar a Mercado Pago. Probá de nuevo en unos minutos.');
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* CSV report or plain text */
  }
  return { status: res.status, body };
}

export async function mpGet(token: string, pathAndQuery: string): Promise<MpResponse> {
  const url = new URL(pathAndQuery, config.mpApiUrl);
  if (!READ_ONLY.some((re) => re.test(url.pathname))) throw new Error(`Mercado Pago path not allowed: ${url.pathname}`);
  return send(token, 'GET', url);
}

/** One of the approved report writes (see WRITES); anything else throws before a request is made. */
export async function mpWrite(token: string, method: 'POST' | 'PUT', path: string, payload: unknown): Promise<MpResponse> {
  const url = new URL(path, config.mpApiUrl);
  if (url.search || !WRITES.some((w) => w.method === method && w.path.test(url.pathname))) throw new Error(`Mercado Pago write not allowed: ${method} ${url.pathname}`);
  return send(token, method, url, payload);
}

/** Quick shape check before calling Mercado Pago with it. */
export function checkTokenFormat(token: string) {
  if (/^TEST-/.test(token)) throw new HttpError(400, 'Es un token de prueba. Usá el de Credenciales de producción.', 'access_token');
  if (!/^APP_USR-[0-9A-Za-z-]{20,250}$/.test(token)) throw new HttpError(400, 'El token debe empezar con APP_USR- y copiarse completo.', 'access_token');
}

export type MpIdentity = { id: number; nickname: string | null; site_id: string | null };

/** Asks Mercado Pago who the token belongs to; throws a readable error when it's not valid. */
export async function verifyToken(token: string): Promise<MpIdentity> {
  const r = await mpGet(token, '/users/me');
  if (r.status === 401 || r.status === 403) throw new HttpError(400, 'Mercado Pago rechazó el token. Copialo de nuevo desde Credenciales de producción.', 'access_token');
  const b = r.body as { id?: unknown; nickname?: unknown; site_id?: unknown };
  if (r.status !== 200 || typeof b?.id !== 'number') throw new HttpError(502, `Mercado Pago respondió con un error (${r.status}). Probá de nuevo más tarde.`);
  return { id: b.id, nickname: typeof b.nickname === 'string' ? b.nickname : null, site_id: typeof b.site_id === 'string' ? b.site_id : null };
}

export type MpCheck = {
  key: 'identity' | 'payments' | 'balance' | 'release_report' | 'settlement_report';
  // 'unconfigured': a report Mercado Pago knows nothing about yet (404 on its settings).
  status: 'ok' | 'unconfigured' | 'unavailable' | 'error';
  http: number | null;
};

const REPORTS = ['release_report', 'settlement_report'] as const;
type ReportKind = (typeof REPORTS)[number];

/**
 * Which data sources this account can read (the brief's verification step). Read-only requests,
 * one after another; only the HTTP status is kept, never the data.
 */
export async function checkSources(token: string, mpUserId: number): Promise<MpCheck[]> {
  const probes: [MpCheck['key'], string][] = [
    ['identity', '/users/me'],
    ['payments', '/v1/payments/search?limit=1&sort=date_created&criteria=desc'],
    ['balance', `/users/${mpUserId}/mercadopago_account/balance`],
    ['release_report', '/v1/account/release_report/config'],
    ['settlement_report', '/v1/account/settlement_report/config'],
  ];
  const out: MpCheck[] = [];
  for (const [key, path] of probes) {
    try {
      const { status } = await mpGet(token, path);
      const unconfigured = status === 404 && (REPORTS as readonly string[]).includes(key);
      out.push({ key, status: status === 200 ? 'ok' : unconfigured ? 'unconfigured' : [401, 403, 404].includes(status) ? 'unavailable' : 'error', http: status });
    } catch {
      out.push({ key, status: 'error', http: null });
    }
  }
  return out;
}

// ---- Reports (the full history, in and out) ----

// The columns Mercado Pago documents for both reports. Amounts use a dot as decimal separator once
// the column separator is a comma; parse them explicitly when importing.
const REPORT_COLUMNS = [
  'DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE', 'RECORD_TYPE', 'DESCRIPTION', 'NET_CREDIT_AMOUNT', 'NET_DEBIT_AMOUNT', 'GROSS_AMOUNT',
  'SELLER_AMOUNT', 'MP_FEE_AMOUNT', 'FINANCING_FEE_AMOUNT', 'SHIPPING_FEE_AMOUNT', 'TAXES_AMOUNT', 'COUPON_AMOUNT', 'INSTALLMENTS',
  'PAYMENT_METHOD', 'TAX_DETAIL', 'TAX_AMOUNT_TELCO', 'TRANSACTION_APPROVAL_DATE', 'POS_ID', 'POS_NAME', 'EXTERNAL_POS_ID', 'STORE_ID',
  'STORE_NAME', 'EXTERNAL_STORE_ID', 'TAXES_DISAGGREGATED', 'METADATA', 'REFUND_ID',
];

/** Settings for a new report: no emails, Argentina's time, every documented column. Scheduling stays off. */
export function reportConfig(kind: ReportKind) {
  return {
    file_name_prefix: kind === 'release_report' ? 'finanzas-liberado' : 'finanzas-transacciones',
    display_timezone: 'GMT-03',
    report_translation: 'en',
    separator: ',',
    notification_email_list: [],
    frequency: { type: 'daily', value: 1, hour: 6 },
    ...(kind === 'release_report' ? { include_withdrawal: true } : {}),
    columns: REPORT_COLUMNS.map((key) => ({ key })),
  };
}

export type ReportSetup = { key: ReportKind; result: 'exists' | 'created' | 'failed'; http: number | null };

/** Saves the settings of each report that has none yet; reports already set up are left alone. */
export async function setupReports(token: string): Promise<ReportSetup[]> {
  const out: ReportSetup[] = [];
  for (const key of REPORTS) {
    const base = `/v1/account/${key}/config`;
    try {
      const current = await mpGet(token, base);
      if (current.status === 200) {
        out.push({ key, result: 'exists', http: 200 });
        continue;
      }
      const r = await mpWrite(token, 'POST', base, reportConfig(key));
      out.push({ key, result: r.status >= 200 && r.status < 300 ? 'created' : 'failed', http: r.status });
    } catch {
      out.push({ key, result: 'failed', http: null });
    }
  }
  return out;
}

/** Asks Mercado Pago to build a report for [begin, end] (UTC ISO). It's ready later: poll the list. */
export async function requestReport(token: string, kind: ReportKind, begin: string, end: string): Promise<MpResponse> {
  return mpWrite(token, 'POST', `/v1/account/${kind}`, { begin_date: begin, end_date: end });
}

// ---- Storage (core database, one row per person) ----

type Row = {
  user_id: number;
  token_enc: string;
  mp_user_id: number | null;
  nickname: string | null;
  site_id: string | null;
  history_start: string | null;
  connected_at: string;
  checked_at: string | null;
  checks: string | null;
};

const context = (userId: number) => `mp:${userId}`;

function row(userId: number): Row | undefined {
  return coreDb().prepare('SELECT * FROM mp_connections WHERE user_id = ?').get(userId) as Row | undefined;
}

/** What the settings screen may know. No token, no part of it. */
export function connectionView(userId: number) {
  const r = row(userId);
  if (!r) return { connected: false as const };
  return {
    connected: true as const,
    mp_user_id: r.mp_user_id,
    nickname: r.nickname,
    site_id: r.site_id,
    history_start: r.history_start,
    connected_at: r.connected_at,
    checked_at: r.checked_at,
    checks: r.checks ? (JSON.parse(r.checks) as MpCheck[]) : null,
    // False when the token can no longer be decrypted (e.g. SECRET_KEY changed): connect again.
    readable: decryptSecret(r.token_enc, context(userId)) !== null,
  };
}

/** The stored token, for server-side use only. */
export function storedToken(userId: number): { token: string; mpUserId: number | null } | null {
  const r = row(userId);
  const token = r && decryptSecret(r.token_enc, context(userId));
  return token ? { token, mpUserId: r.mp_user_id } : null;
}

export function saveConnection(userId: number, token: string, who: MpIdentity, historyStart: string | null) {
  coreDb()
    .prepare(
      `INSERT INTO mp_connections (user_id, token_enc, mp_user_id, nickname, site_id, history_start, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token_enc = excluded.token_enc, mp_user_id = excluded.mp_user_id, nickname = excluded.nickname,
         site_id = excluded.site_id, history_start = COALESCE(excluded.history_start, history_start), connected_at = excluded.connected_at,
         checked_at = NULL, checks = NULL`,
    )
    .run(userId, encryptSecret(token, context(userId)), who.id, who.nickname, who.site_id, historyStart, new Date().toISOString());
}

export function setHistoryStart(userId: number, historyStart: string | null) {
  const r = coreDb().prepare('UPDATE mp_connections SET history_start = ? WHERE user_id = ?').run(historyStart, userId);
  if (!r.changes) throw new HttpError(404, 'Primero conectá tu cuenta de Mercado Pago.');
}

export function saveChecks(userId: number, checks: MpCheck[]) {
  coreDb().prepare('UPDATE mp_connections SET checked_at = ?, checks = ? WHERE user_id = ?').run(new Date().toISOString(), JSON.stringify(checks), userId);
}

export function deleteConnection(userId: number) {
  coreDb().prepare('DELETE FROM mp_connections WHERE user_id = ?').run(userId);
}
