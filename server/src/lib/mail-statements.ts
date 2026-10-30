import crypto from 'node:crypto';
import { coreDb, db } from '../db/index.js';
import { logAction } from './audit.js';
import { accountVisible, loadAccounts } from './domain.js';
import { addDays, isValidDate, today } from './dates.js';
import { formatMoney } from './money.js';
import { HttpError } from './http.js';
import { notify } from './notify.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { READERS, readStatement, UnrecognisedFile } from './statements/registry.js';
import { summarizeStatement, type StatementSummary } from './statements/rows.js';
import { saveUpload } from './uploads.js';
import { GmailRevoked, accessToken, authorizeUrl, exchangeCode, gmailConfigured, messagePdfs, profileEmail, revoke, searchMessages } from './gmail.js';

// Statements that banks send by email (Naranja X today), brought from each person's Gmail.
//
// Each person connects their own Gmail once (read-only); the refresh token is stored encrypted in
// the core database, like a Mercado Pago token. Then, in each data profile where they turn it on,
// the scheduler looks every 6 hours for the emails of the formats that declare a `mailQuery`
// (statements/registry.ts), reads each PDF attachment with the same readers as Resúmenes, and
// keeps the recognised ones waiting in Resúmenes → Recibidos por correo. Importing still goes
// through the usual review: the statement opens in the Resúmenes wizard with the account it went
// to last time already chosen. Nothing is imported without that review.

const FETCH_EVERY_MS = 6 * 3600_000;
const STATE_TTL_MS = 10 * 60_000;
const log = (msg: string) => console.log(`[gmail] ${msg}`);
const context = (userId: number) => `gmail:${userId}`;

// ---- Connection (core database) ----

type ConnRow = { user_id: number; token_enc: string; email: string | null; connected_at: string; last_error: string | null };
const connRow = (userId: number) => coreDb().prepare('SELECT * FROM gmail_connections WHERE user_id = ?').get(userId) as ConnRow | undefined;

function storedRefreshToken(userId: number): string | null {
  const r = connRow(userId);
  return r ? decryptSecret(r.token_enc, context(userId)) : null;
}

export function connectionView(userId: number) {
  const r = connRow(userId);
  return {
    configured: gmailConfigured(),
    connected: !!r,
    email: r?.email ?? null,
    connected_at: r?.connected_at ?? null,
    error: r?.last_error ?? null,
  };
}

// Consent screen round trip: the state ties Google's answer to who asked, in which profile.
const states = new Map<string, { userId: number; redirectUri: string; expires: number }>();

export function startConnect(userId: number, redirectUri: string): string {
  if (!gmailConfigured()) throw new HttpError(400, 'Falta configurar el acceso a Gmail en el servidor (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET).');
  for (const [k, s] of states) if (s.expires < Date.now()) states.delete(k);
  const state = crypto.randomBytes(24).toString('base64url');
  states.set(state, { userId, redirectUri, expires: Date.now() + STATE_TTL_MS });
  return authorizeUrl(state, redirectUri);
}

export async function finishConnect(userId: number, state: string, code: string): Promise<void> {
  const s = states.get(state);
  states.delete(state);
  if (!s || s.userId !== userId || s.expires < Date.now()) throw new HttpError(400, 'El pedido a Google venció o no es de esta sesión. Probá conectar de nuevo.');
  const t = await exchangeCode(code, s.redirectUri);
  const email = await profileEmail(t.accessToken).catch(() => null);
  const old = storedRefreshToken(userId);
  coreDb()
    .prepare(
      `INSERT INTO gmail_connections (user_id, token_enc, email, connected_at, last_error) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(user_id) DO UPDATE SET token_enc = excluded.token_enc, email = excluded.email, connected_at = excluded.connected_at, last_error = NULL`,
    )
    .run(userId, encryptSecret(t.refreshToken, context(userId)), email, new Date().toISOString());
  // Google's answer arrives as a page load (GET), which Actividad doesn't log by itself.
  logAction({ userId, section: 'Ajustes', action: 'conectar', entity: 'gmail', summary: `Conectó su Gmail para traer resúmenes${email ? ` (${email.slice(0, 80)})` : ''}`, privateTo: userId, profileId: null });
  if (old && old !== t.refreshToken) await revoke(old);
  log(`user ${userId} connected Gmail`);
}

export async function disconnect(userId: number): Promise<void> {
  const token = storedRefreshToken(userId);
  coreDb().prepare('DELETE FROM gmail_connections WHERE user_id = ?').run(userId);
  if (token) await revoke(token);
}

function setConnError(userId: number, error: string | null) {
  coreDb().prepare('UPDATE gmail_connections SET last_error = ? WHERE user_id = ?').run(error, userId);
}

// ---- Fetching, per person and data profile ----

type SyncRow = { user_id: number; since: string; last_fetch_at: string | null; last_error: string | null };
const syncRow = (userId: number) => db().prepare('SELECT * FROM mail_sync WHERE user_id = ?').get(userId) as SyncRow | undefined;

export function syncView(userId: number) {
  const r = syncRow(userId);
  return r ? { on: true, since: r.since, last_fetch_at: r.last_fetch_at, error: r.last_error } : { on: false, since: null, last_fetch_at: null, error: null };
}

/** By default, the last three months: enough to catch the statement that just arrived. */
export function defaultSince(): string {
  return addDays(today(), -90);
}

export function startSync(userId: number, since: string) {
  if (!isValidDate(since) || since > today()) throw new HttpError(400, 'Elegí una fecha válida, no futura.', 'since');
  db()
    .prepare(`INSERT INTO mail_sync (user_id, since) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET since = excluded.since`)
    .run(userId, since);
}

export function stopSync(userId: number) {
  db().prepare('DELETE FROM mail_sync WHERE user_id = ?').run(userId);
}

/** One Gmail search covering every format that arrives by email. */
export function mailQuery(since: string): string {
  const parts = READERS.filter((r) => r.mailQuery).map((r) => `(${r.mailQuery})`);
  return `${parts.length > 1 ? `{${parts.join(' ')}}` : parts[0]} after:${since.replace(/-/g, '/')}`;
}

type Found = { added: number; recognised: number };

/**
 * Looks in the person's Gmail for statements not seen yet. Each attachment is stored once, so the
 * next run skips it; unrecognised PDFs are remembered without their contents.
 */
export async function fetchStatements(userId: number): Promise<Found> {
  const sync = syncRow(userId);
  if (!sync) throw new HttpError(400, 'Activá la búsqueda de resúmenes en este perfil primero.');
  const refresh = storedRefreshToken(userId);
  if (!refresh) throw new HttpError(400, 'Conectá tu cuenta de Gmail primero.');
  const found: Found = { added: 0, recognised: 0 };
  try {
    const token = await accessToken(refresh);
    const seen = db().prepare('SELECT 1 FROM mail_statements WHERE user_id = ? AND message_id = ? LIMIT 1');
    const ids = (await searchMessages(token, mailQuery(sync.since))).filter((id) => !seen.get(userId, id));
    // Oldest first, so the bell lists them in the order they arrived.
    for (const id of ids.reverse()) {
      const { receivedAt, pdfs } = await messagePdfs(token, id);
      for (const pdf of pdfs) {
        const added = await storeAttachment(userId, id, receivedAt, pdf.fileName, pdf.data);
        found.added += 1;
        if (added.status === 'pending') {
          found.recognised += 1;
          await announce(userId, added.summary!, added.institution!);
        }
      }
      // A message without PDFs is remembered too, so it isn't downloaded every time.
      if (!pdfs.length) insertRow(userId, id, receivedAt, '', { status: 'unrecognised', error: 'El correo no trae un PDF adjunto.' });
    }
    await retryFailed(userId);
    db().prepare(`UPDATE mail_sync SET last_fetch_at = ?, last_error = NULL WHERE user_id = ?`).run(new Date().toISOString(), userId);
    setConnError(userId, null);
    if (ids.length) log(`user ${userId}: ${ids.length} new email(s), ${found.recognised} statement(s)`);
    return found;
  } catch (e) {
    const message = (e as Error).message;
    db().prepare(`UPDATE mail_sync SET last_fetch_at = ?, last_error = ? WHERE user_id = ?`).run(new Date().toISOString(), message, userId);
    if (e instanceof GmailRevoked) setConnError(userId, message);
    log(`user ${userId}: ${message}`);
    throw e instanceof HttpError ? e : new HttpError(502, message);
  }
}

type RowFields = {
  status: 'pending' | 'unrecognised' | 'failed';
  readerId?: string | null;
  accountRef?: string | null;
  summary?: StatementSummary | null;
  integrityOk?: boolean | null;
  error?: string | null;
  data?: Buffer | null;
};

function insertRow(userId: number, messageId: string, receivedAt: string, fileName: string, f: RowFields) {
  db()
    .prepare(
      `INSERT OR IGNORE INTO mail_statements (user_id, message_id, file_name, received_at, status, reader_id, account_ref, summary, integrity_ok, error, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      messageId,
      fileName,
      receivedAt,
      f.status,
      f.readerId ?? null,
      f.accountRef ?? null,
      f.summary ? JSON.stringify(f.summary) : null,
      f.integrityOk == null ? null : f.integrityOk ? 1 : 0,
      f.error ?? null,
      f.data ? f.data.toString('base64') : null,
    );
}

async function recognise(fileName: string, data: Buffer): Promise<RowFields & { institution?: string }> {
  try {
    const { reader, statement } = await readStatement(fileName, data);
    return {
      status: 'pending',
      readerId: reader.id,
      institution: reader.institution,
      accountRef: statement.accountRef,
      summary: summarizeStatement(statement),
      integrityOk: statement.integrity.ok,
      data,
    };
  } catch (e) {
    // Not a format we read (an ad, a terms update): keep only the fact. A reading error keeps the
    // file, so a newer version of the reader can try it again.
    if (e instanceof UnrecognisedFile) return { status: 'unrecognised', error: e.message };
    return { status: 'failed', error: `No se pudo leer: ${(e as Error).message}`, data };
  }
}

async function storeAttachment(userId: number, messageId: string, receivedAt: string, fileName: string, data: Buffer) {
  const r = await recognise(fileName, data);
  insertRow(userId, messageId, receivedAt, fileName, r);
  return r;
}

/** Statements that failed to read get another try, in case the reader was improved since. */
async function retryFailed(userId: number) {
  const rows = db().prepare(`SELECT id, file_name, data FROM mail_statements WHERE user_id = ? AND status = 'failed' AND data IS NOT NULL`).all(userId) as {
    id: number;
    file_name: string;
    data: string;
  }[];
  for (const row of rows) {
    const r = await recognise(row.file_name, Buffer.from(row.data, 'base64'));
    if (r.status !== 'pending') continue;
    db()
      .prepare(`UPDATE mail_statements SET status = 'pending', reader_id = ?, account_ref = ?, summary = ?, integrity_ok = ?, error = NULL WHERE id = ?`)
      .run(r.readerId, r.accountRef, JSON.stringify(r.summary), r.integrityOk ? 1 : 0, row.id);
    await announce(userId, r.summary!, r.institution!);
  }
}

async function announce(userId: number, s: StatementSummary, institution: string) {
  const body =
    s.kind === 'card'
      ? `Total a pagar ${formatMoney(s.totalDue.ars, 'ARS')}${s.totalDue.usd ? ` y ${formatMoney(s.totalDue.usd, 'USD')}` : ''}, vence el ${s.dueDate.slice(8, 10)}/${s.dueDate.slice(5, 7)}. Revisalo en Resúmenes para importarlo.`
      : 'Revisalo en Resúmenes para importarlo.';
  await notify({ kind: 'system', users: [userId], title: `Llegó el resumen de ${institution}`, body, link: '/resumenes' });
}

/** Called by the scheduler in each data profile. */
export async function fetchDue() {
  const rows = db().prepare('SELECT user_id, last_fetch_at FROM mail_sync').all() as { user_id: number; last_fetch_at: string | null }[];
  for (const r of rows) {
    if (r.last_fetch_at && Date.now() - Date.parse(r.last_fetch_at) < FETCH_EVERY_MS) continue;
    if (!connRow(r.user_id)) continue;
    try {
      await fetchStatements(r.user_id);
    } catch {
      /* stored in mail_sync.last_error and shown in Ajustes */
    }
  }
}

// ---- The list in Resúmenes ----

type ItemRow = {
  id: number;
  file_name: string;
  received_at: string;
  status: string;
  reader_id: string | null;
  account_ref: string | null;
  summary: string | null;
  integrity_ok: number | null;
  error: string | null;
  account_id: number | null;
  batch_id: number | null;
};

/** What arrived by email for this person: pending first, then the last imported or failed ones. */
export function listItems(userId: number) {
  const rows = db()
    .prepare(
      `SELECT id, file_name, received_at, status, reader_id, account_ref, summary, integrity_ok, error, account_id, batch_id FROM mail_statements
       WHERE user_id = ? AND status IN ('pending', 'imported', 'failed')
       ORDER BY status = 'pending' DESC, received_at DESC LIMIT 24`,
    )
    .all(userId) as ItemRow[];
  const readers = new Map(READERS.map((r) => [r.id, r]));
  return rows.map((r) => {
    const reader = r.reader_id ? readers.get(r.reader_id) : undefined;
    return {
      id: r.id,
      file_name: r.file_name,
      received_at: r.received_at,
      status: r.status as 'pending' | 'imported' | 'failed',
      title: reader ? `${reader.institution} · ${reader.product}` : r.file_name,
      summary: r.summary ? (JSON.parse(r.summary) as StatementSummary) : null,
      integrity_ok: r.integrity_ok == null ? null : r.integrity_ok === 1,
      error: r.error,
      account_id: r.account_id,
      batch_id: r.batch_id,
    };
  });
}

function ownRow(userId: number, id: number) {
  const r = db().prepare('SELECT * FROM mail_statements WHERE id = ? AND user_id = ?').get(id, userId) as (ItemRow & { data: string | null }) | undefined;
  if (!r) throw new HttpError(404, 'Ese resumen no existe.');
  return r;
}

/**
 * Hands a stored statement to the Resúmenes wizard as if it had just been uploaded, with the account
 * the same card or account went to last time (if the person can still write to it).
 */
export function openItem(userId: number, id: number) {
  const r = ownRow(userId, id);
  if (!r.data) throw new HttpError(400, 'Este resumen ya no tiene el archivo. Descargalo del correo y subilo a mano.');
  const data = Buffer.from(r.data, 'base64');
  const last = db()
    .prepare(
      `SELECT account_id FROM mail_statements WHERE user_id = ? AND reader_id IS ? AND account_ref IS ? AND status = 'imported' AND account_id IS NOT NULL ORDER BY received_at DESC LIMIT 1`,
    )
    .get(userId, r.reader_id, r.account_ref) as { account_id: number } | undefined;
  const account = last ? loadAccounts().get(last.account_id) : undefined;
  const usable = account && accountVisible(account, userId) && !account.archived;
  return {
    upload_id: saveUpload(userId, r.file_name, data),
    file_name: r.file_name,
    size: data.length,
    account_id: usable ? account.id : null,
  };
}

export function markImported(userId: number, id: number, accountId: number, batchId: number | null) {
  ownRow(userId, id);
  db().prepare(`UPDATE mail_statements SET status = 'imported', account_id = ?, batch_id = ? WHERE id = ?`).run(accountId, batchId, id);
}

/** Not wanted (a duplicate, already loaded by hand): the file is dropped, the email stays seen. */
export function dismissItem(userId: number, id: number) {
  const r = ownRow(userId, id);
  db().prepare(`UPDATE mail_statements SET status = 'dismissed', data = NULL WHERE id = ?`).run(id);
  return r;
}
