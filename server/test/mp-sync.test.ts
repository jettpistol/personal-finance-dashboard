import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// The Mercado Pago movements import against a local stand-in for api.mercadopago.com that saves
// report settings, makes reports when asked (ready once the test says so) and serves the files.
const TOKEN = `APP_USR-1234567890123456-102716-${'ab12'.repeat(8)}-123456789`;
const seen: { method: string; path: string; body?: unknown }[] = [];
const configs: Record<string, { columns: { key: string }[] }> = {
  // An older, shorter column list, as an account set up before 0.16.0 may have.
  release_report: { columns: [{ key: 'DATE' }, { key: 'SOURCE_ID' }, { key: 'EXTERNAL_REFERENCE' }] },
  settlement_report: { columns: [] },
};
type Made = { id: number; kind: string; begin_date: string; end_date: string; file_name?: string; status: string; n: number };
const made: Made[] = [];
let hideFileName = false;
// Real accounts may round the dates in the list and serve the file through a redirect.
let roundDates = false;
// What a finished report's status says: the docs show "processed", a real account showed "enabled".
let doneStatus = 'processed';
let redirect: 'none' | 'same' | 'bad' = 'none';
const files: Record<string, (n: number) => string> = {};

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url!, 'http://x');
    seen.push({ method: req.method!, path: url.pathname, body: raw ? JSON.parse(raw) : undefined });
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'invalid access token' });
    if (url.pathname === '/users/me') return send(200, { id: 123456789, nickname: 'IVAN.TEST', site_id: 'MLA' });
    const m = /^\/v1\/account\/(release_report|settlement_report)(\/.*)?$/.exec(url.pathname);
    if (!m) return send(404, { message: 'not_found' });
    const [, kind, rest] = m;
    if (rest === '/config') {
      if (req.method === 'PUT') {
        configs[kind] = JSON.parse(raw);
        return send(200, configs[kind]);
      }
      return send(200, configs[kind]);
    }
    if (!rest && req.method === 'POST') {
      const body = JSON.parse(raw);
      const n = made.filter((r) => r.kind === kind).length + 1;
      made.push({ id: made.length + 1, kind, begin_date: body.begin_date, end_date: body.end_date, status: 'pending', n, file_name: `${kind}-finanzas-${n}.csv` });
      return send(202, {});
    }
    if (rest === '/list')
      return send(
        200,
        made
          .filter((r) => r.kind === kind)
          .map(({ n: _n, kind: _k, file_name, ...r }) => ({
            ...r,
            status: r.status === 'processed' ? doneStatus : r.status,
            ...(roundDates ? { begin_date: `${r.begin_date.slice(0, 10)}T00:00:00Z`, end_date: `${r.end_date.slice(0, 10)}T23:59:59Z`, generation_date: new Date().toISOString() } : {}),
            ...(hideFileName ? {} : { file_name }),
          })),
      );
    const moved = /^\/moved-(.+)$/.exec(rest ?? '');
    if (redirect !== 'none' && !moved && made.some((r) => r.kind === kind && rest === `/${r.file_name}`))
      return res.writeHead(302, { location: redirect === 'same' ? `/v1/account/${kind}/moved-${rest!.slice(1)}` : '/v1/advanced_payments' }).end();
    const file = made.find((r) => r.kind === kind && (rest === `/${r.file_name}` || moved?.[1] === r.file_name));
    if (file && file.status === 'processed') return res.writeHead(200, { 'content-type': 'text/csv' }).end(files[kind](file.n));
    return send(404, { message: 'not_found' });
  });
});

// Dates relative to today, so the test doesn't age: day(3) is three days ago, in Argentina.
const dayIso = (n: number, time = '12:00:00') => {
  const d = new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  return `${d}T${time}.000-03:00`;
};
const day = (n: number) => dayIso(n).slice(0, 10);
const RELEASE_HEADER = 'DATE,SOURCE_ID,EXTERNAL_REFERENCE,RECORD_TYPE,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,GROSS_AMOUNT,MP_FEE_AMOUNT,FINANCING_FEE_AMOUNT,SHIPPING_FEE_AMOUNT,TAXES_AMOUNT,COUPON_AMOUNT,INSTALLMENTS,PAYMENT_METHOD';
const releaseRow = (date: string, id: string, type: string, what: string, credit: string, debit: string, fee = '0.00') =>
  `${date},${id},,${type},${what},${credit},${debit},0.00,${fee},0.00,0.00,0.00,0.00,1,account_money`;
const first = () =>
  [
    RELEASE_HEADER,
    releaseRow(dayIso(20, '00:00:00'), '', 'initial_available_balance', '', '50000.00', '0.00'),
    releaseRow(dayIso(15), '111', 'release', 'payment', '0.00', '2500.00'),
    releaseRow(dayIso(12), '222', 'release', 'money_transfer', '10000.00', '0.00'),
    releaseRow(dayIso(8, '20:00:00'), '333', 'release', 'payment', '0.00', '1500.00'),
    releaseRow(dayIso(6), '', 'release', 'withdrawal', '0.00', '20003.00', '-3.00'),
    releaseRow(dayIso(5), '444', 'release', 'payment', '1940.00', '0.00', '-60.00'),
    releaseRow(dayIso(4), '555', 'release', 'payment', '0.00', '999.00'),
  ].join('\n');
const second = () =>
  [
    RELEASE_HEADER,
    releaseRow(dayIso(7, '00:00:00'), '', 'initial_available_balance', '', '17497.00', '0.00'),
    releaseRow(dayIso(5), '444', 'release', 'payment', '1940.00', '0.00', '-60.00'),
    releaseRow(dayIso(4), '555', 'release', 'payment', '0.00', '999.00'),
    releaseRow(dayIso(1), '666', 'release', 'payment', '0.00', '3000.00'),
    releaseRow(dayIso(1, '15:00:00'), '', 'release', 'withdrawal', '0.00', '5000.00'),
  ].join('\n');
files.release_report = (n) => (n === 1 ? first() : second());
files.settlement_report = () => ['SOURCE_ID;DESCRIPTION;STORE_NAME;POS_NAME', '111;Compra con QR;Kiosco El Sol;Caja 1', '"666";"Cena; con amigos";"Bar ""La Esquina""";'].join('\r\n');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfd-mpsync-'));
let app: FastifyInstance;
const cookies: Record<string, string> = {};
let sync: typeof import('../src/lib/mp-sync.js');
let dbm: typeof import('../src/db/index.js');
let ivanId = 0;
let mpAccount = 0;
let bank = 0;

async function call(who: 'ivan' | 'mili' | 'tercero', method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { cookie: cookies[who] } });
  return { status: res.statusCode, body: res.json() };
}
const processAll = () => made.forEach((r) => (r.status = 'processed'));

beforeAll(async () => {
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  delete process.env.SECRET_KEY;
  Object.assign(process.env, { MP_API_URL: `http://127.0.0.1:${(fake.address() as net.AddressInfo).port}`, DATA_DIR: dataDir });
  dbm = await import('../src/db/index.js');
  const { buildApp } = await import('../src/app.js');
  sync = await import('../src/lib/mp-sync.js');
  dbm.setDb(dbm.openDb(':memory:'));
  app = await buildApp();
  let r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ivan', display_name: 'Iván', password: 'contraseña-larga' } });
  cookies.ivan = r.headers['set-cookie']!.toString().split(';')[0];
  await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'mili', display_name: 'Milagros', password: 'otra-contraseña' }, headers: { cookie: cookies.ivan } });
  r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mili', password: 'otra-contraseña' } });
  cookies.mili = r.headers['set-cookie']!.toString().split(';')[0];
  ivanId = (await call('ivan', 'GET', '/api/me')).body.id;
  bank = (await call('ivan', 'POST', '/api/accounts', { name: 'Banco Iván', type: 'bank', currency: 'ARS', owner: 'me' })).body.id;
});

afterAll(() => {
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('reading the released-money report', () => {
  it('reads amounts, dates, fees and the starting balance', () => {
    const p = sync.parseReleaseReport(first(), files.settlement_report(1));
    expect(p.initial).toBe(5_000_000);
    expect(p.closing).toBe(5_000_000 - 250_000 + 1_000_000 - 150_000 - 2_000_300 + 194_000 - 99_900);
    expect(p.rows).toHaveLength(6);
    expect(p.rows[0]).toMatchObject({ date: day(15), amount: -250_000, merchant: 'Kiosco El Sol', description: 'Pago · Kiosco El Sol · Compra con QR' });
    expect(p.rows[3]).toMatchObject({ amount: -2_000_300, type: 'transfer', fees: [{ platform: 'Mercado Pago', kind: 'fee', amount: 300 }] });
    expect(p.rows[4].fees).toEqual([{ platform: 'Mercado Pago', kind: 'fee', amount: 6000 }]);
  });

  it('reads quoted fields, semicolons and both decimal styles', () => {
    expect(sync.parseCsv('a;b\n"x;y";"say ""hi"""\n')).toEqual([['a', 'b'], ['x;y', 'say "hi"']]);
    expect(sync.mpAmount('1,234.56')).toBe(123456);
    expect(sync.mpAmount('1.234,56')).toBe(123456);
    expect(sync.mpAmount('-43.04')).toBe(-4304);
    expect(sync.mpAmount('')).toBe(0);
    expect(() => sync.mpAmount('12abc')).toThrow();
  });

  it('refuses a report without amounts', () => {
    expect(() => sync.parseReleaseReport('DATE,SOURCE_ID\n2026-10-01T00:00:00.000-03:00,1')).toThrow(/columnas/);
  });
});

describe('Mercado Pago movements import', () => {
  it('connects and gets a Mercado Pago account in Cuentas', async () => {
    expect((await call('ivan', 'PUT', '/api/me/mercadopago', { access_token: TOKEN })).status).toBe(200);
    expect((await call('ivan', 'PUT', '/api/me/mercadopago', { history_start: day(20) })).status).toBe(200);
    const view = (await call('ivan', 'GET', '/api/me/mercadopago')).body;
    mpAccount = view.account.id;
    expect(view.sync).toMatchObject({ status: 'off', live: false });
    // Typed by hand before connecting: the import completes it instead of doubling it.
    expect((await call('ivan', 'POST', '/api/transactions', { type: 'expense', date: day(8), amount: 150_000, account_id: mpAccount, description: 'Verdulería' })).status).toBe(200);
  });

  it('shows the account as connected (not live yet) only to its owner', async () => {
    const mine = (await call('ivan', 'GET', '/api/accounts')).body.find((a: { id: number }) => a.id === mpAccount);
    expect(mine.live).toMatchObject({ state: 'connected' });
    const theirs = (await call('mili', 'GET', '/api/accounts')).body as { live: unknown }[];
    expect(theirs.every((a) => a.live === null)).toBe(true);
  });

  it('asks for both reports from the start date, widening old report settings first', async () => {
    const r = await call('ivan', 'POST', '/api/me/mercadopago/sync', { start: true });
    expect(r.status).toBe(200);
    expect(r.body.sync.status).toBe('fetching');
    const put = seen.find((s) => s.method === 'PUT' && s.path === '/v1/account/release_report/config');
    expect((put?.body as { columns: { key: string }[] }).columns.map((c) => c.key)).toContain('NET_DEBIT_AMOUNT');
    expect(made.map((m) => m.kind).sort()).toEqual(['release_report', 'settlement_report']);
    // Midnight of the start date in Argentina.
    expect(made[0].begin_date).toBe(`${day(20)}T03:00:00Z`);
    // Nothing but reads, the approved report writes and nothing else.
    for (const s of seen.filter((x) => x.method !== 'GET')) expect(s.path).toMatch(/^\/v1\/account\/(release|settlement)_report(\/config)?$/);
  });

  it('waits while Mercado Pago makes the report, then puts everything up for review', async () => {
    expect((await sync.advanceSync(ivanId)).status).toBe('fetching');
    processAll();
    const v = await sync.advanceSync(ivanId);
    expect(v).toMatchObject({ status: 'review', review_count: 6, balance: 3_693_800 });
    const review = (await call('ivan', 'GET', '/api/me/mercadopago/review')).body;
    expect(review.opening).toEqual({ date: day(20), amount: 5_000_000 });
    const merge = review.items.find((i: { amount: number }) => i.amount === 150_000);
    expect(merge).toMatchObject({ merge_with: expect.any(Number), duplicate: null, hint: { label: 'Ya cargado' } });
    // Nothing is saved before the review.
    expect((await call('ivan', 'GET', `/api/transactions?account_id=${mpAccount}`)).body.total).toBe(1);
  });

  it('saves the review: merges the typed one, keeps fees, sets the starting balance, goes live', async () => {
    const { items } = (await call('ivan', 'GET', '/api/me/mercadopago/review')).body;
    const rows = items.map((i: { amount: number; type: string; to_account_id: number | null }) => ({
      ...i,
      include: i.amount !== 99_900,
      to_account_id: i.type === 'transfer' ? bank : i.to_account_id,
    }));
    const r = await call('ivan', 'POST', '/api/me/mercadopago/review', { rows, use_opening: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ imported: 4, merged: 1, failures: [], opening: 5_000_000 });
    expect(r.body.sync).toMatchObject({ status: 'live', live: true, review_count: 0 });
    const txs = (await call('ivan', 'GET', `/api/transactions?account_id=${mpAccount}`)).body.items as { description: string; amount: number; fees: unknown[]; date: string }[];
    expect(txs).toHaveLength(5);
    const typed = txs.find((t) => t.description === 'Verdulería')!;
    expect(typed.date).toBe(day(8));
    expect(txs.find((t) => t.amount === 194_000)!.fees).toEqual([{ platform: 'Mercado Pago', kind: 'fee', amount: 6000 }]);
    // Balance = Mercado Pago's own, minus the one unticked.
    const acc = (await call('ivan', 'GET', '/api/accounts')).body.find((a: { id: number }) => a.id === mpAccount);
    expect(acc.balance).toBe(3_693_800 + 99_900);
    expect(acc.live).toMatchObject({ state: 'live' });
  });

  it('then brings only what is new by itself, and holds a withdrawal for review', async () => {
    await sync.advanceSync(ivanId, { start: true });
    const ask = made.filter((m) => m.kind === 'release_report').at(-1)!;
    // Overlaps two days with what was already read.
    expect(Date.parse(ask.begin_date)).toBeLessThan(Date.parse(made[0].end_date));
    processAll();
    const v = await sync.advanceSync(ivanId);
    expect(v).toMatchObject({ status: 'live', review_count: 1 });
    const txs = (await call('ivan', 'GET', `/api/transactions?account_id=${mpAccount}`)).body.items as { amount: number; merchant: string | null; description: string }[];
    expect(txs).toHaveLength(6);
    expect(txs.filter((t) => t.amount === 194_000)).toHaveLength(1);
    expect(txs.some((t) => t.amount === 99_900)).toBe(false);
    expect(txs.find((t) => t.amount === 300_000)).toMatchObject({ merchant: 'Bar "La Esquina"', description: 'Pago · Bar "La Esquina" · Cena; con amigos' });
  });

  it('reports the fees', async () => {
    const r = (await call('ivan', 'GET', `/api/reports/fees?scope=user:${ivanId}`)).body;
    expect(r.total).toBe(6300);
    expect(r.platforms[0]).toMatchObject({ platform: 'Mercado Pago', count: 2, kinds: { fee: 6300 } });
  });

  it('stops with a clear message when Mercado Pago gives no file name', async () => {
    hideFileName = true;
    await sync.advanceSync(ivanId, { start: true });
    processAll();
    const v = await sync.advanceSync(ivanId);
    expect(v.status).toBe('error');
    expect(v.error).toMatch(/nombre del archivo/);
    hideFileName = false;
    expect((await call('ivan', 'GET', '/api/accounts')).body.find((a: { id: number }) => a.id === mpAccount).live.state).toBe('error');
  });
});

describe('a first import longer than a month', () => {
  it('goes on report after report until today, then waits for the review', async () => {
    expect((await call('mili', 'PUT', '/api/me/mercadopago', { access_token: TOKEN, history_start: day(45) })).status).toBe(200);
    const miliId = (await call('mili', 'GET', '/api/me')).body.id;
    const before = made.length;
    await call('mili', 'POST', '/api/me/mercadopago/sync', { start: true });
    processAll();
    expect((await sync.advanceSync(miliId)).status).toBe('fetching');
    // The next month is asked for without a click (the screen's polling or the hourly check).
    await sync.advanceSync(miliId);
    const asks = made.slice(before).filter((m) => m.kind === 'release_report');
    expect(asks).toHaveLength(2);
    expect(Date.parse(asks[1].begin_date)).toBeLessThan(Date.parse(asks[0].end_date));
    processAll();
    expect((await sync.advanceSync(miliId)).status).toBe('review');
  });
});

describe('what real accounts may do', () => {
  let id = 0;
  const reset = () => dbm.db().prepare('DELETE FROM mp_sync WHERE user_id = ?').run(id);
  beforeAll(async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'tercero', display_name: 'Tercero', password: 'tercera-contraseña' }, headers: { cookie: cookies.ivan } });
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tercero', password: 'tercera-contraseña' } });
    cookies.tercero = r.headers['set-cookie']!.toString().split(';')[0];
    await call('tercero', 'PUT', '/api/me/mercadopago', { access_token: TOKEN, history_start: day(20) });
    id = (await call('tercero', 'GET', '/api/me')).body.id;
  });

  it('finds the report when Mercado Pago rounds its dates, and follows a redirected download', async () => {
    reset();
    roundDates = true;
    redirect = 'same';
    await sync.advanceSync(id, { start: true });
    processAll();
    expect((await sync.advanceSync(id)).status).toBe('review');
    expect(seen.some((x) => x.path.includes('/moved-'))).toBe(true);
    roundDates = false;
    redirect = 'none';
  });

  it('shows why it waits instead of spinning silently, and gives up with the reason', async () => {
    reset();
    redirect = 'bad';
    await sync.advanceSync(id, { start: true });
    processAll();
    let v = await sync.advanceSync(id);
    expect(v).toMatchObject({ status: 'fetching', waiting: true, note: 'No se pudo descargar el reporte de Mercado Pago.' });
    for (let i = 0; i < 5; i++) v = await sync.advanceSync(id);
    expect(v.status).toBe('error');
    expect(v.error).toMatch(/descargar/);
    // Nothing outside the allowed reads was ever asked for.
    expect(seen.some((x) => x.path === '/v1/advanced_payments')).toBe(false);
    redirect = 'none';
  });

  it('downloads a finished report whose status says "enabled"', async () => {
    reset();
    doneStatus = 'enabled';
    await sync.advanceSync(id, { start: true });
    // Still being made: it waits and says so.
    expect((await sync.advanceSync(id)).note).toMatch(/preparando.*pending/);
    processAll();
    expect((await sync.advanceSync(id)).status).toBe('review');
    doneStatus = 'processed';
  });

  it('stops with the reason when Mercado Pago says the report failed', async () => {
    reset();
    doneStatus = 'error';
    await sync.advanceSync(id, { start: true });
    processAll();
    const v = await sync.advanceSync(id);
    expect(v.status).toBe('error');
    expect(v.error).toMatch(/no pudo generar.*error/);
    doneStatus = 'processed';
  });

  it('a report that takes long to make does not start the first import over', async () => {
    reset();
    await sync.advanceSync(id, { start: true });
    const row = dbm.db().prepare('SELECT pending FROM mp_sync WHERE user_id = ?').get(id) as { pending: string };
    const p = JSON.parse(row.pending);
    // Asked for 20 minutes ago (Mercado Pago was slow); the range ended a minute before that.
    dbm.db().prepare('UPDATE mp_sync SET pending = ? WHERE user_id = ?').run(JSON.stringify({ ...p, requested_at: Date.now() - 20 * 60_000 }), id);
    processAll();
    expect((await sync.advanceSync(id)).status).toBe('review');
  });
});

describe('fees on any movement', () => {
  it('records fees typed in the form and keeps them when an edit leaves them out', async () => {
    const created = (await call('ivan', 'POST', '/api/transactions', {
      type: 'income',
      date: day(2),
      amount: 97_000,
      account_id: bank,
      description: 'Venta en marketplace',
      fees: [{ platform: 'Otra plataforma', kind: 'fee', amount: 3000 }],
    })).body;
    expect(created.fees).toEqual([{ platform: 'Otra plataforma', kind: 'fee', amount: 3000 }]);
    const edited = (await call('ivan', 'PUT', `/api/transactions/${created.id}`, { type: 'income', date: day(2), amount: 97_000, account_id: bank, description: 'Venta' })).body;
    expect(edited.fees).toHaveLength(1);
    const cleared = (await call('ivan', 'PUT', `/api/transactions/${created.id}`, { type: 'income', date: day(2), amount: 97_000, account_id: bank, description: 'Venta', fees: [] })).body;
    expect(cleared.fees).toEqual([]);
    expect((await call('ivan', 'GET', '/api/fees/platforms')).body).toContain('Mercado Pago');
  });
});
