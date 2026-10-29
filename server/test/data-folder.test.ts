import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loginCount, resolveDataFolder } from '../src/lib/data-folder.js';

// Up to 0.16.1 `npm run demo:reset` used server/data-demo and `npm start` server/data. A household
// living in data-demo found an empty app after `npm start`. Now there's one folder, and the
// first start copies data-demo over; nothing is deleted.

const roots: string[] = [];
const root = () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pfd-folder-'));
  roots.push(r);
  return r;
};
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

/** A data folder with `users` logins, a profile with a row still only in its -wal file, a key and a receipt. */
function folder(dir: string, users: number) {
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'receipts'), { recursive: true });
  const core = new Database(path.join(dir, 'core.sqlite'));
  core.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
  for (let i = 1; i <= users; i++) core.prepare('INSERT INTO users (username) VALUES (?)').run(`u${i}`);
  core.close();
  const prof = new Database(path.join(dir, 'profiles', 'perfil-2.sqlite'));
  prof.pragma('journal_mode = WAL');
  prof.pragma('wal_autocheckpoint = 0');
  prof.exec('CREATE TABLE transactions (id INTEGER PRIMARY KEY, amount INTEGER)');
  prof.prepare('INSERT INTO transactions (amount) VALUES (?)').run(12345);
  // Left open on purpose until after the copy would happen: the row lives in the -wal file.
  fs.writeFileSync(path.join(dir, 'secret.key'), 'k'.repeat(64), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'receipts', 'r1.jpg'), 'jpg');
  return prof;
}

describe('one data folder', () => {
  it('copies data-demo into an empty data, keeping both old folders', () => {
    const base = root();
    const open = folder(path.join(base, 'data-demo'), 2);
    // What a mistaken `npm start` left: a data folder with no logins.
    folder(path.join(base, 'data'), 0).close();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = resolveDataFolder(base);
    open.close();
    expect(dir).toBe(path.join(base, 'data'));
    expect(loginCount(dir)).toBe(2);
    const copied = new Database(path.join(dir, 'profiles', 'perfil-2.sqlite'), { readonly: true });
    expect(copied.prepare('SELECT amount FROM transactions').get()).toEqual({ amount: 12345 });
    copied.close();
    expect(fs.readFileSync(path.join(dir, 'secret.key'), 'utf8')).toBe('k'.repeat(64));
    expect(fs.statSync(path.join(dir, 'secret.key')).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(dir, 'receipts', 'r1.jpg'))).toBe(true);
    // Nothing deleted: data-demo is still whole, and the empty folder was renamed.
    expect(loginCount(path.join(base, 'data-demo'))).toBe(2);
    expect(fs.existsSync(path.join(base, 'data-demo', 'LEEME.txt'))).toBe(true);
    expect(fs.readdirSync(base).filter((f) => f.startsWith('data-vacia-'))).toHaveLength(1);
  });

  it('does nothing more on the next start', () => {
    const base = root();
    folder(path.join(base, 'data-demo'), 2).close();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resolveDataFolder(base);
    const before = fs.readdirSync(base).sort();
    resolveDataFolder(base);
    expect(fs.readdirSync(base).sort()).toEqual(before);
  });

  it('never replaces a data folder that has logins of its own', () => {
    const base = root();
    folder(path.join(base, 'data-demo'), 2).close();
    folder(path.join(base, 'data'), 1).close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveDataFolder(base)).toBe(path.join(base, 'data'));
    expect(loginCount(path.join(base, 'data'))).toBe(1);
    expect(fs.readdirSync(base).sort()).toEqual(['data', 'data-demo']);
    expect(warn.mock.calls[0][0]).toMatch(/data:recover/);
  });

  it('uses data when there is no data-demo', () => {
    const base = root();
    expect(resolveDataFolder(base)).toBe(path.join(base, 'data'));
    expect(fs.readdirSync(base)).toEqual([]);
  });
});
