import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, setDb, db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { addMonthsToMonth, currentMonth, today } from '../src/lib/dates.js';
import { commitmentPeriods, sendPendingReminders, type Commitment } from '../src/lib/commitments.js';
import { installmentAmounts } from '../src/lib/loan-schedule.js';

let app: FastifyInstance;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const M = currentMonth();
const prev = addMonthsToMonth(M, -1);

async function call(who: 'ana' | 'beto', method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { cookie: cookies[who] } });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body };
}

beforeAll(async () => {
  setDb(openDb(':memory:'));
  app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ana', display_name: 'Ana', password: 'contraseña-larga' } });
  cookies.ana = r.headers['set-cookie']!.toString().split(';')[0];
  await call('ana', 'POST', '/api/users', { username: 'beto', display_name: 'Beto', password: 'otra-contraseña' });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'beto', password: 'otra-contraseña' } });
  cookies.beto = login.headers['set-cookie']!.toString().split(';')[0];
  const mk = async (body: object) => (await call('ana', 'POST', '/api/accounts', body)).body.id as number;
  ids.usd = await mk({ name: 'Dólares Ana', type: 'bank', currency: 'USD', owner: 'me', opening_balance: 1_000_00 });
  ids.savings = await mk({ name: 'Ahorro dólares', type: 'savings', currency: 'USD', owner: 'me' });
  ids.ars = await mk({ name: 'Banco Ana', type: 'bank', currency: 'ARS', owner: 'me', opening_balance: 500_000_00 });
});

describe('pagos pendientes', () => {
  it('rolls a missed month over, links exact amounts by itself and asks a reason for partial payments', async () => {
    const c = await call('ana', 'POST', '/api/commitments', { kind: 'savings', title: 'Ahorro mensual', amount: 200_00, currency: 'USD', account_id: ids.savings, day: 6, start_month: prev });
    expect(c.status).toBe(200);
    // The account has to be in the commitment's currency.
    expect((await call('ana', 'POST', '/api/commitments', { kind: 'savings', title: 'X', amount: 1, currency: 'ARS', account_id: ids.savings, day: 6, start_month: M })).status).toBe(400);

    let item = (await call('ana', 'GET', '/api/pending')).body[0];
    expect(item).toMatchObject({ kind: 'savings', expected: 400_00, carried: 200_00, remaining: 400_00 });
    expect((await call('beto', 'GET', '/api/pending')).body).toEqual([]); // only whoever is responsible

    // 200 (the monthly amount) is linked automatically; 200 from last month stays.
    await call('ana', 'POST', '/api/transactions', { type: 'transfer', date: today(), amount: 200_00, account_id: ids.usd, to_account_id: ids.savings, description: 'Ahorro' });
    item = (await call('ana', 'GET', '/api/pending')).body[0];
    expect(item).toMatchObject({ paid: 200_00, remaining: 200_00 });

    // A smaller movement linked by hand needs a reason.
    const t = (await call('ana', 'POST', '/api/transactions', { type: 'transfer', date: today(), amount: 50_00, account_id: ids.usd, to_account_id: ids.savings, description: 'Algo' })).body;
    expect((await call('ana', 'POST', `/api/pending/commitment/${c.body.id}/link`, { transaction_id: t.id })).status).toBe(400);
    expect((await call('ana', 'POST', `/api/pending/commitment/${c.body.id}/link`, { transaction_id: t.id, reason: 'Me quedé corto este mes' })).status).toBe(200);
    // Pesos don't count for a dollar target.
    const pesos = (await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 150_00, account_id: ids.ars, description: 'X' })).body;
    expect((await call('ana', 'POST', `/api/pending/commitment/${c.body.id}/link`, { transaction_id: pesos.id, reason: 'x' })).status).toBe(400);

    // Exactly what's left settles the month.
    await call('ana', 'POST', '/api/transactions', { type: 'transfer', date: today(), amount: 150_00, account_id: ids.usd, to_account_id: ids.savings, description: 'Resto' });
    item = (await call('ana', 'GET', '/api/pending')).body[0];
    expect(item).toMatchObject({ remaining: 0, status: 'done' });
  });

  it('lowers next month when you pay extra', () => {
    const c = { id: 1, amount: 200_00, day: 6, start_month: prev, months: null } as Commitment;
    const periods = commitmentPeriods(c, [{ id: 1, commitment_id: 1, month: prev, transaction_id: null, amount: 300_00, date: `${prev}-06`, reason: null, auto: 0 }]);
    expect(periods.map((p) => p.expected)).toEqual([200_00, 100_00]);
  });

  it('chases only within 8 to 18, once per slot, only the responsible person', async () => {
    const c = await call('ana', 'POST', '/api/commitments', { kind: 'owe', title: 'Deuda con Juan', person: 'Juan', amount: 10_000_00, currency: 'ARS', day: 1, start_month: M });
    expect(c.status).toBe(200);
    const count = () => (db().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'pending'`).get() as { n: number }).n;
    const at = (h: number) => new Date(`${today()}T${String(h + 3).padStart(2, '0')}:00:00Z`); // Buenos Aires is UTC-3
    await sendPendingReminders(at(7));
    expect(count()).toBe(0);
    await sendPendingReminders(at(9));
    await sendPendingReminders(at(10));
    expect(count()).toBe(1);
    await sendPendingReminders(at(13));
    expect(count()).toBe(2);
    await sendPendingReminders(at(19));
    expect(count()).toBe(2);
    const users = db().prepare(`SELECT DISTINCT user_id FROM notifications WHERE kind = 'pending'`).all() as { user_id: number }[];
    expect(users).toHaveLength(1);
    await call('ana', 'DELETE', `/api/commitments/${c.body.id}`);
  });

  it('locks interest and installments once a loan is created, and collects installments', async () => {
    expect(installmentAmounts(100_000_00, 0, 4)).toEqual([25_000_00, 25_000_00, 25_000_00, 25_000_00]);
    const [payment] = installmentAmounts(100_000_00, 5, 3);
    expect(payment).toBe(Math.round((100_000_00 * 0.05) / (1 - Math.pow(1.05, -3))));

    const first = `${M}-01`;
    const lent = `${prev}-01`;
    const id = (await call('ana', 'POST', '/api/loans', { person: 'Lucas', kind: 'money', amount: 100_000_00, currency: 'ARS', lent_on: lent, interest_rate: 5, installments: 3, first_due: first })).body.id;
    const loan = (await call('ana', 'GET', '/api/loans')).body.find((l: { id: number }) => l.id === id);
    expect(loan).toMatchObject({ total: payment * 3, interest_rate: 5, installments: 3 });
    expect(loan.schedule).toHaveLength(3);

    const base = { person: 'Lucas', kind: 'money', amount: 100_000_00, currency: 'ARS', lent_on: lent, interest_rate: 5, installments: 3, first_due: first };
    expect((await call('ana', 'PUT', `/api/loans/${id}`, { ...base, interest_rate: 2 })).status).toBe(400);
    expect((await call('ana', 'PUT', `/api/loans/${id}`, { ...base, person: 'Lucas G.', notes: 'Primo' })).status).toBe(200);

    const pending = (await call('ana', 'GET', '/api/pending')).body.find((i: { key: string }) => i.key === `l${id}`);
    expect(pending).toMatchObject({ kind: 'collect', remaining: payment });
    // An income of exactly one installment is recorded as a return on its own.
    await call('ana', 'POST', '/api/transactions', { type: 'income', date: today(), amount: payment, account_id: ids.ars, description: 'Me pagó Lucas' });
    const after = (await call('ana', 'GET', '/api/loans')).body.find((l: { id: number }) => l.id === id);
    expect(after.returned).toBe(payment);
    expect(after.returns[0].transaction_id).toBeTruthy();
  });

  it('links a movement made from Registrar in the same save, and saves nothing if it fails', async () => {
    const c = await call('ana', 'POST', '/api/commitments', { kind: 'savings', title: 'Ahorro conversión', amount: 200_00, currency: 'USD', account_id: ids.savings, day: 31, start_month: M });
    const pending = { source: 'commitment', id: c.body.id };
    const count = () => (db().prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;
    const before = count();
    // Pesos into the dollar savings account, converted: USD 190 is partial, so it needs a reason first.
    const conv = { type: 'transfer', date: today(), amount: 247_000_00, account_id: ids.ars, to_account_id: ids.savings, to_amount: 190_00, description: 'Compra de dólares' };
    const noReason = await call('ana', 'POST', '/api/transactions', { ...conv, pending });
    expect(noReason.status).toBe(400);
    expect(noReason.body.fields).toEqual(['reason']);
    expect(count()).toBe(before);
    const ok = await call('ana', 'POST', '/api/transactions', { ...conv, pending: { ...pending, reason: 'El cambio no alcanzó' } });
    expect(ok.status).toBe(200);
    let item = (await call('ana', 'GET', '/api/pending')).body.find((i: { key: string }) => i.key === `c${c.body.id}`);
    expect(item).toMatchObject({ paid: 190_00, remaining: 10_00 });
    expect(item.history[0].payments[0]).toMatchObject({ amount: 190_00, reason: 'El cambio no alcanzó' });
    // Something that can't count (an expense for a savings target) isn't saved at all.
    const wrong = await call('ana', 'POST', '/api/transactions', { type: 'expense', date: today(), amount: 10_00, account_id: ids.usd, description: 'X', pending });
    expect(wrong.status).toBe(400);
    expect(count()).toBe(before + 1);
    // Day 31 falls on the month's last day.
    const [y, m] = M.split('-').map(Number);
    expect(item.due).toBe(`${M}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`);
    // The rest settles it: it shows as done this month.
    await call('ana', 'POST', '/api/transactions', { type: 'transfer', date: today(), amount: 13_000_00, account_id: ids.ars, to_account_id: ids.savings, to_amount: 10_00, description: 'Resto', pending });
    item = (await call('ana', 'GET', '/api/pending')).body.find((i: { key: string }) => i.key === `c${c.body.id}`);
    expect(item).toMatchObject({ remaining: 0, status: 'done' });
  });

  it('takes a partial return with a reason, and a returned loan moves to Completados', async () => {
    const id = (await call('ana', 'POST', '/api/loans', { person: 'Sofi', kind: 'money', item: 'Pasajes a Córdoba', amount: 200_00, currency: 'ARS', lent_on: `${prev}-10`, due_on: today() })).body.id;
    const pending = { source: 'loan', id };
    const income = { type: 'income', date: today(), amount: 190_00, account_id: ids.ars, description: 'Devolución de Sofi' };
    const noReason = await call('ana', 'POST', '/api/transactions', { ...income, pending });
    expect(noReason.status).toBe(400);
    expect(noReason.body.fields).toEqual(['reason']);
    expect((await call('ana', 'POST', '/api/transactions', { ...income, pending: { ...pending, reason: 'Le faltaba cambio' } })).status).toBe(200);
    let item = (await call('ana', 'GET', '/api/pending')).body.find((i: { key: string }) => i.key === `l${id}`);
    expect(item).toMatchObject({ remaining: 10_00 });
    // Counters split in Pagos and Cobros.
    const summary = (await call('ana', 'GET', '/api/pending/summary')).body;
    expect(summary.collect).toBeGreaterThanOrEqual(1);
    expect(summary.pay + summary.collect).toBe(summary.due);
    // The last 10 closes it; it leaves the list for Completados.
    await call('ana', 'POST', '/api/transactions', { type: 'income', date: today(), amount: 10_00, account_id: ids.ars, description: 'Resto', pending });
    item = (await call('ana', 'GET', '/api/pending')).body.find((i: { key: string }) => i.key === `l${id}`);
    expect(item).toBeUndefined();
    const done = (await call('ana', 'GET', '/api/pending/completed')).body;
    expect(done.find((d: { key: string }) => d.key === `l${id}`)).toMatchObject({ title: 'Pasajes a Córdoba', total: 200_00, how: 'paid', kind: 'collect' });
    expect((await call('beto', 'GET', '/api/pending/completed')).body).toEqual([]);
  });

  it('ties a loan to inflation, with installments every 2 weeks, locked once saved', async () => {
    const lent = `${prev}-05`;
    const first = `${M}-01`;
    const base = { person: 'Caro', kind: 'money', amount: 90_000_00, currency: 'ARS', lent_on: lent, installments: 3, first_due: first, period_unit: 'week', period_count: 2, indexed: true };
    const preview = (await call('ana', 'GET', `/api/loans/preview?amount=9000000&installments=3&first_due=${first}&lent_on=${lent}&period_unit=week&period_count=2&indexed=1`)).body;
    expect(preview.installments).toHaveLength(3);
    const id = (await call('ana', 'POST', '/api/loans', base)).body.id;
    const loan = (await call('ana', 'GET', '/api/loans')).body.find((l: { id: number }) => l.id === id);
    expect(loan).toMatchObject({ indexed: 1, period_unit: 'week', period_count: 2 });
    expect(loan.schedule.map((i: { due: string }) => i.due).slice(0, 3)).toEqual(preview.installments.map((i: { due: string }) => i.due));
    // The CPI of last month (5% in this test database) is applied once it counts as published.
    expect(loan.total).toBeGreaterThanOrEqual(90_000_00);
    // Terms are fixed: switching inflation off is refused.
    expect((await call('ana', 'PUT', `/api/loans/${id}`, { ...base, indexed: false })).status).toBe(400);
    expect((await call('ana', 'PUT', `/api/loans/${id}`, { ...base, notes: 'Para el alquiler' })).status).toBe(200);
    // Forgiving says how much.
    const forgiven = await call('ana', 'POST', `/api/loans/${id}/close`, { reason: 'forgiven' });
    expect(forgiven.body.forgiven).toBe(loan.outstanding);
    // Impossible dates are refused by the server too.
    expect((await call('ana', 'POST', '/api/loans', { ...base, first_due: '150000-01-01' })).status).toBe(400);
  });
});
