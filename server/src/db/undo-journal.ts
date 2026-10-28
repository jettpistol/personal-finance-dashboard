import type Database from 'better-sqlite3';

// Change journal for "Deshacer" (lib/undo.ts). Every connection gets TEMP objects only, so
// nothing is persisted and no migration is needed:
//   temp.undo_ctx  0 or 1 row: the undo token of the request being handled right now;
//   temp.undo_log  one row per changed row while a token is set (rowid, old and new values as JSON);
//   TEMP triggers  AFTER INSERT / UPDATE / DELETE on every journaled table of the main schema.
// FK cascades (ON DELETE CASCADE / SET NULL) fire triggers too, so they are captured.

type DB = Database.Database;

/**
 * Tables never journaled: logins, sessions, encrypted tokens, the activity log, the profile list,
 * rate limits and reminder bookkeeping. A new table is journaled by default: add it here when it
 * holds secrets or isn't household data.
 */
export const JOURNAL_EXCLUDED = new Set(['users', 'sessions', 'login_attempts', 'mp_connections', 'audit_log', 'profiles', 'reminders_sent']);

/**
 * Tables whose rows may change after the action without blocking an undo (e.g. a bell
 * notification marked as read): a changed row is left as it is instead of answering 409.
 */
export const JOURNAL_SOFT = new Set(['notifications', 'budget_alerts_sent']);

export type TableMeta = {
  name: string;
  cols: string[];
  /** The table has an INTEGER PRIMARY KEY column (an alias of the rowid). */
  rowidAlias: boolean;
  soft: boolean;
  /** SQL that turns a row (optionally qualified, e.g. "OLD") into the JSON stored in the log. */
  json: (prefix?: string) => string;
};

const meta = new WeakMap<DB, Map<string, TableMeta>>();

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Journaled tables of a connection (empty when the journal isn't installed). */
export function journalTables(db: DB): Map<string, TableMeta> {
  return meta.get(db) ?? new Map();
}

/**
 * Installs the journal on a freshly opened connection. `settingsKeys`: the household settings that
 * are journaled; every other key in `settings` (such as the mail password) never is.
 */
export function installUndoJournal(db: DB, settingsKeys: string[]) {
  if (meta.has(db)) return;
  // REPLACE conflicts only fire delete triggers with this on (nothing in the app uses REPLACE today).
  db.pragma('recursive_triggers = ON');
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS undo_ctx (req TEXT);
    CREATE TEMP TABLE IF NOT EXISTS undo_log (id INTEGER PRIMARY KEY, req TEXT NOT NULL, tbl TEXT NOT NULL, op TEXT NOT NULL, rid INTEGER NOT NULL, old TEXT, new TEXT, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS temp.undo_log_req ON undo_log (req);
    CREATE INDEX IF NOT EXISTS temp.undo_log_at ON undo_log (at);
  `);
  const tables = (db.prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((t) => t.name);
  const byName = new Map<string, TableMeta>();
  const keys = settingsKeys.map(lit).join(', ') || `''`;
  const now = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`;
  for (const name of tables) {
    if (JOURNAL_EXCLUDED.has(name)) continue;
    const info = db.prepare(`PRAGMA main.table_info(${ident(name)})`).all() as { name: string; type: string; pk: number }[];
    if (!info.length) continue;
    const cols = info.map((c) => c.name);
    const pks = info.filter((c) => c.pk > 0);
    const rowidAlias = pks.length === 1 && pks[0].type.toUpperCase() === 'INTEGER';
    const json = (prefix?: string) => `json_object(${cols.map((c) => `${lit(c)}, ${prefix ? `${prefix}.` : ''}${ident(c)}`).join(', ')})`;
    const t: TableMeta = { name, cols, rowidAlias, soft: JOURNAL_SOFT.has(name), json };
    byName.set(name, t);
    // Only the household settings: the mail account (password included) lives in the same table.
    const only = (row: 'NEW' | 'OLD') => (name === 'settings' ? ` AND ${row}.key IN (${keys})` : '');
    const when = `(SELECT req FROM undo_ctx) IS NOT NULL`;
    const ins = (op: string, rid: string, oldJ: string, newJ: string) =>
      `INSERT INTO undo_log (req, tbl, op, rid, old, new, at) VALUES ((SELECT req FROM undo_ctx), ${lit(name)}, '${op}', ${rid}, ${oldJ}, ${newJ}, ${now});`;
    const base = `undo_${name.replace(/\W/g, '_')}`;
    db.exec(`
      CREATE TEMP TRIGGER IF NOT EXISTS ${ident(`${base}_i`)} AFTER INSERT ON main.${ident(name)} WHEN ${when}${only('NEW')}
      BEGIN ${ins('I', 'NEW.rowid', 'NULL', json('NEW'))} END;
      CREATE TEMP TRIGGER IF NOT EXISTS ${ident(`${base}_u`)} AFTER UPDATE ON main.${ident(name)} WHEN ${when}${name === 'settings' ? ` AND (NEW.key IN (${keys}) OR OLD.key IN (${keys}))` : ''}
      BEGIN ${ins('U', 'NEW.rowid', json('OLD'), json('NEW'))} END;
      CREATE TEMP TRIGGER IF NOT EXISTS ${ident(`${base}_d`)} AFTER DELETE ON main.${ident(name)} WHEN ${when}${only('OLD')}
      BEGIN ${ins('D', 'OLD.rowid', json('OLD'), 'NULL')} END;
    `);
  }
  meta.set(db, byName);
}
