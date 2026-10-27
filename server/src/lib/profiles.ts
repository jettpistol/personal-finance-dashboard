import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { coreDb, openDb, setCoreDb, setDb, type DB } from '../db/index.js';
import { HttpError } from './http.js';

// Data profiles: each one is its own SQLite file under DATA_DIR/profiles, so real data,
// test data and an empty dashboard never mix. Logins live in the core database and are
// copied into every profile (finance tables reference user ids).

export type Profile = { id: number; name: string; file: string; is_default: number; created_at: string };

export const PROFILE_COOKIE = 'pfd_profile';
const EMPTY_NAME = 'Vacío';
const open = new Map<number, DB>();
let enabled = false;

/** False in tests, which run on a single in-memory database. */
export function profilesEnabled() {
  return enabled;
}

const profilesDir = () => path.join(config.dataDir, 'profiles');

export function listProfiles(): Profile[] {
  return coreDb().prepare('SELECT * FROM profiles ORDER BY is_default DESC, id').all() as Profile[];
}

export function defaultProfile(): Profile {
  return (coreDb().prepare('SELECT * FROM profiles ORDER BY is_default DESC, id LIMIT 1').get() as Profile | undefined)!;
}

export function getProfile(id: number | null | undefined): Profile | null {
  if (!id) return null;
  return (coreDb().prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Profile | undefined) ?? null;
}

export function profileDb(p: Profile): DB {
  let d = open.get(p.id);
  if (!d) {
    d = openDb(path.join(config.dataDir, p.file));
    open.set(p.id, d);
    syncUsersInto(d);
  }
  return d;
}

/** Copies the household's users into a profile database (ids must match; no passwords). */
function syncUsersInto(target: DB) {
  if (target === coreDb()) return;
  const users = coreDb().prepare('SELECT * FROM users').all() as Record<string, unknown>[];
  const upsert = target.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, color, share_dashboard, telegram_chat_id, email, notify_budget, notify_recurring, notify_review, created_at)
     VALUES (@id, @username, @display_name, '-', @color, @share_dashboard, @telegram_chat_id, @email, @notify_budget, @notify_recurring, @notify_review, @created_at)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, color = excluded.color,
       share_dashboard = excluded.share_dashboard, telegram_chat_id = excluded.telegram_chat_id, email = excluded.email, notify_budget = excluded.notify_budget,
       notify_recurring = excluded.notify_recurring, notify_review = excluded.notify_review`,
  );
  target.transaction(() => users.forEach((u) => upsert.run(u)))();
}

/** Call after any change to users so every profile sees the same names and settings. */
export function syncUsers() {
  for (const p of listProfiles()) syncUsersInto(profileDb(p));
}

export function createProfile(name: string, opts: { isDefault?: boolean } = {}): Profile {
  fs.mkdirSync(profilesDir(), { recursive: true });
  const info = coreDb()
    .prepare('INSERT INTO profiles (name, file, is_default) VALUES (?, ?, ?)')
    .run(name.trim(), `profiles/tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`, opts.isDefault ? 1 : 0);
  const id = Number(info.lastInsertRowid);
  coreDb().prepare('UPDATE profiles SET file = ? WHERE id = ?').run(`profiles/perfil-${id}.sqlite`, id);
  const p = getProfile(id)!;
  profileDb(p); // creates the file with the schema and default categories
  return p;
}

export function renameProfile(id: number, name: string) {
  const res = coreDb().prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name.trim(), id);
  if (!res.changes) throw new HttpError(404, 'Perfil no encontrado');
}

export function deleteProfile(id: number) {
  const p = getProfile(id);
  if (!p) throw new HttpError(404, 'Perfil no encontrado');
  if (listProfiles().length <= 1) throw new HttpError(400, 'Tiene que quedar al menos un perfil.');
  if (p.is_default) throw new HttpError(400, 'El perfil vacío por defecto no se puede borrar.');
  open.get(id)?.close();
  open.delete(id);
  coreDb().prepare('DELETE FROM profiles WHERE id = ?').run(id);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(config.dataDir, p.file) + suffix, { force: true });
}

/**
 * Opens the core database and makes sure the profile list is usable. An install from before
 * profiles existed keeps its data as the "Principal" profile; a fresh one starts with an
 * empty default profile.
 */
export function initProfiles(): DB {
  const corePath = path.join(config.dataDir, 'core.sqlite');
  const legacy = config.dbPath;
  const fresh = !fs.existsSync(corePath);
  const core = openDb(corePath);
  setCoreDb(core);
  enabled = true;
  if (fresh && fs.existsSync(legacy)) {
    // Bring the users (with passwords) over from the single-database layout.
    const old = openDb(legacy);
    const users = old.prepare('SELECT * FROM users').all() as Record<string, unknown>[];
    const insert = core.prepare(
      `INSERT OR IGNORE INTO users (id, username, display_name, password_hash, color, share_dashboard, telegram_chat_id, notify_budget, notify_recurring, notify_review, created_at)
       VALUES (@id, @username, @display_name, @password_hash, @color, @share_dashboard, @telegram_chat_id, @notify_budget, @notify_recurring, @notify_review, @created_at)`,
    );
    core.transaction(() => users.forEach((u) => insert.run(u)))();
    old.close();
    core.prepare('INSERT INTO profiles (name, file, is_default) VALUES (?, ?, 0)').run('Principal', path.basename(legacy));
  }
  if (!listProfiles().some((p) => p.is_default)) createProfile(EMPTY_NAME, { isDefault: true });
  const def = defaultProfile();
  setDb(profileDb(def));
  syncUsers();
  return core;
}

/** Profile chosen by the browser's cookie, or the default (empty) one. */
export function resolveProfile(cookieValue: string | undefined): Profile {
  return getProfile(Number(cookieValue)) ?? defaultProfile();
}
