import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { coreDb } from '../db/index.js';
import { config } from '../config.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(expected, actual);
}

// A hash of a random password, so unknown usernames take as long to reject as known ones.
let dummyHash: Promise<string> | null = null;
export function getDummyHash() {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  return null;
}

// ---- Sessions ----

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: number): { token: string; expiresAt: number } {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + config.sessionDays * 24 * 3600 * 1000;
  coreDb().prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, expiresAt, now);
  coreDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  return { token, expiresAt };
}

/** The user and expiry of a live session, or null if the token is unknown or expired. */
export function sessionInfo(token: string | undefined): { userId: number; expiresAt: number } | null {
  if (!token) return null;
  const row = coreDb().prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hashToken(token)) as
    | { user_id: number; expires_at: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return { userId: row.user_id, expiresAt: row.expires_at };
}

export function sessionUser(token: string | undefined): number | null {
  return sessionInfo(token)?.userId ?? null;
}

export function destroySession(token: string | undefined) {
  if (token) coreDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function destroyUserSessions(userId: number, exceptToken?: string) {
  if (exceptToken) {
    coreDb().prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, hashToken(exceptToken));
  } else {
    coreDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

// ---- Brute-force protection ----
// After 3 failed attempts on a username it is locked, and the lock grows with each further failure.
// The IP is tracked too (with a higher allowance, since both partners may share a home IP),
// so guessing across many usernames is also slowed.

export type AttemptKey = { key: string; free: number };
export const FREE_ATTEMPTS = 3;
const FREE_ATTEMPTS_PER_IP = 10;
const LOCK_STEPS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const FORGET_AFTER_MS = 24 * 3600 * 1000;

type Attempt = { key: string; failures: number; locked_until: number; last_failure_at: number };

function getAttempt(key: string, now: number): Attempt {
  const row = coreDb().prepare('SELECT * FROM login_attempts WHERE key = ?').get(key) as Attempt | undefined;
  if (!row || now - row.last_failure_at > FORGET_AFTER_MS) return { key, failures: 0, locked_until: 0, last_failure_at: 0 };
  return row;
}

/** Returns the number of ms the caller must still wait, or 0 if a login attempt is allowed. */
export function lockRemaining(keys: AttemptKey[], now = Date.now()): number {
  return Math.max(0, ...keys.map((k) => getAttempt(k.key, now).locked_until - now));
}

export function registerFailure(keys: AttemptKey[], now = Date.now()): number {
  let longest = 0;
  for (const { key, free } of keys) {
    const a = getAttempt(key, now);
    const failures = a.failures + 1;
    let lockedUntil = 0;
    if (failures >= free) {
      const step = LOCK_STEPS_MS[Math.min(failures - free, LOCK_STEPS_MS.length - 1)];
      lockedUntil = now + step;
      longest = Math.max(longest, step);
    }
    coreDb()
      .prepare(
        `INSERT INTO login_attempts (key, failures, locked_until, last_failure_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until, last_failure_at = excluded.last_failure_at`,
      )
      .run(key, failures, lockedUntil, now);
  }
  return longest;
}

export function clearFailures(keys: AttemptKey[]) {
  const del = coreDb().prepare('DELETE FROM login_attempts WHERE key = ?');
  for (const k of keys) del.run(k.key);
}

export function attemptKeys(username: string, ip: string): AttemptKey[] {
  return [
    { key: `user:${username.trim().toLowerCase()}`, free: FREE_ATTEMPTS },
    { key: `ip:${ip}`, free: FREE_ATTEMPTS_PER_IP },
  ];
}
