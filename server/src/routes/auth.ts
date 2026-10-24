import type { FastifyInstance, FastifyReply } from 'fastify';
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
  sessionUser,
  validatePasswordStrength,
  verifyPassword,
} from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import { SESSION_COOKIE } from '../app.js';
import { parse } from './util.js';

const MAX_USERS = 4;

const newUserSchema = z.object({
  username: z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo'),
  display_name: z.string().trim().min(1).max(60),
  password: z.string().max(200),
  color: z.string().max(20).optional(),
});

function setSessionCookie(reply: FastifyReply, userId: number) {
  const { token, expiresAt } = createSession(userId);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    expires: new Date(expiresAt),
  });
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
  app.get('/auth/status', async (req) => {
    const uid = sessionUser(req.cookies[SESSION_COOKIE]);
    const user = uid
      ? coreDb().prepare('SELECT id, username, display_name, color FROM users WHERE id = ?').get(uid)
      : null;
    return { needsSetup: userCount() === 0, user };
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
    setSessionCookie(reply, userId);
    return { ok: true };
  });

  app.post('/auth/login', async (req, reply) => {
    const { username, password } = parse(z.object({ username: z.string().max(60), password: z.string().max(200) }), req.body);
    const keys = attemptKeys(username, req.ip);
    const wait = lockRemaining(keys);
    if (wait > 0) {
      reply.header('retry-after', Math.ceil(wait / 1000));
      return reply.code(429).send({ error: `Demasiados intentos. Esperá ${Math.ceil(wait / 1000)} segundos.`, retryAfter: Math.ceil(wait / 1000) });
    }
    const user = coreDb().prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username.trim()) as
      | { id: number; password_hash: string }
      | undefined;
    const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
    if (!user || !ok) {
      const locked = registerFailure(keys);
      if (locked > 0) {
        reply.header('retry-after', Math.ceil(locked / 1000));
        return reply.code(429).send({
          error: `Usuario o contraseña incorrectos. Por seguridad, esperá ${Math.ceil(locked / 1000)} segundos antes de reintentar.`,
          retryAfter: Math.ceil(locked / 1000),
        });
      }
      return reply.code(401).send({ error: 'Usuario o contraseña incorrectos.' });
    }
    clearFailures(keys);
    setSessionCookie(reply, user.id);
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    destroySession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
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
