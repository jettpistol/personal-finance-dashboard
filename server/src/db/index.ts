import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';
import { migrations } from './migrations.js';

export type DB = Database.Database;

// Two kinds of database: the core one (logins, sessions, the list of data profiles) and one per
// data profile (accounts, transactions, budgets...). Each request and each scheduler run reads
// and writes its profile's database through db(); coreDb() is for logins and profiles.
let instance: DB | null = null;
let coreInstance: DB | null = null;
const current = new AsyncLocalStorage<{ db: DB; profileId: number | null }>();

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  seedDefaults(db);
  return db;
}

/** Fallback database when no profile is active (tests use a single in-memory database for everything). */
export function setDb(db: DB) {
  instance = db;
}

export function setCoreDb(db: DB) {
  coreInstance = db;
}

/** The active data profile's database. */
export function db(): DB {
  const store = current.getStore();
  if (store) return store.db;
  if (!instance) throw new Error('Database not initialised');
  return instance;
}

/** Logins, sessions and the list of data profiles. */
export function coreDb(): DB {
  return coreInstance ?? db();
}

export function currentProfileId(): number | null {
  return current.getStore()?.profileId ?? null;
}

/** Runs fn (and everything it awaits) against a profile's database. */
export function withDb<T>(target: DB, profileId: number | null, fn: () => T): T {
  return current.run({ db: target, profileId }, fn);
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

const DEFAULT_CATEGORIES: { name: string; kind: 'expense' | 'income'; color: string; icon: string; children: string[] }[] = [
  { name: 'Vivienda', kind: 'expense', color: 'indigo', icon: 'home', children: ['Alquiler', 'Expensas', 'Mantenimiento'] },
  { name: 'Servicios', kind: 'expense', color: 'cyan', icon: 'bolt', children: ['Luz', 'Gas', 'Agua', 'Internet', 'Celular'] },
  { name: 'Supermercado', kind: 'expense', color: 'green', icon: 'shopping-cart', children: ['Almacén', 'Verdulería', 'Carnicería', 'Limpieza'] },
  { name: 'Salidas', kind: 'expense', color: 'orange', icon: 'glass', children: ['Restaurantes', 'Delivery', 'Bares', 'Cine y eventos'] },
  { name: 'Suscripciones', kind: 'expense', color: 'grape', icon: 'repeat', children: ['Streaming', 'Software', 'Gimnasio'] },
  { name: 'Salud', kind: 'expense', color: 'violet', icon: 'heart', children: ['Prepaga', 'Farmacia', 'Consultas'] },
  { name: 'Transporte', kind: 'expense', color: 'lime', icon: 'bus', children: ['Transporte público', 'Taxi y apps', 'Bicicleta'] },
  { name: 'Compras', kind: 'expense', color: 'pink', icon: 'bag', children: ['Ropa', 'Hogar', 'Tecnología'] },
  { name: 'Viajes', kind: 'expense', color: 'blue', icon: 'plane', children: ['Pasajes', 'Alojamiento', 'Gastos en viaje'] },
  { name: 'Educación', kind: 'expense', color: 'blue', icon: 'book', children: ['Cursos', 'Libros'] },
  { name: 'Impuestos y comisiones', kind: 'expense', color: 'gray', icon: 'receipt', children: ['Impuestos', 'Comisiones bancarias', 'Intereses de tarjeta'] },
  { name: 'Otros gastos', kind: 'expense', color: 'dark', icon: 'dots', children: ['Regalos', 'Donaciones', 'Varios'] },
  { name: 'Sueldo', kind: 'income', color: 'green', icon: 'briefcase', children: [] },
  { name: 'Freelance', kind: 'income', color: 'lime', icon: 'laptop', children: [] },
  { name: 'Inversiones', kind: 'income', color: 'blue', icon: 'trending-up', children: ['Intereses', 'Dividendos'] },
  { name: 'Reintegros', kind: 'income', color: 'cyan', icon: 'arrow-back', children: [] },
  { name: 'Otros ingresos', kind: 'income', color: 'gray', icon: 'dots', children: ['Regalos recibidos', 'Ventas'] },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  household_name: 'Hogar',
  // Percentage of a shared expense assigned to each user id. Empty = equal split.
  default_split: {},
  // Which BNA quote to use when converting: 'sell' (vendedor), 'buy' (comprador) or 'avg'.
  fx_side: 'sell',
  budget_thresholds: [80, 100],
  // Show ARS budgets adjusted by the CPI published since each one was set.
  budget_indexing: false,
};

function seedDefaults(db: DB) {
  const hasCategories = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number };
  if (hasCategories.n === 0) {
    const insert = db.prepare(
      'INSERT INTO categories (name, parent_id, kind, color, icon, sort) VALUES (?, ?, ?, ?, ?, ?)',
    );
    db.transaction(() => {
      DEFAULT_CATEGORIES.forEach((c, i) => {
        const parent = insert.run(c.name, null, c.kind, c.color, c.icon, i);
        c.children.forEach((child, j) => insert.run(child, parent.lastInsertRowid, c.kind, c.color, null, j));
      });
    })();
  }
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, JSON.stringify(value));
}

export function getSetting<T>(key: string): T {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return (row ? JSON.parse(row.value) : DEFAULT_SETTINGS[key]) as T;
}

export function setSetting(key: string, value: unknown) {
  db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}
