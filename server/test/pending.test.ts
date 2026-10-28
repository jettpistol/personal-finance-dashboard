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
});
