import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, setDb, db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { upsertRate } from '../src/lib/fx.js';
import { addMonthsToMonth, currentMonth, today } from '../src/lib/dates.js';
import { generateDueRecurring } from '../src/lib/recurring.js';

let app: FastifyInstance;
const cookies: Record<string, string> = {};

async function call(who: 'ana' | 'beto' | null, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: who ? { cookie: cookies[who] } : {} });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body, res };
}

const M = currentMonth();
const D = (day: number) => `${M}-${String(day).padStart(2, '0')}`;
let ids: Record<string, number> = {};
let cat: Record<string, number> = {};

beforeAll(async () => {
  setDb(openDb(':memory:'));
  app = await buildApp();
  upsertRate(`${addMonthsToMonth(M, -2)}-01`, 1000, 1000, 'test');
  db().prepare(`INSERT INTO cpi_monthly (month, pct, source) VALUES (?, 5, 'test')`).run(addMonthsToMonth(M, -1));
  for (const c of db().prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]) cat[c.name] = c.id;
});

describe('auth', () => {
  it('runs first-time setup once', async () => {
    expect((await call(null, 'GET', '/api/auth/status')).body.needsSetup).toBe(true);
    const r = await call(null, 'POST', '/api/auth/setup', { username: 'ana', display_name: 'Ana', password: 'contraseña-larga' });
    expect(r.status).toBe(200);
    cookies.ana = r.res.headers['set-cookie']!.toString().split(';')[0];
    expect((await call(null, 'POST', '/api/auth/setup', { username: 'otro', display_name: 'X', password: 'contraseña-larga' })).status).toBe(409);
    expect((await call('ana', 'POST', '/api/users', { username: 'beto', display_name: 'Beto', password: 'otra-contraseña' })).status).toBe(200);
  });

  it('rejects requests without a session', async () => {
    expect((await call(null, 'GET', '/api/accounts')).status).toBe(401);
  });

  it('locks the username after 3 wrong passwords', async () => {
    const bad = { username: 'beto', password: 'nope-nope-nope' };
    expect((await call(null, 'POST', '/api/auth/login', bad)).status).toBe(401);
    expect((await call(null, 'POST', '/api/auth/login', bad)).status).toBe(401);
    const third = await call(null, 'POST', '/api/auth/login', bad);
    expect(third.status).toBe(429);
    expect(third.body.retryAfter).toBe(30);
    // Even the right password waits until the lock expires.
    expect((await call(null, 'POST', '/api/auth/login', { username: 'beto', password: 'otra-contraseña' })).status).toBe(429);
    db().prepare('DELETE FROM login_attempts').run();
    const ok = await call(null, 'POST', '/api/auth/login', { username: 'beto', password: 'otra-contraseña' });
    expect(ok.status).toBe(200);
    cookies.beto = ok.res.headers['set-cookie']!.toString().split(';')[0];
  });
});

describe('money flows', () => {
  it('creates accounts', async () => {
    const mk = async (who: 'ana' | 'beto', body: object) => (await call(who, 'POST', '/api/accounts', body)).body.id as number;
    ids.joint = await mk('ana', { name: 'Cuenta común', type: 'bank', currency: 'ARS', owner: 'joint', opening_balance: 100_000_00 });
    ids.anaBank = await mk('ana', { name: 'Banco Ana', type: 'bank', currency: 'ARS', owner: 'me', opening_balance: 50_000_00 });
    ids.anaUsd = await mk('ana', { name: 'Dólares Ana', type: 'savings', currency: 'USD', owner: 'me' });
    ids.anaSecret = await mk('ana', { name: 'Ahorro secreto', type: 'savings', currency: 'ARS', owner: 'me', is_private: true, opening_balance: 9_999_00 });
    ids.betoWallet = await mk('beto', { name: 'Mercado Pago Beto', type: 'wallet', currency: 'ARS', owner: 'me', opening_balance: 20_000_00 });
    const betoSees = (await call('beto', 'GET', '/api/accounts')).body.map((a: { name: string }) => a.name);
    expect(betoSees).not.toContain('Ahorro secreto');
    expect(betoSees).toContain('Banco Ana');
  });

  it('tracks a shared expense Splitwise-style and settles it', async () => {
    const r = await call('ana', 'POST', '/api/transactions', {
      type: 'expense', date: D(1), amount: 30_000_00, account_id: ids.anaBank, category_id: cat['Supermercado'], description: 'Super', is_shared: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.splits.map((s: { amount: number }) => s.amount)).toEqual([15_000_00, 15_000_00]);
    // Custom 70/30 split, paid by Beto
    await call('beto', 'POST', '/api/transactions', {
      type: 'expense', date: D(2), amount: 10_000_00, account_id: ids.betoWallet, category_id: cat['Salidas'], description: 'Cena',
      is_shared: true, split: { method: 'percent', values: [{ user_id: 1, value: 70 }, { user_id: 2, value: 30 }] },
    });
    // Ana is owed 15000 - 7000 = 8000
    let bal = (await call('beto', 'GET', '/api/balances')).body.balances[0];
    expect(bal.settlements).toEqual([{ from: 2, to: 1, amount: 8_000_00 }]);
    const s = await call('beto', 'POST', '/api/balances/settle', { from_account_id: ids.betoWallet, to_account_id: ids.anaBank, amount: 8_000_00 });
    expect(s.status).toBe(200);
    bal = (await call('ana', 'GET', '/api/balances')).body.balances[0];
    expect(bal.settlements).toEqual([]);
  });

  it('splits shared income: the receiver owes the other their share', async () => {
    const before = (await call('ana', 'GET', '/api/balances')).body.balances[0];
    const r = await call('ana', 'POST', '/api/transactions', { type: 'income', date: D(2), amount: 20_000_00, account_id: ids.anaBank, category_id: cat['Otros ingresos'], description: 'Alquiler cochera', is_shared: true });
    expect(r.status).toBe(200);
    const after = (await call('ana', 'GET', '/api/balances')).body.balances[0];
    const net = (b: { users: { user_id: number; net: number }[] }, uid: number) => b.users.find((u) => u.user_id === uid)!.net;
    expect(net(after, 1) - net(before, 1)).toBe(-10_000_00);
    expect(net(after, 2) - net(before, 2)).toBe(10_000_00);
    await call('ana', 'DELETE', `/api/transactions/${r.body.id}`);
  });

  it('keeps transfers between own accounts out of totals', async () => {
    await call('ana', 'POST', '/api/transactions', { type: 'transfer', date: D(3), amount: 10_000_00, account_id: ids.anaBank, to_account_id: ids.joint, description: 'Aporte' });
    await call('ana', 'POST', '/api/transactions', { type: 'transfer', date: D(3), amount: 100_000_00, account_id: ids.anaBank, to_account_id: ids.anaUsd, to_amount: 100_00, description: 'Compra USD' });
    await call('ana', 'POST', '/api/transactions', { type: 'income', date: D(1), amount: 900_000_00, account_id: ids.anaBank, category_id: cat['Sueldo'], description: 'Sueldo' });
    const dash = (await call('ana', 'GET', `/api/dashboard?scope=user:1&month=${M}`)).body;
    expect(dash.summary.income).toBe(900_000_00);
    // Ana's share of the super (15000) and the dinner (7000)
    expect(dash.summary.expense).toBe(22_000_00);
    const accounts = (await call('ana', 'GET', '/api/accounts')).body;
    const anaBank = accounts.find((a: { id: number }) => a.id === ids.anaBank);
    expect(anaBank.balance).toBe(50_000_00 - 30_000_00 + 8_000_00 - 10_000_00 - 100_000_00 + 900_000_00);
    expect(accounts.find((a: { id: number }) => a.id === ids.anaUsd).balance).toBe(100_00);
    const household = (await call('beto', 'GET', `/api/dashboard?scope=household&month=${M}`)).body;
    expect(household.summary.expense).toBe(40_000_00);
    // Ana's transfer into the joint account is household money in and personal money out.
    expect(household.summary.contributions).toBe(10_000_00);
    expect(dash.summary.contributions).toBe(-10_000_00);
    expect(dash.summary.net).toBe(900_000_00 - 10_000_00 - 22_000_00);
  });

  it('hides private transactions and the private dashboard', async () => {
    await call('ana', 'POST', '/api/transactions', { type: 'expense', date: D(4), amount: 5_000_00, account_id: ids.anaSecret, category_id: cat['Compras'], description: 'Regalo sorpresa' });
    await call('ana', 'POST', '/api/transactions', { type: 'expense', date: D(4), amount: 1_000_00, account_id: ids.anaBank, category_id: cat['Compras'], description: 'Cosa privada', is_private: true });
    const list = (await call('beto', 'GET', '/api/transactions?page_size=500')).body.items.map((t: { description: string }) => t.description);
    expect(list).not.toContain('Regalo sorpresa');
    expect(list).not.toContain('Cosa privada');
    expect(list).toContain('Super');
    const anaDashSeenByBeto = (await call('beto', 'GET', `/api/dashboard?scope=user:1&month=${M}`)).body;
    expect(anaDashSeenByBeto.summary.expense).toBe(22_000_00);
    await call('ana', 'PATCH', '/api/me', { share_dashboard: false });
    expect((await call('beto', 'GET', `/api/dashboard?scope=user:1&month=${M}`)).status).toBe(403);
    const own = (await call('ana', 'GET', `/api/dashboard?scope=user:1&month=${M}`)).body;
    expect(own.summary.expense).toBe(28_000_00);
  });

  it('creates installments as future committed spending', async () => {
    const r = await call('ana', 'POST', '/api/transactions/installments', {
      amount: 120_000_01, count: 3, purchase_date: D(5), first_date: D(10), account_id: ids.anaBank, category_id: cat['Compras'], description: 'Heladera', is_shared: true,
    });
    expect(r.status).toBe(200);
    const rows = db().prepare('SELECT amount, date, installment_number FROM transactions WHERE installment_plan_id = ? ORDER BY installment_number').all(r.body.plan_id) as { amount: number; date: string }[];
    expect(rows.map((x) => x.amount)).toEqual([40_000_01, 40_000_00, 40_000_00]);
    expect(rows[2].date).toBe(`${addMonthsToMonth(M, 2)}-10`);
    const up = (await call('ana', 'GET', '/api/installments/upcoming')).body;
    expect(up.by_month.length).toBeGreaterThanOrEqual(2);
  });

  it('generates recurring bills as pending and confirms them with the real amount', async () => {
    const r = await call('ana', 'POST', '/api/recurring', {
      description: 'Internet', type: 'expense', amount: 25_000_00, account_id: ids.joint, category_id: cat['Servicios'], frequency: 'monthly', next_date: `${addMonthsToMonth(M, -1)}-15`,
    });
    expect(r.status).toBe(200);
    await generateDueRecurring();
    const pending = db().prepare(`SELECT id, amount FROM transactions WHERE recurring_id = ? AND status = 'pending'`).all(r.body.id) as { id: number }[];
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const c = await call('beto', 'POST', `/api/transactions/${pending[0].id}/confirm`, { amount: 27_500_00 });
    expect(c.body.status).toBe('confirmed');
    expect(c.body.amount).toBe(27_500_00);
  });

  it('imports a bank CSV with a preset, rules and duplicate detection', async () => {
    await call('ana', 'POST', '/api/rules', { name: 'Súper', match_type: 'contains', pattern: 'coto', set_category_id: cat['Supermercado'], set_merchant: 'Coto' });
    await call('ana', 'POST', '/api/rules', { name: 'Ahorro', match_type: 'contains', pattern: 'transf a ahorro', set_type: 'transfer', set_to_account_id: ids.anaUsd });
    const csv = `Fecha;Descripcion;Importe\n${D(6).split('-').reverse().join('/')};COMPRA COTO 123;-15.000,50\n${D(7).split('-').reverse().join('/')};Pago recibido;2.000,00\n`;
    const boundary = '----x';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="banco.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
    const up = await app.inject({ method: 'POST', url: '/api/imports/upload', payload, headers: { cookie: cookies.ana, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    const uploadId = up.json().upload_id;
    const config = { delimiter: ';', columns: { date: 0, description: [1], amount: 2 } };
    const prev = await call('ana', 'POST', '/api/imports/preview', { upload_id: uploadId, config, account_id: ids.anaBank });
    expect(prev.status).toBe(200);
    const [coto, pago] = prev.body.items;
    expect(coto).toMatchObject({ amount: 15_000_50, type: 'expense', category_id: cat['Supermercado'], merchant: 'Coto', rule: 'Súper' });
    expect(pago).toMatchObject({ type: 'income', direction: 'in' });
    const commit = await call('ana', 'POST', '/api/imports/commit', { file_name: 'banco.csv', account_id: ids.anaBank, rows: prev.body.items });
    expect(commit.body.imported).toBe(2);
    const again = await call('ana', 'POST', '/api/imports/preview', { upload_id: uploadId, config, account_id: ids.anaBank });
    expect(again.body.items.every((i: { duplicate: string }) => i.duplicate === 'exact')).toBe(true);
    const undo = await call('ana', 'DELETE', `/api/imports/${commit.body.batch_id}`);
    expect(undo.body.deleted).toBe(2);
  });

  it('computes budgets and reports', async () => {
    await call('ana', 'PUT', '/api/budgets', { category_id: cat['Supermercado'], scope: 'household', amount: 20_000_00 });
    const b = (await call('ana', 'GET', `/api/budgets?scope=household&month=${M}`)).body;
    expect(b[0]).toMatchObject({ spent: 30_000_00, pct: 150 });
    const notes = db().prepare(`SELECT title FROM notifications WHERE kind = 'budget'`).all();
    expect(notes.length).toBe(0); // budget created after the expense; alerts fire on new expenses
    await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 100_00, account_id: ids.joint, category_id: cat['Supermercado'], description: 'Pan' });
    await new Promise((r) => setTimeout(r, 50));
    expect(db().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'budget'`).get()).toMatchObject({ n: 2 });

    for (const url of ['/api/reports/trend?scope=household', '/api/reports/net-worth?scope=household&currency=USD', '/api/reports/per-person', '/api/reports/merchants?scope=household', `/api/reports/inflation?scope=household&month=${M}`, '/api/reports/yearly?scope=household&real=true']) {
      const r = await call('beto', 'GET', url);
      expect(r.status, url).toBe(200);
    }
    const usd = (await call('beto', 'GET', `/api/dashboard?scope=household&month=${M}&currency=USD`)).body;
    expect(usd.summary.expense).toBe(Math.round(usd.summary.expense));
    expect(usd.summary.missing_rates).toBe(false);
  });

  it('adjusts budgets for inflation with a switch that never compounds', async () => {
    // As if the budget had been set two months ago; CPI for last month is 5%.
    db().prepare('UPDATE budgets SET base_month = ? WHERE category_id = ?').run(addMonthsToMonth(M, -2), cat['Supermercado']);
    const get = async () => (await call('ana', 'GET', `/api/budgets?scope=household&month=${M}`)).body.find((b: { category_id: number }) => b.category_id === cat['Supermercado']);
    expect(await get()).toMatchObject({ amount: 20_000_00, indexed_pct: 0 });
    for (let i = 0; i < 3; i++) expect((await call('ana', 'PATCH', '/api/settings', { budget_indexing: true })).status).toBe(200);
    expect(await get()).toMatchObject({ amount: 21_000_00, base_amount: 20_000_00, indexed_pct: 5 });
    await call('ana', 'PATCH', '/api/settings', { budget_indexing: false });
    expect(await get()).toMatchObject({ amount: 20_000_00, indexed_pct: 0 });
    expect((await call('ana', 'POST', '/api/budgets/index-cpi', { scope: 'household' })).status).toBe(404);
  });

  it('builds the monthly review docx and exports', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/reviews/${M}/docx?scope=household`, headers: { cookie: cookies.ana } });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const x = await app.inject({ method: 'GET', url: '/api/export/workbook.xlsx', headers: { cookie: cookies.beto } });
    expect(x.statusCode).toBe(200);
    const csv = await app.inject({ method: 'GET', url: '/api/export/transactions.csv', headers: { cookie: cookies.beto } });
    expect(csv.body).not.toContain('Regalo sorpresa');
  });
});
