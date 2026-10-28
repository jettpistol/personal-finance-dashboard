import { coreDb, currentProfileId } from '../db/index.js';

// Actividad: who did what, when. Entries live in the core database (audit_log), so they survive
// app updates, profile resets and `npm run demo:reset`. Times are UTC milliseconds; the browser
// shows them in whatever time zone the viewer picks. Logging must never break the action it
// records, so every write is wrapped and only reports to the console when it fails.

export const AUDIT_SECTIONS = [
  'Movimientos',
  'Cuentas',
  'Gastos compartidos',
  'Deudores',
  'Pendientes',
  'Presupuestos',
  'Objetivos',
  'Importar',
  'Reglas',
  'Recurrentes',
  'Cierre de mes',
  'Ajustes',
  'Perfil de datos',
  'Mercado Pago',
  'Accesos',
  'Actividad',
] as const;
export type AuditSection = (typeof AUDIT_SECTIONS)[number];

/** A before → after line in an entry's details, already formatted for people. */
export type AuditChange = { field: string; from: string; to: string };

export type AuditDetails = {
  /** Field-by-field changes of an edit. */
  changes?: AuditChange[];
  /** Short label/value pairs (e.g. "Cuenta: Santander Iván"). */
  facts?: { label: string; value: string }[];
  /** Several affected items, one line each (bulk actions). */
  items?: string[];
  /**
   * What everyone else may see of a private entry (e.g. a shared expense paid from a private
   * account, shown with the account hidden). Without it, a private entry is invisible to them.
   */
  public?: { summary: string; details?: Omit<AuditDetails, 'public'> };
  [key: string]: unknown;
};

export type AuditInput = {
  /** Who did it; null for automatic actions (the scheduler), shown as "Automático". */
  userId: number | null;
  section: AuditSection;
  /** Short machine-friendly verb, e.g. "crear", "editar", "borrar", "confirmar". */
  action: string;
  /** One line in Spanish, e.g. "Registró un gasto de $ 5.000 · Supermercado › Almacén". */
  summary: string;
  entity?: string | null;
  entityId?: number | null;
  details?: AuditDetails | null;
  /** Only this user may see the entry (private accounts and movements, personal connections). */
  privateTo?: number | null;
  /** Data profile; defaults to the one in use. null = not tied to a profile (logins, profiles, email setup). */
  profileId?: number | null;
  /** UTC milliseconds; defaults to now. */
  at?: number;
};

// Never stored, whatever a caller passes in details: secrets and personal identifiers.
const SECRET_KEY = /pass|token|secret|chat_?id|session|cookie|receipt|authorization|api_?key/i;
const MAX_SUMMARY = 400;
const MAX_DETAILS = 16_000;

/** Removes secret-looking keys and caps strings, recursively. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (typeof value === 'string') return value.length > 600 ? `${value.slice(0, 600)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      const s = scrub(v, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return value;
}

/** Records one action. Returns the entry id, or null when it couldn't be stored (never throws). */
export function logAction(input: AuditInput): number | null {
  try {
    const summary = String(input.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY);
    if (!summary) return null;
    let details: string | null = null;
    if (input.details && Object.keys(input.details).length) {
      details = JSON.stringify(scrub(input.details));
      if (details.length > MAX_DETAILS) {
        // Too big (e.g. a huge bulk action): keep the shape, drop the long list.
        const { items, ...rest } = input.details;
        details = JSON.stringify(scrub({ ...rest, items: items?.slice(0, 50), truncated: true }));
      }
    }
    const profileId = input.profileId === undefined ? currentProfileId() : input.profileId;
    const res = coreDb()
      .prepare(
        `INSERT INTO audit_log (at_ms, user_id, profile_id, section, action, summary, entity, entity_id, details, private_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Math.trunc(input.at ?? Date.now()),
        input.userId || null,
        profileId ?? null,
        input.section,
        input.action.slice(0, 40),
        summary,
        input.entity ?? null,
        input.entityId ?? null,
        details,
        input.privateTo || null,
      );
    return Number(res.lastInsertRowid);
  } catch (e) {
    console.error('[audit] could not record an action:', (e as Error).message);
    return null;
  }
}

// ---- Reading ----

export type AuditEntry = {
  id: number;
  at_ms: number;
  user_id: number | null;
  user_name: string | null;
  profile_id: number | null;
  profile_name: string | null;
  section: AuditSection;
  action: string;
  summary: string;
  entity: string | null;
  entity_id: number | null;
  details: AuditDetails | null;
  /** True when only the viewer can see it. */
  private: boolean;
};

export type AuditFilter = {
  viewer: number;
  section?: string | null;
  /** A user id, or 'auto' for automatic entries. */
  user?: number | 'auto' | null;
  /** 'current' = the profile in use (plus entries not tied to a profile); 'all' = every profile. */
  profile?: 'current' | 'all';
  /** UTC milliseconds, inclusive / exclusive. */
  from?: number | null;
  to?: number | null;
  q?: string | null;
};

type Where = { sql: string; params: unknown[] };

// What the viewer may see of each row: their own private entries in full, someone else's private
// entries only through their public version, everything else as is.
const VISIBLE = `(a.private_to IS NULL OR a.private_to = @viewer OR json_extract(a.details, '$.public.summary') IS NOT NULL)`;
const SHOWN_SUMMARY = `CASE WHEN a.private_to IS NULL OR a.private_to = @viewer THEN a.summary ELSE json_extract(a.details, '$.public.summary') END`;

function where(f: AuditFilter, opts: { section?: boolean; search?: boolean } = {}): Where & { named: Record<string, unknown> } {
  const parts = [VISIBLE];
  const named: Record<string, unknown> = { viewer: f.viewer };
  if ((f.profile ?? 'current') === 'current') {
    const pid = currentProfileId();
    if (pid != null) {
      parts.push('(a.profile_id = @profile OR a.profile_id IS NULL)');
      named.profile = pid;
    }
  }
  if (opts.section !== false && f.section) {
    parts.push('a.section = @section');
    named.section = f.section;
  }
  if (f.user === 'auto') parts.push('a.user_id IS NULL');
  else if (typeof f.user === 'number') {
    parts.push('a.user_id = @user');
    named.user = f.user;
  }
  if (f.from != null) {
    parts.push('a.at_ms >= @from');
    named.from = f.from;
  }
  if (f.to != null) {
    parts.push('a.at_ms < @to');
    named.to = f.to;
  }
  const needle = f.q?.trim().toLowerCase();
  if (opts.search !== false && needle) {
    // LIKE is case-insensitive only for ASCII: compare lower-cased text, with wildcards escaped.
    parts.push(`(lower(${SHOWN_SUMMARY}) LIKE @q ESCAPE '\\' OR lower(a.section) LIKE @q ESCAPE '\\')`);
    named.q = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  return { sql: parts.join(' AND '), params: [], named };
}

type RawRow = {
  id: number;
  at_ms: number;
  user_id: number | null;
  profile_id: number | null;
  section: AuditSection;
  action: string;
  summary: string;
  entity: string | null;
  entity_id: number | null;
  details: string | null;
  private_to: number | null;
};

function names(table: 'users' | 'profiles'): Map<number, string> {
  const col = table === 'users' ? 'display_name' : 'name';
  try {
    return new Map((coreDb().prepare(`SELECT id, ${col} AS n FROM ${table}`).all() as { id: number; n: string }[]).map((r) => [r.id, r.n]));
  } catch {
    return new Map();
  }
}

function present(rows: RawRow[], viewer: number): AuditEntry[] {
  const users = names('users');
  const profiles = names('profiles');
  return rows.map((r) => {
    let details: AuditDetails | null = null;
    try {
      details = r.details ? (JSON.parse(r.details) as AuditDetails) : null;
    } catch {
      details = null;
    }
    let summary = r.summary;
    const ownPrivate = r.private_to != null && r.private_to === viewer;
    if (r.private_to != null && !ownPrivate) {
      // Someone else's private entry: only its public version.
      summary = details?.public?.summary ?? '';
      details = details?.public?.details ?? null;
    } else if (details?.public) {
      const { public: _hidden, ...rest } = details;
      details = rest;
    }
    return {
      id: r.id,
      at_ms: r.at_ms,
      user_id: r.user_id,
      user_name: r.user_id == null ? null : (users.get(r.user_id) ?? `Usuario ${r.user_id}`),
      profile_id: r.profile_id,
      profile_name: r.profile_id == null ? null : (profiles.get(r.profile_id) ?? `Perfil ${r.profile_id}`),
      section: r.section,
      action: r.action,
      summary,
      entity: r.entity,
      entity_id: r.entity_id,
      details,
      private: ownPrivate,
    };
  });
}

export function listAudit(f: AuditFilter, page = 1, pageSize = 50): { total: number; page: number; page_size: number; items: AuditEntry[] } {
  const w = where(f);
  const total = (coreDb().prepare(`SELECT COUNT(*) AS n FROM audit_log a WHERE ${w.sql}`).get(w.named) as { n: number }).n;
  const rows = coreDb()
    .prepare(`SELECT a.* FROM audit_log a WHERE ${w.sql} ORDER BY a.at_ms DESC, a.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...w.named, limit: pageSize, offset: (page - 1) * pageSize }) as RawRow[];
  return { total, page, page_size: pageSize, items: present(rows, f.viewer) };
}

/** Entries per section for the same filters (ignoring the section filter itself). */
export function auditSectionCounts(f: AuditFilter): { section: AuditSection; count: number }[] {
  const w = where(f, { section: false });
  const rows = coreDb().prepare(`SELECT a.section, COUNT(*) AS n FROM audit_log a WHERE ${w.sql} GROUP BY a.section`).all(w.named) as { section: AuditSection; n: number }[];
  const by = new Map(rows.map((r) => [r.section, r.n]));
  return AUDIT_SECTIONS.map((section) => ({ section, count: by.get(section) ?? 0 }));
}

/** Every matching entry (newest first), for the CSV export. */
export function exportAudit(f: AuditFilter, limit = 100_000): AuditEntry[] {
  const w = where(f);
  const rows = coreDb()
    .prepare(`SELECT a.* FROM audit_log a WHERE ${w.sql} ORDER BY a.at_ms DESC, a.id DESC LIMIT @limit`)
    .all({ ...w.named, limit }) as RawRow[];
  return present(rows, f.viewer);
}

/**
 * Deletes what the viewer can see within the given profile/section and (optionally) before an
 * instant. A partner's private entries the viewer can't see are left alone. Returns the count.
 */
export function clearAudit(f: Pick<AuditFilter, 'viewer' | 'section' | 'profile'> & { before?: number | null }): number {
  const w = where({ viewer: f.viewer, section: f.section, profile: f.profile, to: f.before ?? null });
  const res = coreDb().prepare(`DELETE FROM audit_log AS a WHERE ${w.sql}`).run(w.named);
  return res.changes;
}

// ---- Time ----

/** Throws RangeError for a zone the runtime doesn't know. */
export function assertTimeZone(zone: string): string {
  new Intl.DateTimeFormat('en-US', { timeZone: zone });
  return zone;
}

/** "2026-10-28 14:32:05 (GMT-3)" in the given IANA zone. */
export function formatInZone(ms: number, zone: string): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} (${get('timeZoneName')})`;
}

/** "01/10/2026 00:00 (GMT-3)", for summaries that mention an instant. */
export function formatInZoneShort(ms: number, zone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2} (.*)$/.exec(formatInZone(ms, zone));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]} ${m[5]}` : formatInZone(ms, zone);
}
