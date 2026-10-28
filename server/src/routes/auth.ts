import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { coreDb } from '../db/index.js';
import { profilesEnabled, syncUsers } from '../lib/profiles.js';
import { config } from '../config.js';
import {
  attemptKeys,
  clearFailures,
  createSession,
  destroySession,
  destroyUserSessions,
  getDummyHash,
  hashPassword,
  lockRemaining,
  registerFailure,
  sessionInfo,
  validatePasswordStrength,
  verifyPassword,
} from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import { logAction } from '../lib/audit.js';
import { EXTRA_SESSIONS_COOKIE, SESSION_COOKIE } from '../app.js';
import { parse } from './util.js';

const MAX_USERS = 4;

/** Actividad → Accesos. Logins aren't tied to a data profile; passwords are never part of an entry. */
const logAccess = (userId: number, action: string, summary: string) => logAction({ userId, section: 'Accesos', action, summary, profileId: null });
const nameOf = (id: number | undefined) => (id ? (coreDb().prepare('SELECT display_name FROM users WHERE id = ?').get(id) as { display_name: string } | undefined)?.display_name : undefined);

const newUserSchema = z.object({
  username: z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo'),
  display_name: z.string().trim().min(1).max(60),
  password: z.string().max(200),
  color: z.string().max(20).optional(),
});

// ---- Sessions of this browser ----
// The active session lives in SESSION_COOKIE; other accounts logged in on the same browser keep
// their own sessions in EXTRA_SESSIONS_COOKIE, so switching between them needs no password.

type Sess = { token: string; userId: number; expiresAt: number };
type Sessions = { active: Sess | null; extra: Sess[] };
type PublicUser = { id: number; username: string; display_name: string; color: string };

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

function cookieOptions(expiresAt: number) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.secureCookies, expires: new Date(expiresAt) };
}

function extraTokens(req: FastifyRequest): string[] {
  const raw = req.cookies[EXTRA_SESSIONS_COOKIE];
  return raw ? raw.split('.').filter((t) => TOKEN_RE.test(t)).slice(0, MAX_USERS * 2) : [];
}

/** Reads both cookies, dropping expired or unknown tokens and duplicate users. */
function loadSessions(req: FastifyRequest): Sessions {
  const activeToken = req.cookies[SESSION_COOKIE];
  const info = sessionInfo(activeToken);
  const active = info && activeToken ? { token: activeToken, ...info } : null;
  const seen = new Set(active ? [active.userId] : []);
  const extra: Sess[] = [];
  for (const token of extraTokens(req)) {
    if (token === activeToken) continue;
    const i = sessionInfo(token);
    if (!i) continue;
    if (seen.has(i.userId)) {
      destroySession(token);
      continue;
    }
    seen.add(i.userId);
    extra.push({ token, ...i });
  }
  return { active, extra };
}

/** Writes the cookies back, only where they changed. */
function saveSessions(req: FastifyRequest, reply: FastifyReply, s: Sessions) {
  if (s.active) {
    if (req.cookies[SESSION_COOKIE] !== s.active.token) reply.setCookie(SESSION_COOKIE, s.active.token, cookieOptions(s.active.expiresAt));
  } else if (req.cookies[SESSION_COOKIE]) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }
  const value = s.extra.map((e) => e.token).join('.');
  if (value) {
    if (req.cookies[EXTRA_SESSIONS_COOKIE] !== value) {
      reply.setCookie(EXTRA_SESSIONS_COOKIE, value, cookieOptions(Math.max(...s.extra.map((e) => e.expiresAt))));
    }
  } else if (req.cookies[EXTRA_SESSIONS_COOKIE]) {
    reply.clearCookie(EXTRA_SESSIONS_COOKIE, { path: '/' });
  }
}

function newSession(userId: number): Sess {
  const { token, expiresAt } = createSession(userId);
  return { token, userId, expiresAt };
}

/** Makes a new session the active one; the previous active account (if another user) stays logged in. */
function setSessionCookie(req: FastifyRequest, reply: FastifyReply, userId: number) {
  const s = loadSessions(req);
  const extra = s.extra.filter((e) => {
    if (e.userId !== userId) return true;
    destroySession(e.token);
    return false;
  });
  if (s.active && s.active.userId !== userId) extra.unshift(s.active);
  else if (s.active) destroySession(s.active.token);
  saveSessions(req, reply, { active: newSession(userId), extra });
}

function publicUsers(ids: number[]): PublicUser[] {
  if (!ids.length) return [];
  const rows = coreDb()
    .prepare(`SELECT id, username, display_name, color FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as PublicUser[];
  return ids.map((id) => rows.find((r) => r.id === id)).filter((u): u is PublicUser => !!u);
}

function accountList(s: Sessions) {
  const ids = [...(s.active ? [s.active.userId] : []), ...s.extra.map((e) => e.userId)];
  return publicUsers(ids).map((u) => ({ ...u, active: u.id === s.active?.userId }));
}

// ---- Password check shared by login and "add account" ----

const credentialsSchema = z.object({ username: z.string().max(60), password: z.string().max(200) });

/** Verifies a username/password with the lockout rules. Returns the user id, or null after sending the error. */
async function checkCredentials(req: FastifyRequest, reply: FastifyReply, username: string, password: string): Promise<number | null> {
  const keys = attemptKeys(username, req.ip);
  const wait = lockRemaining(keys);
  if (wait > 0) {
    reply.header('retry-after', Math.ceil(wait / 1000));
    reply.code(429).send({ error: `Demasiados intentos. Esperá ${Math.ceil(wait / 1000)} segundos.`, retryAfter: Math.ceil(wait / 1000) });
    return null;
  }
  const user = coreDb().prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username.trim()) as
    | { id: number; password_hash: string }
    | undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) {
    const locked = registerFailure(keys);
    // Only for a real user (an unknown username could be a password typed in the wrong field).
    if (user) logAccess(user.id, 'fallido', `Intento de ingreso con contraseña incorrecta${locked > 0 ? ` (bloqueado ${Math.ceil(locked / 1000)} s)` : ''}`);
    if (locked > 0) {
      reply.header('retry-after', Math.ceil(locked / 1000));
      reply.code(429).send({
        error: `Usuario o contraseña incorrectos. Por seguridad, esperá ${Math.ceil(locked / 1000)} segundos antes de reintentar.`,
        retryAfter: Math.ceil(locked / 1000),
      });
    } else {
      reply.code(401).send({ error: 'Usuario o contraseña incorrectos.' });
    }
    return null;
  }
  clearFailures(keys);
  return user.id;
}

export function userCount(): number {
  return (coreDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export async function createUser(input: z.infer<typeof newUserSchema>): Promise<number> {
  const weak = validatePasswordStrength(input.password);
  if (weak) throw new HttpError(400, weak);
  const exists = coreDb().prepare('SELECT 1 FROM users WHERE username = ?').get(input.username);
  if (exists) throw new HttpError(409, 'Ese nombre de usuario ya existe.');
  const colors = ['blue', 'pink', 'teal', 'orange'];
  const color = input.color ?? colors[userCount() % colors.length];
  const id = Number(
    coreDb()
      .prepare('INSERT INTO users (username, display_name, password_hash, color) VALUES (?, ?, ?, ?)')
      .run(input.username, input.display_name, await hashPassword(input.password), color).lastInsertRowid,
  );
  if (profilesEnabled()) syncUsers();
  return id;
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/auth/status', async (req, reply) => {
    const s = loadSessions(req);
    // The active session expired but another account of this browser is still logged in: use it.
    if (!s.active && s.extra.length) s.active = s.extra.shift()!;
    saveSessions(req, reply, s);
    const [user] = s.active ? publicUsers([s.active.userId]) : [];
    return { needsSetup: userCount() === 0, user: user ?? null };
  });

  // First run only: creates the first user.
  app.post('/auth/setup', async (req, reply) => {
    const input = parse(newUserSchema, req.body);
    if (userCount() > 0) throw new HttpError(409, 'La configuración inicial ya se realizó.');
    const userId = await createUser(input);
    if (userCount() > 1) {
      // Lost a race with another setup request; undo.
      coreDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
      if (profilesEnabled()) syncUsers();
      throw new HttpError(409, 'La configuración inicial ya se realizó.');
    }
    setSessionCookie(req, reply, userId);
    logAccess(userId, 'crear', 'Creó la primera cuenta e ingresó');
    return { ok: true };
  });

  app.post('/auth/login', async (req, reply) => {
    const { username, password } = parse(credentialsSchema, req.body);
    const userId = await checkCredentials(req, reply, username, password);
    if (userId === null) return reply;
    setSessionCookie(req, reply, userId);
    logAccess(userId, 'ingresar', 'Ingresó');
    return { ok: true };
  });

  // Accounts logged in on this browser (the active one first).
  app.get('/auth/accounts', async (req, reply) => {
    const s = loadSessions(req);
    saveSessions(req, reply, s);
    return accountList(s);
  });

  // Logs another user in on this browser without signing out the active one.
  app.post('/auth/accounts', async (req, reply) => {
    const { username, password, switch: makeActive } = parse(credentialsSchema.extend({ switch: z.boolean().optional() }), req.body);
    const userId = await checkCredentials(req, reply, username, password);
    if (userId === null) return reply;
    const s = loadSessions(req);
    if (s.active?.userId === userId) throw new HttpError(409, 'Ya estás usando esa cuenta.');
    const extra = s.extra.filter((e) => {
      if (e.userId !== userId) return true;
      destroySession(e.token);
      return false;
    });
    const added = newSession(userId);
    const next: Sessions = makeActive || !s.active
      ? { active: added, extra: s.active ? [s.active, ...extra] : extra }
      : { active: s.active, extra: [...extra, added] };
    saveSessions(req, reply, next);
    const from = nameOf(s.active?.userId);
    logAccess(userId, 'ingresar', `Ingresó sumando su cuenta a este navegador${from ? ` (junto a ${from})` : ''}${next.active === added ? '' : ', sin pasar a usarla'}`);
    return { ok: true, accounts: accountList(next) };
  });

  // Switches to another account already logged in on this browser (no password).
  app.post('/auth/switch', async (req, reply) => {
    const { user_id } = parse(z.object({ user_id: z.number().int() }), req.body);
    const s = loadSessions(req);
    if (s.active?.userId !== user_id) {
      const target = s.extra.find((e) => e.userId === user_id);
      if (!target) throw new HttpError(404, 'Esa cuenta no tiene la sesión abierta en este navegador.');
      const from = nameOf(s.active?.userId);
      logAccess(user_id, 'cambiar', `Pasó a usar su cuenta${from ? ` (antes estaba ${from})` : ''}`);
      s.extra = [...(s.active ? [s.active] : []), ...s.extra.filter((e) => e !== target)];
      s.active = target;
    }
    saveSessions(req, reply, s);
    return { ok: true, user: publicUsers([user_id])[0] ?? null };
  });

  // Logs out the active account; another account of this browser, if any, becomes active.
  // With { all: true } every account of this browser is logged out.
  app.post('/auth/logout', async (req, reply) => {
    const { all } = parse(z.object({ all: z.boolean().optional() }), req.body ?? {});
    const leaving = sessionInfo(req.cookies[SESSION_COOKIE])?.userId;
    if (leaving) logAccess(leaving, 'salir', all ? 'Cerró sesión en todas las cuentas de este navegador' : 'Cerró sesión');
    destroySession(req.cookies[SESSION_COOKIE]);
    if (all) {
      for (const t of extraTokens(req)) destroySession(t);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      reply.clearCookie(EXTRA_SESSIONS_COOKIE, { path: '/' });
      return { ok: true, user: null };
    }
    const s = loadSessions(req);
    const next: Sessions = { active: s.extra[0] ?? null, extra: s.extra.slice(1) };
    saveSessions(req, reply, next);
    const [user] = next.active ? publicUsers([next.active.userId]) : [];
    return { ok: true, user: user ?? null };
  });

  app.post('/auth/password', async (req) => {
    const { current, next } = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), req.body);
    const user = coreDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId) as { password_hash: string };
    if (!(await verifyPassword(current, user.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta.', 'current');
    const weak = validatePasswordStrength(next);
    if (weak) throw new HttpError(400, weak, 'next');
    coreDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), req.userId);
    destroyUserSessions(req.userId, req.cookies[SESSION_COOKIE]);
    return { ok: true };
  });

  // Any logged-in member can add another household member (e.g. the partner).
  app.post('/users', async (req) => {
    const input = parse(newUserSchema, req.body);
    if (userCount() >= MAX_USERS) throw new HttpError(400, `Se permiten hasta ${MAX_USERS} usuarios.`);
    const id = await createUser(input);
    return { id };
  });
}
