import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// A local stand-in for api.mercadopago.com: it knows one valid token and records every request,
// so the tests can prove only GETs to the allowed paths are ever sent.
const TOKEN = `APP_USR-1234567890123456-102716-${'ab12'.repeat(8)}-123456789`;
const seen: { method: string; path: string; body?: unknown }[] = [];
// The release report starts without settings (404) until the app saves them; the other one already has them.
let releaseConfigured = false;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url!, 'http://x');
    seen.push({ method: req.method!, path: url.pathname, body: raw ? JSON.parse(raw) : undefined });
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'invalid access token' });
    if (url.pathname === '/users/me') return send(200, { id: 123456789, nickname: 'IVAN.TEST', email: 'ivan@example.com', site_id: 'MLA' });
    if (url.pathname === '/v1/payments/search') return send(200, { results: [], paging: { total: 0 } });
    if (url.pathname === '/v1/account/settlement_report/config') return send(200, { columns: [] });
    if (url.pathname === '/v1/account/release_report/config') {
      if (req.method === 'POST') {
        // Refuses the long column list once, like a real account might, and takes the short one.
        if (JSON.parse(raw).columns.length > 3) return send(400, { message: 'invalid columns', error: 'bad_request', cause: [{ description: 'column X is not valid' }] });
        releaseConfigured = true;
        return send(201, {});
      }
      return releaseConfigured ? send(200, {}) : send(404, { message: 'not_found' });
    }
    if (url.pathname === '/v1/account/settlement_report' && req.method === 'POST') return send(202, {});
    return send(404, { message: 'not_found' });
  });
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfd-mp-'));
let app: FastifyInstance;
const cookies: Record<string, string> = {};
let lib: typeof import('../src/lib/mercadopago.js');
let coreDb: typeof import('../src/db/index.js').coreDb;

const raw = (r: { raw: string }) => r.raw;

async function call(who: 'ivan' | 'mili', method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { cookie: cookies[who] } });
  return { status: res.statusCode, body: res.json(), raw: res.body, headers: res.headers };
}

beforeAll(async () => {
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  delete process.env.SECRET_KEY;
  Object.assign(process.env, { MP_API_URL: `http://127.0.0.1:${(fake.address() as net.AddressInfo).port}`, DATA_DIR: dataDir });
  const dbm = await import('../src/db/index.js');
  const { buildApp } = await import('../src/app.js');
  lib = await import('../src/lib/mercadopago.js');
  coreDb = dbm.coreDb;
  dbm.setDb(dbm.openDb(':memory:'));
  app = await buildApp();
  let r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ivan', display_name: 'Iván', password: 'contraseña-larga' } });
  cookies.ivan = r.headers['set-cookie']!.toString().split(';')[0];
  await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'mili', display_name: 'Milagros', password: 'otra-contraseña' }, headers: { cookie: cookies.ivan } });
  r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mili', password: 'otra-contraseña' } });
  cookies.mili = r.headers['set-cookie']!.toString().split(';')[0];
});

afterAll(() => {
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Mercado Pago connection', () => {
  it('starts disconnected', async () => {
    expect((await call('ivan', 'GET', '/api/me/mercadopago')).body).toEqual({ connected: false });
  });

  it('rejects test, malformed and refused tokens without echoing them', async () => {
    const test = await call('ivan', 'PUT', '/api/me/mercadopago', { access_token: 'TEST-1234567890-abcdef' });
    expect(test.status).toBe(400);
    expect(test.body.fields).toEqual(['access_token']);
    expect(test.raw).not.toContain('TEST-1234567890');
    expect((await call('ivan', 'PUT', '/api/me/mercadopago', { access_token: 'hola' })).status).toBe(400);
    const wrong = `APP_USR-9999999999999999-102716-${'cd34'.repeat(8)}-987654321`;
    const refused = await call('ivan', 'PUT', '/api/me/mercadopago', { access_token: wrong });
    expect(refused.status).toBe(400);
    expect(refused.raw).not.toContain(wrong.slice(9, 25));
    expect((await call('ivan', 'GET', '/api/me/mercadopago')).body.connected).toBe(false);
  });

  it('connects after Mercado Pago confirms the token, and never shows it again', async () => {
    const r = await call('ivan', 'PUT', '/api/me/mercadopago', { access_token: `  ${TOKEN}  `, history_start: '2024-01-01' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connected: true, mp_user_id: 123456789, nickname: 'IVAN.TEST', site_id: 'MLA', history_start: '2024-01-01', readable: true });
    expect(r.headers['cache-control']).toBe('no-store');
    const view = (await call('ivan', 'GET', '/api/me/mercadopago')).raw;
    for (const part of [TOKEN, TOKEN.slice(9, 25), 'ab12ab12']) expect(view).not.toContain(part);
    expect(view).not.toContain('ivan@example.com');
    // Stored only encrypted.
    const stored = coreDb().prepare('SELECT token_enc FROM mp_connections').get() as { token_enc: string };
    expect(stored.token_enc.startsWith('v1:')).toBe(true);
    expect(stored.token_enc).not.toContain('APP_USR');
  });

  it('keeps the key outside the database, readable only by the server', () => {
    const file = path.join(dataDir, 'secret.key');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("is per person: the partner sees nothing of it", async () => {
    expect((await call('mili', 'GET', '/api/me/mercadopago')).body).toEqual({ connected: false });
    expect((await call('mili', 'POST', '/api/me/mercadopago/check')).status).toBe(400);
  });

  it("a token copied onto another person's row can't be read", async () => {
    const mili = (coreDb().prepare("SELECT id FROM users WHERE username = 'mili'").get() as { id: number }).id;
    coreDb()
      .prepare("INSERT INTO mp_connections (user_id, token_enc, connected_at) SELECT ?, token_enc, connected_at FROM mp_connections WHERE user_id <> ?")
      .run(mili, mili);
    expect((await call('mili', 'GET', '/api/me/mercadopago')).body).toMatchObject({ connected: true, readable: false });
    expect(lib.storedToken(mili)).toBeNull();
    expect((await call('mili', 'DELETE', '/api/me/mercadopago')).body).toEqual({ connected: false });
  });

  it('checks which sources work, only with GET requests, at most every 30 s', async () => {
    seen.length = 0;
    const r = await call('ivan', 'POST', '/api/me/mercadopago/check');
    expect(r.status).toBe(200);
    expect(Object.fromEntries(r.body.checks.map((c: { key: string; status: string }) => [c.key, c.status]))).toEqual({
      identity: 'ok',
      payments: 'ok',
      balance: 'unavailable',
      release_report: 'unconfigured',
      settlement_report: 'ok',
    });
    expect(r.body.checked_at).toBeTruthy();
    expect(seen.every((s) => s.method === 'GET')).toBe(true);
    expect((await call('ivan', 'POST', '/api/me/mercadopago/check')).status).toBe(429);
  });

  it('sets up only the reports that have no settings, with the approved writes', async () => {
    // Connecting again resets the 30 s turn.
    await call('ivan', 'PUT', '/api/me/mercadopago', { access_token: TOKEN });
    seen.length = 0;
    const r = await call('ivan', 'POST', '/api/me/mercadopago/reports');
    expect(r.status).toBe(200);
    expect(r.body.setup).toEqual([
      { key: 'release_report', result: 'created', http: 201, tier: 1 },
      { key: 'settlement_report', result: 'exists', http: 200 },
    ]);
    expect(r.body.checks.find((c: { key: string }) => c.key === 'release_report').status).toBe('ok');
    const writes = seen.filter((x) => x.method !== 'GET');
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /v1/account/release_report/config', 'POST /v1/account/release_report/config']);
    expect(writes[0].body).toMatchObject({ display_timezone: 'GMT-03', include_withdrawal_at_end: true, execute_after_withdrawal: false });
    expect(writes[0].body).not.toHaveProperty('header_language');
    expect((writes[1].body as { columns: { key: string }[] }).columns.map((c) => c.key)).toEqual(['DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE']);
    expect(raw(r)).not.toContain('ab12ab12');
    expect((await call('ivan', 'POST', '/api/me/mercadopago/reports')).status).toBe(429);
  });

  it("passes on Mercado Pago's reason when it refuses both attempts", async () => {
    // The fake refuses any other token (401 with a message) on every call.
    const r = await lib.setupReports(`APP_USR-0000000000000000-102716-${'ff00'.repeat(8)}-111111111`);
    expect(r[0]).toEqual({ key: 'release_report', result: 'failed', http: 401, message: 'invalid access token' });
  });

  it('sends the documented settings for the transactions report', () => {
    const c = lib.reportConfig('settlement_report') as Record<string, unknown> & { columns: { key: string }[] };
    expect(c).toMatchObject({ include_withdraw: true, header_language: 'en', display_timezone: 'GMT-03', frequency: { type: 'monthly' } });
    expect(c.columns.map((x) => x.key)).toContain('TRANSACTION_DATE');
    expect(c.columns.map((x) => x.key)).not.toContain('DATE');
    expect((lib.reportConfig('settlement_report', 2).columns as { key: string }[]).map((x) => x.key)).toEqual(['TRANSACTION_DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE']);
  });

  it('allows no write except report settings and report requests', async () => {
    const r = await lib.requestReport(TOKEN, 'settlement_report', '2026-10-01T03:00:00Z', '2026-10-08T02:59:59Z');
    expect(r.status).toBe(202);
    expect(seen.at(-1)).toMatchObject({ method: 'POST', path: '/v1/account/settlement_report', body: { begin_date: '2026-10-01T03:00:00Z' } });
    for (const [method, path] of [
      ['POST', '/v1/payments'],
      ['POST', '/v1/payments/123/refunds'],
      ['PUT', '/v1/payments/123'],
      ['POST', '/checkout/preferences'],
      ['POST', '/v1/account/release_report/schedule'],
      ['PUT', '/v1/account/settlement_report'],
      ['POST', '/v1/account/release_report/config?x=1'],
    ] as const)
      await expect(lib.mpWrite(TOKEN, method, path, {})).rejects.toThrow(/not allowed/);
  });

  it('refuses any path outside the read-only list', async () => {
    await expect(lib.mpGet(TOKEN, '/v1/payments')).rejects.toThrow(/not allowed/);
    await expect(lib.mpGet(TOKEN, '/v1/payments/123/refunds')).rejects.toThrow(/not allowed/);
    await expect(lib.mpGet(TOKEN, '/checkout/preferences')).rejects.toThrow(/not allowed/);
  });

  it('changes the start date, not in the future', async () => {
    expect((await call('ivan', 'PUT', '/api/me/mercadopago', { history_start: '2025-03-01' })).body.history_start).toBe('2025-03-01');
    expect((await call('ivan', 'PUT', '/api/me/mercadopago', { history_start: '2999-01-01' })).status).toBe(400);
    expect((await call('mili', 'PUT', '/api/me/mercadopago', { history_start: '2025-03-01' })).status).toBe(404);
  });

  it('disconnects, deleting the token', async () => {
    expect((await call('ivan', 'DELETE', '/api/me/mercadopago')).body).toEqual({ connected: false });
    expect(coreDb().prepare('SELECT COUNT(*) AS n FROM mp_connections').get()).toEqual({ n: 0 });
  });
});
