import { config } from '../config.js';
import { coreDb } from '../db/index.js';
import { HttpError } from './http.js';
import { decryptSecret, encryptSecret } from './secrets.js';

// Mercado Pago, one personal account per person. See docs/mercadopago/ for what the API offers.
//
// The production access token can move money (there is no read-only scope), so:
// - it is stored only encrypted, bound to its user, and is never returned by the API or logged;
// - every request goes through mpGet(), which only sends GET requests and only to the paths in
//   READ_ONLY. There is deliberately no way here to create payments, refunds or anything else.
//   Generating reports needs POST calls: add them only with the owner's approval, one path at a time.

const READ_ONLY: RegExp[] = [
  /^\/users\/me$/,
  /^\/v1\/payments\/search$/,
  /^\/v1\/payments\/\d+$/,
  /^\/users\/\d+\/mercadopago_account\/balance$/,
  /^\/v1\/account\/(release|settlement)_report\/(config|list)$/,
  /^\/v1\/account\/(release|settlement)_report\/[\w.-]+\.(csv|xlsx)$/,
];

const TIMEOUT_MS = 10_000;

export type MpResponse = { status: number; body: unknown };

export async function mpGet(token: string, pathAndQuery: string): Promise<MpResponse> {
  const url = new URL(pathAndQuery, config.mpApiUrl);
  if (!READ_ONLY.some((re) => re.test(url.pathname))) throw new Error(`Mercado Pago path not allowed: ${url.pathname}`);
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
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

export type MpCheck = { key: 'identity' | 'payments' | 'balance' | 'release_report' | 'settlement_report'; status: 'ok' | 'unavailable' | 'error'; http: number | null };

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
      out.push({ key, status: status === 200 ? 'ok' : [401, 403, 404].includes(status) ? 'unavailable' : 'error', http: status });
    } catch {
      out.push({ key, status: 'error', http: null });
    }
  }
  return out;
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
