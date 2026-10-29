import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { currentProfileId, db, type DB } from '../db/index.js';
import { journalTables, type TableMeta } from '../db/undo-journal.js';
import { HttpError } from './http.js';

// Deshacer: every mutating API request that writes synchronously runs with a fresh undo token in
// temp.undo_ctx, so the TEMP triggers of db/undo-journal.ts record each row it inserts, updates or
// deletes (cascades included). When the request succeeds and changed something, the response
// carries `x-undo-token`; POST /api/undo/:token replays the journal backwards in one transaction.
//
// The token is set only while the handler runs synchronously and is cleared as soon as the call
// returns (before its promise is awaited), so no other request can ever be mixed in. Writes that a
// route makes after an `await` are therefore not journaled: such routes are listed below and are
// not wrapped; the ones that matter wrap just their synchronous write section with undoable().

/** How long an action can be undone. */
export const UNDO_WINDOW_MS = 2 * 60_000;
/** How long journal entries, tokens and trashed files are kept. */
const KEEP_MS = 10 * 60_000;
const GONE = 'Ya no se puede deshacer';
const CHANGED = 'No se puede deshacer: hubo cambios después';
const TOKEN_RE = /^[a-f0-9]{32}$/;

/**
 * Mutating routes that are NOT wrapped automatically, and why. Every other POST/PUT/PATCH/DELETE
 * under /api is wrapped: a new route becomes undoable by itself as long as it does all its
 * database writes before its first `await`. A route that writes after an await must be listed
 * here (or wrap its synchronous write section with undoable()), or its undo would be partial.
 */
export const NOT_WRAPPED: Record<string, string> = {
  // Logins, people and personal preferences live in the core database (never journaled).
  'POST /api/auth/setup': 'Logins (core database).',
  'POST /api/auth/login': 'Logins (core database).',
  'POST /api/auth/accounts': 'Logins (core database).',
  'POST /api/auth/switch': 'Logins (core database).',
  'POST /api/auth/logout': 'Logins (core database).',
  'POST /api/auth/password': 'Logins (core database).',
  'POST /api/users': 'People (core database).',
  'PATCH /api/me': 'Personal preferences (core database).',
  'POST /api/me/email/test': 'Sends an email; changes nothing.',
  'POST /api/me/telegram/code': 'Short-lived code in memory.',
  'POST /api/me/telegram/verify': 'Writes after asking Telegram (await); core database.',
  'POST /api/me/telegram/test': 'Sends a message; changes nothing.',
  'PUT /api/mail/settings': 'The sending account (password) is never journaled.',
  'DELETE /api/mail/settings': 'The sending account (password) is never journaled.',
  'POST /api/mail/settings/test': 'Sends an email; changes nothing.',
  // Data profiles: whole databases, not rows.
  'POST /api/profiles': 'Creates a database file.',
  'PATCH /api/profiles/:id': 'Profile list (core database).',
  'DELETE /api/profiles/:id': 'Deletes a database file.',
  'POST /api/profiles/select': 'Only sets a cookie.',
  // Mercado Pago: each person's own connection; most of it talks to Mercado Pago first.
  'PUT /api/me/mercadopago': 'Verifies the token with Mercado Pago (await) before writing.',
  'POST /api/me/mercadopago/check': 'Talks to Mercado Pago (await).',
  'POST /api/me/mercadopago/reports': 'Talks to Mercado Pago (await).',
  'POST /api/me/mercadopago/account': 'Personal connection setting.',
  'POST /api/me/mercadopago/sync': 'Talks to Mercado Pago (await); the movements it saves are wrapped with undoable() in lib/mp-sync.ts.',
  'DELETE /api/me/mercadopago': 'Encrypted token (core database).',
  // Files and network: the writes come after an await.
  'POST /api/transactions/csv': 'Reads the upload first; the commit is wrapped with undoable() in lib/csv-movements.ts.',
  'POST /api/transactions/:id/receipt': 'Upload (await); replaces the file.',
  'POST /api/goals/:id/image': 'Upload (await); replaces the file.',
  'POST /api/imports/upload': 'Keeps the file in memory; saves nothing.',
  'POST /api/imports/raw': 'Preview; saves nothing.',
  'POST /api/imports/preview': 'Preview; saves nothing.',
  'POST /api/statements/detect': 'Recognition and checks; saves nothing.',
  'POST /api/statements/preview': 'Preview; saves nothing.',
  'POST /api/fx/refresh': 'Downloads quotes (await).',
  'POST /api/cpi/refresh': 'Downloads the CPI (await).',
  'POST /api/backups': 'Writes a backup file (await).',
  'POST /api/reviews/:month/send': 'Sends by Telegram (await), then stamps the month.',
  // Save nothing, or nothing worth undoing.
  'POST /api/transactions/suggest': 'Suggests a category; saves nothing.',
  'POST /api/rules/test': 'Preview; saves nothing.',
  'POST /api/budgets/suggest': 'Suggested amounts; saves nothing.',
  'POST /api/notifications/read': 'Marks the bell as read (trivial; would mix into the next undo).',
  'DELETE /api/audit': 'The activity log lives in the core database.',
  'POST /api/undo/:token': 'The undo itself.',
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type TrashedFile = { from: string; trashed: string };
type UndoRecord = {
  userId: number;
  profileId: number | null;
  db: DB;
  at: number;
  used: boolean;
  /** Actividad entries the action wrote (lib/audit-routes.ts), for the "Deshizo: …" line. */
  auditIds: number[];
  files: TrashedFile[];
};

declare module 'fastify' {
  interface FastifyRequest {
    undoToken?: string;
    undoDb?: DB;
    undoProfileId?: number | null;
    /** Set by the Actividad hook: the entries this request wrote. */
    auditIds?: number[];
  }
}

const records = new Map<string, UndoRecord>();
/** Files moved to the trash by a request still being handled, by token. */
const pendingFiles = new Map<string, TrashedFile[]>();
/** Token of the synchronous section running right now (for files). */
let activeToken: string | null = null;
const knownDbs = new Set<DB>();

const trashDir = () => path.join(config.dataDir, '.trash');
const newToken = () => crypto.randomBytes(16).toString('hex');

type Stmts = { set: (t: string) => void; clear: () => void; count: (t: string) => number; drop: (t: string) => void; purge: (before: number) => void };
const stmtCache = new WeakMap<DB, Stmts>();
function stmts(d: DB): Stmts {
  let s = stmtCache.get(d);
  if (!s) {
    const del = d.prepare('DELETE FROM temp.undo_ctx');
    const ins = d.prepare('INSERT INTO temp.undo_ctx (req) VALUES (?)');
    const count = d.prepare('SELECT COUNT(*) AS n FROM temp.undo_log WHERE req = ?');
    const drop = d.prepare('DELETE FROM temp.undo_log WHERE req = ?');
    const purge = d.prepare('DELETE FROM temp.undo_log WHERE at < ?');
    s = {
      set: (t) => {
        del.run();
        ins.run(t);
      },
      clear: () => del.run(),
      count: (t) => (count.get(t) as { n: number }).n,
      drop: (t) => drop.run(t),
      purge: (before) => purge.run(before),
    };
    stmtCache.set(d, s);
  }
  return s;
}

function journaled(d: DB) {
  return journalTables(d).size > 0;
}

/** Runs fn with the request's undo token set on its database. fn must be synchronous. */
function runJournaled<T>(req: FastifyRequest, fn: () => T): T {
  const d = req.undoDb ?? db();
  if (!journaled(d)) return fn();
  const token = (req.undoToken ??= newToken());
  req.undoDb = d;
  if (req.undoProfileId === undefined) req.undoProfileId = currentProfileId();
  if (activeToken === token) return fn();
  knownDbs.add(d);
  const s = stmts(d);
  s.set(token);
  activeToken = token;
  try {
    return fn();
  } finally {
    activeToken = null;
    s.clear();
  }
}

/**
 * For routes that aren't wrapped because they await before writing (uploads, CSV): journals the
 * writes fn makes, so the response gets an undo token. fn must be synchronous.
 */
export function undoable<T>(req: FastifyRequest, fn: () => T): T {
  return runJournaled(req, fn);
}

/**
 * Deletes a stored file (a receipt, an objective's picture). Inside an undoable action it goes to
 * DATA_DIR/.trash instead, so the undo can bring it back; trashed files are deleted after 10 minutes.
 */
export function removeStoredFile(file: string) {
  const token = activeToken;
  if (!token) {
    fs.rm(file, { force: true }, () => {});
    return;
  }
  if (!fs.existsSync(file)) return;
  try {
    fs.mkdirSync(trashDir(), { recursive: true });
    const trashed = path.join(trashDir(), `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${path.basename(file)}`);
    fs.renameSync(file, trashed);
    const list = pendingFiles.get(token) ?? [];
    list.push({ from: file, trashed });
    pendingFiles.set(token, list);
  } catch {
    fs.rm(file, { force: true }, () => {});
  }
}

function restoreFiles(files: TrashedFile[]) {
  for (const f of files) {
    try {
      if (!fs.existsSync(f.from)) {
        fs.mkdirSync(path.dirname(f.from), { recursive: true });
        fs.renameSync(f.trashed, f.from);
      } else fs.rmSync(f.trashed, { force: true });
    } catch (e) {
      console.error('[undo] could not restore a file:', (e as Error).message);
    }
  }
}

const dropFiles = (files: TrashedFile[]) => files.forEach((f) => fs.rm(f.trashed, { force: true }, () => {}));

function purge(now = Date.now()) {
  for (const [token, r] of records) {
    if (now - r.at <= KEEP_MS) continue;
    dropFiles(r.files);
    records.delete(token);
  }
  for (const d of knownDbs) {
    if (!d.open) {
      knownDbs.delete(d);
      continue;
    }
    try {
      stmts(d).purge(now - KEEP_MS);
    } catch {
      /* closed meanwhile */
    }
  }
}

/** Trash left by an earlier run can't be restored any more (tokens live in memory). */
function cleanOldTrash() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(trashDir())) {
      const at = Number(f.split('-')[0]);
      if (!Number.isFinite(at) || now - at > KEEP_MS) fs.rmSync(path.join(trashDir(), f), { force: true });
    }
  } catch {
    /* no trash folder */
  }
}

/** Is this mutating route wrapped automatically? */
export function wrappedAutomatically(key: string): boolean {
  return !(key in NOT_WRAPPED);
}

/** Call before the routes are registered, after the Actividad hooks (its onSend runs first). */
export function installUndoHooks(app: FastifyInstance) {
  cleanOldTrash();
  setInterval(() => purge(), 60_000).unref();

  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/')) return;
    const methods = (Array.isArray(r.method) ? r.method : [r.method]).filter((m) => MUTATING.has(m));
    if (!methods.length || methods.some((m) => !wrappedAutomatically(`${m} ${r.url}`))) return;
    const handler = r.handler;
    r.handler = function (this: unknown, req: FastifyRequest, reply: FastifyReply) {
      // Clears the token right after the synchronous part: whatever is awaited isn't journaled.
      return runJournaled(req, () => (handler as (this: unknown, a: FastifyRequest, b: FastifyReply) => unknown).call(this, req, reply));
    } as typeof r.handler;
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const token = req.undoToken;
    const d = req.undoDb;
    if (!token || !d) return payload;
    const files = pendingFiles.get(token) ?? [];
    pendingFiles.delete(token);
    try {
      const ok = reply.statusCode >= 200 && reply.statusCode < 300;
      if (ok && d.open && stmts(d).count(token) > 0) {
        records.set(token, { userId: req.userId, profileId: req.undoProfileId ?? null, db: d, at: Date.now(), used: false, auditIds: req.auditIds ?? [], files });
        reply.header('x-undo-token', token);
      } else {
        if (d.open) stmts(d).drop(token);
        // The request failed: whatever it trashed goes back (an orphan file is harmless, a missing one isn't).
        if (ok) dropFiles(files);
        else restoreFiles(files);
      }
      purge();
    } catch (e) {
      console.error('[undo] onSend failed:', (e as Error).message);
    }
    return payload;
  });
}

type LogEntry = { id: number; tbl: string; op: 'I' | 'U' | 'D'; rid: number; old: string | null; new: string | null };

function rowJson(d: DB, t: TableMeta, rid: number): string | null {
  const r = d.prepare(`SELECT ${t.json()} AS j FROM main."${t.name}" WHERE rowid = ?`).get(rid) as { j: string } | undefined;
  return r?.j ?? null;
}

function apply(d: DB, t: TableMeta, e: LogEntry) {
  const q = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const from = (c: string) => `json_extract(@j, '$.${q(c)}')`;
  if (e.op === 'I') {
    d.prepare(`DELETE FROM main."${t.name}" WHERE rowid = @rid`).run({ rid: e.rid });
  } else if (e.op === 'U') {
    d.prepare(`UPDATE main."${t.name}" SET ${t.cols.map((c) => `${q(c)} = ${from(c)}`).join(', ')} WHERE rowid = @rid`).run({ j: e.old, rid: e.rid });
  } else {
    const cols = t.cols.map(q);
    const values = t.cols.map(from);
    if (t.rowidAlias) d.prepare(`INSERT INTO main."${t.name}" (${cols.join(', ')}) VALUES (${values.join(', ')})`).run({ j: e.old });
    else d.prepare(`INSERT INTO main."${t.name}" (rowid, ${cols.join(', ')}) VALUES (@rid, ${values.join(', ')})`).run({ j: e.old, rid: e.rid });
  }
}

class Conflict extends Error {}

/** Replays a token's journal backwards. Throws Conflict when something changed since. */
function replay(d: DB, token: string) {
  const entries = d.prepare('SELECT id, tbl, op, rid, old, new FROM temp.undo_log WHERE req = ? ORDER BY id').all(token) as LogEntry[];
  if (!entries.length) throw new HttpError(404, GONE);
  const tables = journalTables(d);
  const replayToken = `replay:${token}`;
  const s = stmts(d);
  const countHard = d.prepare('SELECT tbl FROM temp.undo_log WHERE req = ?');
  d.transaction(() => {
    d.pragma('defer_foreign_keys = ON');
    // Every row the action touched must still be as the action left it.
    const last = new Map<string, LogEntry>();
    for (const e of entries) last.set(`${e.tbl}\u0000${e.rid}`, e);
    const skip = new Set<string>();
    for (const [key, e] of last) {
      const t = tables.get(e.tbl);
      if (!t) throw new Conflict();
      const expected = e.op === 'D' ? null : e.new;
      if (rowJson(d, t, e.rid) === expected) continue;
      if (t.soft) skip.add(key);
      else throw new Conflict();
    }
    // Replay, journaling under a separate token: any extra row touched (a cascade into something
    // created later) means the undo would reach beyond the action.
    let expected = 0;
    s.set(replayToken);
    try {
      for (const e of [...entries].reverse()) {
        if (skip.has(`${e.tbl}\u0000${e.rid}`)) continue;
        const t = tables.get(e.tbl)!;
        apply(d, t, e);
        if (!t.soft) expected++;
      }
    } finally {
      s.clear();
    }
    const touched = (countHard.all(replayToken) as { tbl: string }[]).filter((r) => !tables.get(r.tbl)?.soft).length;
    if (touched !== expected) throw new Conflict();
    s.drop(replayToken);
    s.drop(token);
  })();
}

/** POST /api/undo/:token. */
export function undoAction(token: string, userId: number): { ok: true } {
  purge();
  const r = TOKEN_RE.test(token) ? records.get(token) : undefined;
  const d = db();
  if (!r || r.used || r.userId !== userId || r.db !== d || r.profileId !== currentProfileId() || Date.now() - r.at > UNDO_WINDOW_MS || !d.open) {
    throw new HttpError(404, GONE);
  }
  try {
    replay(d, token);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (!(e instanceof Conflict)) console.error('[undo] replay failed:', (e as Error).message);
    // A deferred foreign key or a unique value taken since: same answer, nothing was changed.
    throw new HttpError(409, CHANGED);
  }
  r.used = true;
  restoreFiles(r.files);
  r.files = [];
  return { ok: true };
}

/** Actividad entries written by the action a token undid (only once it was undone). */
export function undoneAuditIds(token: string): number[] {
  const r = records.get(token);
  return r?.used ? r.auditIds : [];
}
