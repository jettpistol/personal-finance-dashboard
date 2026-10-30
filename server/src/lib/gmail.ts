import { config } from '../config.js';
import { HttpError } from './http.js';

// Gmail, read-only (scope gmail.readonly), to bring statements that banks send by email.
// Only three kinds of request ever leave the server: the OAuth token exchange/refresh, GETs to the
// Gmail API paths listed in GMAIL_PATHS, and a token revoke on disconnect. No token is ever logged.

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TIMEOUT_MS = 20_000;
const MAX_MESSAGES = 100;

export function gmailConfigured(): boolean {
  return !!(config.google.clientId && config.google.clientSecret);
}

/** Thrown when Google says the stored grant is gone (revoked, expired, password changed). */
export class GmailRevoked extends Error {}

export function authorizeUrl(state: string, redirectUri: string): string {
  const u = new URL(config.google.authUrl);
  u.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    // offline + consent: Google hands out a refresh token, also when connecting a second time.
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  return u.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; scope?: string }> {
  let res: Response;
  try {
    res = await fetch(config.google.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, 'No se pudo conectar con Google. Probá de nuevo en un rato.');
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (body.error === 'invalid_grant') throw new GmailRevoked('Google ya no acepta el permiso. Conectá Gmail de nuevo.');
  if (!res.ok || !body.access_token) throw new HttpError(502, `Google rechazó el pedido${body.error ? ` (${body.error})` : ''}.`);
  return { access_token: body.access_token, refresh_token: body.refresh_token, scope: body.scope };
}

/** Trades the code from Google's consent screen for a refresh token. */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string }> {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!t.refresh_token) throw new HttpError(502, 'Google no entregó un permiso permanente. Quitá el acceso de la app en tu cuenta de Google y conectá de nuevo.');
  if (t.scope && !t.scope.split(' ').includes(GMAIL_SCOPE)) throw new HttpError(400, 'Hay que permitir que la app lea tus correos (solo lectura) para traer los resúmenes.');
  return { refreshToken: t.refresh_token, accessToken: t.access_token };
}

export async function accessToken(refreshToken: string): Promise<string> {
  return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })).access_token;
}

/** Best effort: Google forgets the grant. Failing here doesn't stop a disconnect. */
export async function revoke(refreshToken: string): Promise<void> {
  try {
    await fetch(config.google.revokeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    /* the person can still remove it from their Google account */
  }
}

const GMAIL_PATHS = [/^\/gmail\/v1\/users\/me\/profile$/, /^\/gmail\/v1\/users\/me\/messages$/, /^\/gmail\/v1\/users\/me\/messages\/[\w-]+$/, /^\/gmail\/v1\/users\/me\/messages\/[\w-]+\/attachments\/[\w-]+$/];

/** GET only, and only to the paths this feature needs. */
async function gmailGet<T>(token: string, path: string, query: Record<string, string> = {}): Promise<T> {
  if (!GMAIL_PATHS.some((re) => re.test(path))) throw new Error(`Gmail path not allowed: ${path}`);
  const u = new URL(path, config.google.gmailUrl);
  u.search = new URLSearchParams(query).toString();
  let res: Response;
  try {
    res = await fetch(u, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, 'No se pudo conectar con Gmail. Probá de nuevo en un rato.');
  }
  if (res.status === 401) throw new GmailRevoked('Gmail ya no acepta el permiso. Conectá Gmail de nuevo.');
  if (!res.ok) throw new HttpError(502, `Gmail respondió con un error (${res.status}).`);
  return (await res.json()) as T;
}

export async function profileEmail(token: string): Promise<string | null> {
  return (await gmailGet<{ emailAddress?: string }>(token, '/gmail/v1/users/me/profile')).emailAddress ?? null;
}

/** Ids of the messages that match a Gmail search, newest first, at most MAX_MESSAGES. */
export async function searchMessages(token: string, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(token, '/gmail/v1/users/me/messages', {
      q,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_MESSAGES);
  return ids.slice(0, MAX_MESSAGES);
}

type Part = { filename?: string; mimeType?: string; body?: { attachmentId?: string; data?: string; size?: number }; parts?: Part[] };

export type PdfAttachment = { fileName: string; data: Buffer };

const fromBase64Url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** The PDF attachments of a message and when it arrived (ISO). */
export async function messagePdfs(token: string, id: string): Promise<{ receivedAt: string; pdfs: PdfAttachment[] }> {
  const msg = await gmailGet<{ internalDate?: string; payload?: Part }>(token, `/gmail/v1/users/me/messages/${id}`, { format: 'full' });
  const parts: Part[] = [];
  const walk = (p: Part | undefined) => {
    if (!p) return;
    if (p.filename && (/\.pdf$/i.test(p.filename) || p.mimeType === 'application/pdf')) parts.push(p);
    p.parts?.forEach(walk);
  };
  walk(msg.payload);
  const pdfs: PdfAttachment[] = [];
  for (const p of parts) {
    let data = p.body?.data;
    if (!data && p.body?.attachmentId) {
      data = (await gmailGet<{ data?: string }>(token, `/gmail/v1/users/me/messages/${id}/attachments/${p.body.attachmentId}`)).data;
    }
    if (data) pdfs.push({ fileName: p.filename!, data: fromBase64Url(data) });
  }
  const ms = Number(msg.internalDate);
  return { receivedAt: new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now()).toISOString(), pdfs };
}
