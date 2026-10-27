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

  it('creates income installments as pending, to confirm when each one is paid', async () => {
    const r = await call('ana', 'POST', '/api/transactions/installments', {
      type: 'income', amount: 90_000_00, count: 3, purchase_date: D(1), first_date: D(1), account_id: ids.anaBank, category_id: cat['Ventas'], description: 'Venta de la bici',
    });
    expect(r.status).toBe(200);
    const rows = db().prepare('SELECT id, type, status, amount FROM transactions WHERE installment_plan_id = ? ORDER BY installment_number').all(r.body.plan_id) as { id: number; type: string; status: string }[];
    expect(rows.map((x) => [x.type, x.status])).toEqual([['income', 'pending'], ['income', 'pending'], ['income', 'pending']]);
    expect((await call('ana', 'GET', '/api/installments/upcoming')).body.plans.some((p: { id: number }) => p.id === r.body.plan_id)).toBe(false);
    expect((await call('ana', 'POST', `/api/transactions/${rows[0].id}/confirm`, { amount: 30_000_00 })).status).toBe(200);
    expect(db().prepare('SELECT status FROM transactions WHERE id = ?').get(rows[0].id)).toMatchObject({ status: 'confirmed' });
    db().prepare('DELETE FROM installment_plans WHERE id = ?').run(r.body.plan_id);
    db().prepare('DELETE FROM transactions WHERE installment_plan_id IS NULL AND description LIKE ?').run('Venta de la bici%');
  });

  it('bulk-uploads movements from the simple CSV, with preview, duplicates and errors', async () => {
    const csv = [
      'fecha,tipo,monto,cuenta,categoria,descripcion,comercio,compartido,etiquetas,notas',
      `${D(2).split('-').reverse().join('/')},gasto,"1.234,50",Banco Ana,Supermercado > Almacén,Compra CSV,Coto,si,csv|prueba,`,
      `${D(3)},ingreso,"500,00",cuenta común,Sueldo,Ingreso CSV,,no,,`,
      `${D(3)},gasto,abc,Banco Ana,,Mal monto,,,,`,
      `${D(3)},gasto,"10,00",No existe,,Sin cuenta,,,,`,
    ].join('\n');
    const upload = (commit: boolean) => {
      const boundary = '----csvtest';
      const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="m.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
      return app.inject({ method: 'POST', url: `/api/transactions/csv${commit ? '?commit=1' : ''}`, payload, headers: { cookie: cookies.ana, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    };
    const preview = (await upload(false)).json();
    expect(preview.created).toBe(0);
    expect(preview.rows.map((r: { status: string }) => r.status)).toEqual(['ok', 'ok', 'error', 'error']);
    expect(preview.rows[0]).toMatchObject({ amount: 1_234_50, type: 'expense', category: 'Almacén' });
    const done = (await upload(true)).json();
    expect(done.created).toBe(2);
    const saved = db().prepare(`SELECT is_shared, tags, merchant FROM transactions WHERE description = 'Compra CSV'`).get();
    expect(saved).toMatchObject({ is_shared: 1, tags: '["csv","prueba"]', merchant: 'Coto' });
    const again = (await upload(true)).json();
    expect(again.created).toBe(0);
    expect(again.rows.slice(0, 2).map((r: { status: string }) => r.status)).toEqual(['duplicate', 'duplicate']);
    db().prepare(`DELETE FROM transactions WHERE description IN ('Compra CSV', 'Ingreso CSV')`).run();
  });

  it('tracks loans: partial returns close a money loan, items close on return, private to the lender', async () => {
    const id = (await call('ana', 'POST', '/api/loans', { person: 'Juan', kind: 'money', amount: 100_00, currency: 'ARS', lent_on: D(1), due_on: D(2) })).body.id;
    const item = (await call('ana', 'POST', '/api/loans', { person: 'Juan', kind: 'item', item: 'Taladro', lent_on: D(1) })).body.id;
    expect((await call('ana', 'POST', '/api/loans', { person: 'X', kind: 'money', lent_on: D(1) })).status).toBe(400);
    await call('ana', 'POST', `/api/loans/${id}/returns`, { date: D(2), amount: 40_00 });
    let list = (await call('ana', 'GET', '/api/loans')).body;
    expect(list.find((l: { id: number }) => l.id === id)).toMatchObject({ returned: 40_00, outstanding: 60_00, closed_on: null });
    await call('ana', 'POST', `/api/loans/${id}/returns`, { date: D(3), amount: 60_00 });
    await call('ana', 'POST', `/api/loans/${item}/returns`, { date: D(3) });
    list = (await call('ana', 'GET', '/api/loans')).body;
    expect(list.find((l: { id: number }) => l.id === id)).toMatchObject({ outstanding: 0, closed_reason: 'returned', closed_on: D(3) });
    expect(list.find((l: { id: number }) => l.id === item)).toMatchObject({ closed_reason: 'returned' });
    expect((await call('beto', 'GET', '/api/loans')).body).toEqual([]);
    expect((await call('beto', 'DELETE', `/api/loans/${id}`)).status).toBe(404);
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

describe('several accounts in one browser', () => {
  // A tiny cookie jar, so both cookies (active session + other accounts) round-trip like in a browser.
  const jar: Record<string, string> = {};
  async function browser(method: string, url: string, payload?: unknown) {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: cookie ? { cookie } : {} });
    for (const c of res.cookies as { name: string; value: string; expires?: Date }[]) {
      if (!c.value || (c.expires && c.expires.getTime() < Date.now())) delete jar[c.name];
      else jar[c.name] = c.value;
    }
    return { status: res.statusCode, body: res.json() };
  }
  const me = async () => (await browser('GET', '/api/auth/status')).body.user?.username;

  it('adds a second account without replacing the active one, lists and switches', async () => {
    expect((await browser('POST', '/api/auth/login', { username: 'ana', password: 'contraseña-larga' })).status).toBe(200);
    // Adding needs a logged-in browser.
    expect((await app.inject({ method: 'POST', url: '/api/auth/accounts', payload: { username: 'beto', password: 'otra-contraseña' } })).statusCode).toBe(401);
    expect((await browser('POST', '/api/auth/accounts', { username: 'ana', password: 'contraseña-larga' })).status).toBe(409);
    const add = await browser('POST', '/api/auth/accounts', { username: 'beto', password: 'otra-contraseña' });
    expect(add.status).toBe(200);
    expect(jar.pfd_more).toBeTruthy();
    expect(await me()).toBe('ana');
    const list = (await browser('GET', '/api/auth/accounts')).body;
    expect(list.map((u: { username: string; active: boolean }) => [u.username, u.active])).toEqual([['ana', true], ['beto', false]]);

    const sw = await browser('POST', '/api/auth/switch', { user_id: list[1].id });
    expect(sw.status).toBe(200);
    expect(await me()).toBe('beto');
    expect((await browser('GET', '/api/me')).body.username).toBe('beto');
    expect((await browser('POST', '/api/auth/switch', { user_id: list[0].id })).status).toBe(200);
    expect(await me()).toBe('ana');
    expect((await browser('POST', '/api/auth/switch', { user_id: 999 })).status).toBe(404);
  });

  it('logout falls back to the other account; all: true logs out everyone', async () => {
    const out = await browser('POST', '/api/auth/logout');
    expect(out.body.user.username).toBe('beto');
    expect(await me()).toBe('beto');
    expect((await browser('GET', '/api/auth/accounts')).body).toHaveLength(1);
    expect(jar.pfd_more).toBeUndefined();
    // Earlier sessions of other browsers are untouched.
    expect((await call('ana', 'GET', '/api/auth/status')).body.user.username).toBe('ana');

    await browser('POST', '/api/auth/accounts', { username: 'ana', password: 'contraseña-larga', switch: true });
    expect(await me()).toBe('ana');
    expect((await browser('GET', '/api/auth/accounts')).body).toHaveLength(2);
    expect((await browser('POST', '/api/auth/logout', { all: true })).body.user).toBeNull();
    expect(await me()).toBeUndefined();
    expect(jar).toEqual({});
  });

  it('applies the login lockout to adding an account', async () => {
    await browser('POST', '/api/auth/login', { username: 'ana', password: 'contraseña-larga' });
    const bad = { username: 'beto', password: 'nope-nope-nope' };
    expect((await browser('POST', '/api/auth/accounts', bad)).status).toBe(401);
    expect((await browser('POST', '/api/auth/accounts', bad)).status).toBe(401);
    expect((await browser('POST', '/api/auth/accounts', bad)).status).toBe(429);
    expect((await browser('POST', '/api/auth/accounts', { username: 'beto', password: 'otra-contraseña' })).status).toBe(429);
    expect((await browser('GET', '/api/auth/accounts')).body).toHaveLength(1);
    db().prepare('DELETE FROM login_attempts').run();
    expect((await browser('POST', '/api/auth/accounts', { username: 'beto', password: 'otra-contraseña' })).status).toBe(200);
    // If the active session expires, the status check moves on to the other account.
    db().prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = 1').run();
    expect((await browser('GET', '/api/accounts')).status).toBe(401);
    expect(await me()).toBe('beto');
    expect((await browser('GET', '/api/accounts')).status).toBe(200);
    await browser('POST', '/api/auth/logout', { all: true });
    expect(jar).toEqual({});
  });
});
