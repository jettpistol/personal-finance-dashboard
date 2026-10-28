import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, setDb, db, setSetting } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { today } from '../src/lib/dates.js';
import { journalTables, JOURNAL_EXCLUDED } from '../src/db/undo-journal.js';

let app: FastifyInstance;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

type Who = 'ana' | 'beto';
async function call(who: Who, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { cookie: cookies[who] } });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body, token: res.headers['x-undo-token'] as string | undefined };
}
const undo = (who: Who, token: string | undefined) => call(who, 'POST', `/api/undo/${token}`);

/** Every journaled table, row by row, so a test can compare the whole database before and after. */
function snapshot(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of journalTables(db()).keys()) {
    if (t === 'notifications' || t === 'budget_alerts_sent') continue;
    out[t] = db().prepare(`SELECT rowid AS _rowid, * FROM "${t}" ORDER BY rowid`).all();
  }
  return out;
}
const count = (sql: string, ...p: unknown[]) => (db().prepare(sql).get(...p) as { n: number }).n;
const balanceOf = async (id: number) => ((await call('ana', 'GET', '/api/accounts')).body as { id: number; balance: number }[]).find((a) => a.id === id)?.balance;

beforeAll(async () => {
  setDb(openDb(':memory:'));
  app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ana', display_name: 'Ana', password: 'contraseña-larga' } });
  cookies.ana = r.headers['set-cookie']!.toString().split(';')[0];
  await call('ana', 'POST', '/api/users', { username: 'beto', display_name: 'Beto', password: 'otra-contraseña' });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'beto', password: 'otra-contraseña' } });
  cookies.beto = login.headers['set-cookie']!.toString().split(';')[0];
  const mk = async (body: object) => (await call('ana', 'POST', '/api/accounts', body)).body.id as number;
  ids.bank = await mk({ name: 'Banco Ana', type: 'bank', currency: 'ARS', owner: 'me', opening_balance: 500_000_00 });
  ids.savings = await mk({ name: 'Ahorro Ana', type: 'savings', currency: 'ARS', owner: 'me' });
  ids.joint = await mk({ name: 'Cuenta común', type: 'bank', currency: 'ARS', owner: 'joint', opening_balance: 100_000_00 });
  ids.category = (db().prepare(`SELECT id FROM categories WHERE kind = 'expense' AND parent_id IS NOT NULL LIMIT 1`).get() as { id: number }).id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deshacer', () => {
  it('hands out a token only when something changed', async () => {
    const created = await call('ana', 'POST', '/api/categories', { name: 'Mascotas', kind: 'expense' });
    expect(created.status).toBe(200);
    expect(created.token).toMatch(/^[a-f0-9]{32}$/);
    // A failed request changes nothing and gets no token.
    expect((await call('ana', 'POST', '/api/accounts', { name: '', type: 'bank', currency: 'ARS', owner: 'me' })).token).toBeUndefined();
    // Reads never get one.
    expect((await call('ana', 'GET', '/api/accounts')).token).toBeUndefined();
    expect((await undo('ana', created.token)).status).toBe(200);
    expect(count('SELECT COUNT(*) AS n FROM categories WHERE name = ?', 'Mascotas')).toBe(0);
  });

  it('undoes a new movement with everything it made: splits and the automatic Pendientes link', async () => {
    const c = await call('ana', 'POST', '/api/commitments', { kind: 'savings', title: 'Ahorro mensual', amount: 30_000_00, currency: 'ARS', account_id: ids.savings, day: 1, start_month: today().slice(0, 7) });
    expect(c.status).toBe(200);
    const before = snapshot();

    const shared = await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 9_000_00, account_id: ids.joint, category_id: ids.category, description: 'Súper', is_shared: true, split: { method: 'equal' } });
    expect(shared.status).toBe(200);
    expect(count('SELECT COUNT(*) AS n FROM transaction_splits WHERE transaction_id = ?', shared.body.id)).toBe(2);
    const transfer = await call('ana', 'POST', '/api/transactions', { type: 'transfer', date: today(), amount: 30_000_00, account_id: ids.bank, to_account_id: ids.savings, description: 'Ahorro' });
    expect(count('SELECT COUNT(*) AS n FROM commitment_payments WHERE transaction_id = ?', transfer.body.id)).toBe(1); // linked by itself

    expect((await undo('ana', transfer.token)).status).toBe(200);
    expect((await undo('ana', shared.token)).status).toBe(200);
    expect(snapshot()).toEqual(before);
  });

  it('brings back a deleted account with its movements, same ids and balances', async () => {
    const acc = (await call('ana', 'POST', '/api/accounts', { name: 'Visa Ana', type: 'credit_card', currency: 'ARS', owner: 'me' })).body.id as number;
    await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 12_000_00, account_id: acc, category_id: ids.category, description: 'Ropa', is_shared: true, split: { method: 'equal' } });
    await call('ana', 'POST', '/api/transactions', { type: 'transfer', date: today(), amount: 5_000_00, account_id: ids.bank, to_account_id: acc, description: 'Pago tarjeta' });
    await call('ana', 'POST', '/api/transactions/installments', { type: 'expense', amount: 60_000_00, account_id: acc, description: 'Heladera', count: 3, purchase_date: today(), first_date: today(), tags: [], is_shared: false, is_private: false });
    await call('ana', 'POST', '/api/recurring', { description: 'Seguro', type: 'expense', amount: 3_000_00, account_id: acc, frequency: 'monthly', next_date: '2099-01-05' });
    await call('ana', 'POST', '/api/rules', { name: 'Tienda', match_type: 'contains', pattern: 'tienda', account_id: acc });
    const bankBalance = await balanceOf(ids.bank);
    const accBalance = await balanceOf(acc);
    const before = snapshot();

    // Without the flag it only says how many movements there are.
    const refused = await call('ana', 'DELETE', `/api/accounts/${acc}`);
    expect(refused.status).toBe(409);
    expect(refused.body.movements).toBe(5);
    expect(refused.token).toBeUndefined();

    const del = await call('ana', 'DELETE', `/api/accounts/${acc}?with_movements=1`);
    expect(del.status).toBe(200);
    expect(del.body.movements).toBe(5);
    expect(count('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? OR to_account_id = ?', acc, acc)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM rules WHERE account_id = ?', acc)).toBe(0);
    expect(await balanceOf(ids.bank)).toBe(bankBalance! + 5_000_00);

    expect((await undo('ana', del.token)).status).toBe(200);
    expect(snapshot()).toEqual(before);
    expect(await balanceOf(ids.bank)).toBe(bankBalance);
    expect(await balanceOf(acc)).toBe(accBalance);
  });

  it('restores the old values of an edit and logs "Deshizo" in Actividad', async () => {
    const t = (await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 1_500_00, account_id: ids.bank, description: 'Café' })).body;
    const before = db().prepare('SELECT * FROM transactions WHERE id = ?').get(t.id);
    const edit = await call('ana', 'PUT', `/api/transactions/${t.id}`, { type: 'expense', date: today(), amount: 2_500_00, account_id: ids.bank, description: 'Café y medialunas' });
    expect(edit.status).toBe(200);
    expect((await undo('ana', edit.token)).status).toBe(200);
    expect(db().prepare('SELECT * FROM transactions WHERE id = ?').get(t.id)).toEqual(before);
    const log = (await call('ana', 'GET', '/api/audit?section=Movimientos')).body as { items: { summary: string }[] };
    expect(log.items[0].summary).toMatch(/^Deshizo: Editó/);
  });

  it('refuses when something changed since (409), and leaves everything as it was', async () => {
    const t = (await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 700_00, account_id: ids.bank, description: 'Kiosco' })).body;
    const edit = await call('ana', 'PUT', `/api/transactions/${t.id}`, { type: 'expense', date: today(), amount: 800_00, account_id: ids.bank, description: 'Kiosco' });
    await call('ana', 'PUT', `/api/transactions/${t.id}`, { type: 'expense', date: today(), amount: 900_00, account_id: ids.bank, description: 'Kiosco' });
    const r = await undo('ana', edit.token);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('No se puede deshacer: hubo cambios después');
    expect((db().prepare('SELECT amount FROM transactions WHERE id = ?').get(t.id) as { amount: number }).amount).toBe(900_00);

    // A row created later that hangs from what the undo would remove counts as a change too.
    const acc = await call('ana', 'POST', '/api/accounts', { name: 'Nueva', type: 'cash', currency: 'ARS', owner: 'me' });
    await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 100_00, account_id: acc.body.id, description: 'Algo' });
    expect((await undo('ana', acc.token)).status).toBe(409);
    expect(count('SELECT COUNT(*) AS n FROM accounts WHERE id = ?', acc.body.id)).toBe(1);
  });

  it('is only for the same person, once, within two minutes', async () => {
    const a = await call('ana', 'POST', '/api/categories', { name: 'Uno', kind: 'expense' });
    expect((await undo('beto', a.token)).status).toBe(404);
    expect((await undo('ana', a.token)).status).toBe(200);
    const again = await undo('ana', a.token);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('Ya no se puede deshacer');
    expect((await undo('ana', 'f'.repeat(32))).status).toBe(404);
    expect((await undo('ana', 'no-es-un-token')).status).toBe(404);

    const b = await call('ana', 'POST', '/api/categories', { name: 'Dos', kind: 'expense' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60_000);
    expect((await undo('ana', b.token)).status).toBe(404);
    expect(count('SELECT COUNT(*) AS n FROM categories WHERE name = ?', 'Dos')).toBe(1);
  });

  it('brings a deleted receipt back', async () => {
    const t = (await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 300_00, account_id: ids.bank, description: 'Farmacia' })).body;
    fs.mkdirSync(config.receiptsDir, { recursive: true });
    const file = path.join(config.receiptsDir, 'prueba-undo.pdf');
    fs.writeFileSync(file, 'comprobante');
    db().prepare('UPDATE transactions SET receipt_file = ? WHERE id = ?').run('prueba-undo.pdf', t.id);

    const del = await call('ana', 'DELETE', `/api/transactions/${t.id}`);
    expect(del.status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
    expect((await undo('ana', del.token)).status).toBe(200);
    expect(fs.readFileSync(file, 'utf8')).toBe('comprobante');
    expect((db().prepare('SELECT receipt_file FROM transactions WHERE id = ?').get(t.id) as { receipt_file: string }).receipt_file).toBe('prueba-undo.pdf');

    // Removing just the receipt is undoable too.
    const rm = await call('ana', 'DELETE', `/api/transactions/${t.id}/receipt`);
    expect(fs.existsSync(file)).toBe(false);
    expect((await undo('ana', rm.token)).status).toBe(200);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('undoes a statement import', async () => {
    const before = snapshot();
    const r = await call('ana', 'POST', '/api/imports/commit', {
      file_name: 'extracto.csv',
      account_id: ids.bank,
      rows: [
        { date: today(), description: 'Uno', amount: 100_00, direction: 'out', type: 'expense', import_hash: 'h1' },
        { date: today(), description: 'Dos', amount: 200_00, direction: 'in', type: 'income', import_hash: 'h2' },
      ],
    });
    expect(r.body.imported).toBe(2);
    expect((await undo('ana', r.token)).status).toBe(200);
    expect(snapshot()).toEqual(before);
  });

  it('never journals logins, secrets or the activity log', async () => {
    const journaled = [...journalTables(db()).keys()];
    for (const t of ['users', 'sessions', 'login_attempts', 'mp_connections', 'audit_log', 'profiles', 'reminders_sent']) {
      expect(JOURNAL_EXCLUDED.has(t)).toBe(true);
      expect(journaled).not.toContain(t);
    }
    expect(journaled).toEqual(expect.arrayContaining(['transactions', 'transaction_splits', 'accounts', 'commitment_payments', 'loans', 'loan_returns', 'mp_links']));
    // Personal settings and the sending account get no token.
    expect((await call('ana', 'PATCH', '/api/me', { display_name: 'Ana María' })).token).toBeUndefined();
    // In `settings`, only household keys are journaled (the mail password shares the table).
    db().prepare(`INSERT INTO temp.undo_ctx (req) VALUES ('prueba')`).run();
    try {
      setSetting('mail_smtp', { pass: 'secreto' });
      setSetting('household_name', 'Casa');
    } finally {
      db().prepare('DELETE FROM temp.undo_ctx').run();
    }
    const rows = db().prepare(`SELECT tbl, old, new FROM temp.undo_log WHERE req = 'prueba'`).all() as { tbl: string; old: string | null; new: string | null }[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('secreto');
    db().prepare(`DELETE FROM temp.undo_log WHERE req = 'prueba'`).run();
  });
});
