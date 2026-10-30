import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// A local stand-in for Google (OAuth and the Gmail API). It knows one authorization code and one
// refresh token, and records every request so the tests can prove nothing but reads reach Gmail.
const CODE = 'auth-code-1';
const REFRESH = 'refresh-token-secret-1';
const ACCESS = 'access-token-1';
const seen: { method: string; path: string; query: string; body: string }[] = [];
let refreshValid = true;

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
// Each "PDF" stands in for its text (pdftotext is mocked below).
const MESSAGES: Record<string, { internalDate: string; payload: object }> = {
  m1: {
    internalDate: String(Date.parse('2026-10-28T12:00:00Z')),
    payload: { mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/html', body: { data: b64url('<p>Hola</p>') } }, { filename: 'ResumenDeCuenta_2026-11-10.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a1' } }] },
  },
  m2: { internalDate: String(Date.parse('2026-10-20T12:00:00Z')), payload: { parts: [{ filename: 'promo.pdf', mimeType: 'application/pdf', body: { data: b64url('%PDF-promo') } }] } },
  m3: { internalDate: String(Date.parse('2026-10-21T12:00:00Z')), payload: { parts: [{ filename: 'roto.pdf', mimeType: 'application/pdf', body: { data: b64url('%PDF-broken') } }] } },
};
let inbox = ['m1', 'm2', 'm3'];

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url!, 'http://x');
    seen.push({ method: req.method!, path: url.pathname, query: url.search, body: raw });
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/token') {
      const p = new URLSearchParams(raw);
      if (p.get('client_secret') !== 'client-secret') return send(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === CODE)
        return send(200, { access_token: ACCESS, refresh_token: REFRESH, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === REFRESH && refreshValid) return send(200, { access_token: ACCESS });
      return send(400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/revoke') return send(200, {});
    if (req.headers.authorization !== `Bearer ${ACCESS}`) return send(401, { error: { code: 401 } });
    if (url.pathname === '/gmail/v1/users/me/profile') return send(200, { emailAddress: 'ivan@example.com' });
    if (url.pathname === '/gmail/v1/users/me/messages') return send(200, { messages: inbox.map((id) => ({ id })) });
    const m = /^\/gmail\/v1\/users\/me\/messages\/(\w+)(?:\/attachments\/(\w+))?$/.exec(url.pathname);
    if (m && m[2]) return send(200, { data: b64url('%PDF-naranjax') });
    if (m && MESSAGES[m[1]!]) return send(200, { id: m[1], ...MESSAGES[m[1]!] });
    return send(404, {});
  });
});

const fixture = fs.readFileSync(new URL('./statements/fixtures/naranjax.layout.txt', import.meta.url), 'utf8');
let brokenText = 'TARJETA NARANJA S.A.U. Tu total a pagar es (sin monto)';
vi.mock('../src/lib/statements/pdf-text.js', () => ({
  extractPdfText: async (data: Uint8Array) => {
    const key = Buffer.from(data).toString().replace('%PDF-', '');
    if (key === 'naranjax') return fixture;
    if (key === 'broken') return brokenText;
    return 'Una promoción cualquiera';
  },
}));

let app: FastifyInstance;
const cookies: Record<string, string> = {};
let coreDb: typeof import('../src/db/index.js').coreDb;
let db: typeof import('../src/db/index.js').db;
let card = 0;

async function call(who: 'ivan' | 'mili', method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { cookie: cookies[who] } });
  return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body, headers: res.headers };
}

beforeAll(async () => {
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(fake.address() as net.AddressInfo).port}`;
  delete process.env.SECRET_KEY;
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_AUTH_URL: `${base}/auth`,
    GOOGLE_TOKEN_URL: `${base}/token`,
    GOOGLE_REVOKE_URL: `${base}/revoke`,
    GMAIL_API_URL: base,
  });
  const dbm = await import('../src/db/index.js');
  const { buildApp } = await import('../src/app.js');
  coreDb = dbm.coreDb;
  db = dbm.db;
  dbm.setDb(dbm.openDb(':memory:'));
  app = await buildApp();
  let r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ivan', display_name: 'Iván', password: 'contraseña-larga' } });
  cookies.ivan = r.headers['set-cookie']!.toString().split(';')[0]!;
  await app.inject({ method: 'POST', url: '/api/users', payload: { username: 'mili', display_name: 'Milagros', password: 'otra-contraseña' }, headers: { cookie: cookies.ivan } });
  r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mili', password: 'otra-contraseña' } });
  cookies.mili = r.headers['set-cookie']!.toString().split(';')[0]!;
  card = (await call('ivan', 'POST', '/api/accounts', { name: 'Naranja X', type: 'credit_card', currency: 'ARS', owner: 'me' })).body.id;
});

afterAll(() => {
  fake.close();
});

describe('Gmail connection', () => {
  it('starts disconnected, with the callback address to register in Google', async () => {
    const r = await call('ivan', 'GET', '/api/me/gmail');
    expect(r.body).toMatchObject({ configured: true, connected: false, email: null, sync: { on: false } });
    expect(r.body.redirect_uri).toMatch(/\/api\/me\/gmail\/callback$/);
  });

  it('sends the person to Google asking for read-only access', async () => {
    const { url } = (await call('ivan', 'POST', '/api/me/gmail/connect')).body;
    const u = new URL(url);
    expect(u.pathname).toBe('/auth');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: 'client-id',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      access_type: 'offline',
      response_type: 'code',
    });
    expect(u.searchParams.get('state')!.length).toBeGreaterThan(20);
  });

  it("refuses another person's or an unknown state", async () => {
    const { url } = (await call('ivan', 'POST', '/api/me/gmail/connect')).body;
    const state = new URL(url).searchParams.get('state')!;
    const r = await call('mili', 'GET', `/api/me/gmail/callback?code=${CODE}&state=${state}`);
    expect(r.headers.location).toBe('/ajustes?tab=gmail&gmail=error');
    expect((await call('mili', 'GET', '/api/me/gmail')).body.connected).toBe(false);
  });

  it('stores the refresh token only encrypted and never returns it', async () => {
    const { url } = (await call('ivan', 'POST', '/api/me/gmail/connect')).body;
    const state = new URL(url).searchParams.get('state')!;
    const r = await call('ivan', 'GET', `/api/me/gmail/callback?code=${CODE}&state=${state}`);
    expect(r.headers.location).toBe('/ajustes?tab=gmail&gmail=ok');
    const view = await call('ivan', 'GET', '/api/me/gmail');
    expect(view.body).toMatchObject({ connected: true, email: 'ivan@example.com' });
    expect(view.raw).not.toContain(REFRESH);
    const row = coreDb().prepare('SELECT token_enc FROM gmail_connections WHERE user_id = 1').get() as { token_enc: string };
    expect(row.token_enc).not.toContain(REFRESH);
    // A state is good for one use only.
    expect((await call('ivan', 'GET', `/api/me/gmail/callback?code=${CODE}&state=${state}`)).headers.location).toContain('gmail=error');
  });

  it('says when the person said no on Google', async () => {
    expect((await call('ivan', 'GET', '/api/me/gmail/callback?error=access_denied')).headers.location).toBe('/ajustes?tab=gmail&gmail=denied');
  });
});

describe('Fetching statements', () => {
  it("doesn't look before it is turned on in the profile", async () => {
    const r = await call('ivan', 'POST', '/api/me/gmail/fetch');
    expect(r.status).toBe(400);
  });

  it('turns on, searches the senders of the known formats and keeps what it recognises', async () => {
    const r = await call('ivan', 'PUT', '/api/me/gmail/sync', { since: '2026-08-01' });
    expect(r.body.sync).toMatchObject({ on: true, since: '2026-08-01', error: null });
    const search = seen.find((s) => s.path === '/gmail/v1/users/me/messages')!;
    expect(new URLSearchParams(search.query).get('q')).toBe('(from:naranjax.com has:attachment filename:pdf) after:2026/08/01');

    const list = (await call('ivan', 'GET', '/api/mail-statements')).body;
    expect(list.on).toBe(true);
    expect(list.items.map((i: { file_name: string; status: string }) => [i.file_name, i.status])).toEqual([
      ['ResumenDeCuenta_2026-11-10.pdf', 'pending'],
      ['roto.pdf', 'failed'],
    ]);
    expect(list.items[0]).toMatchObject({
      title: 'Naranja X · Tarjetas de crédito',
      integrity_ok: true,
      summary: { kind: 'card', issuer: 'naranjax', dueDate: '2026-11-10', totalDue: { ars: 11874888, usd: 0 } },
    });
    // The promo PDF is remembered without its contents.
    const promo = db().prepare(`SELECT status, data FROM mail_statements WHERE file_name = 'promo.pdf'`).get() as { status: string; data: Buffer | null };
    expect(promo).toEqual({ status: 'unrecognised', data: null });
  });

  it('tells the person in the bell', async () => {
    const bell = db().prepare(`SELECT user_id, title, body, link FROM notifications WHERE title LIKE 'Llegó el resumen%'`).all();
    expect(bell).toEqual([{ user_id: 1, title: 'Llegó el resumen de Naranja X', body: expect.stringContaining('vence el 10/11'), link: '/resumenes' }]);
  });

  it('only ever reads from Gmail', async () => {
    const gmail = seen.filter((s) => s.path.startsWith('/gmail/'));
    expect(gmail.length).toBeGreaterThan(0);
    expect(gmail.every((s) => s.method === 'GET')).toBe(true);
  });

  it('never downloads the same email twice, and retries the ones it could not read', async () => {
    brokenText = fixture.replace('10000001', '10000002');
    const before = seen.filter((s) => /\/messages\/\w+/.test(s.path)).length;
    // Past the 30 s turn of the manual search: go through the library directly.
    const { fetchStatements } = await import('../src/lib/mail-statements.js');
    const found = await fetchStatements(1);
    expect(found).toEqual({ added: 0, recognised: 0 });
    expect(seen.filter((s) => /\/messages\/\w+/.test(s.path)).length).toBe(before);
    const items = (await call('ivan', 'GET', '/api/mail-statements')).body.items as { file_name: string; status: string }[];
    expect(items.find((i) => i.file_name === 'roto.pdf')?.status).toBe('pending');
  });

  it("keeps each person's statements to themselves", async () => {
    const mine = (await call('ivan', 'GET', '/api/mail-statements')).body.items[0];
    expect((await call('mili', 'GET', '/api/mail-statements')).body.items).toEqual([]);
    expect((await call('mili', 'POST', `/api/mail-statements/${mine.id}/open`)).status).toBe(404);
  });
});

describe('Importing a received statement', () => {
  let id = 0;
  it('opens it in the wizard like an upload', async () => {
    id = (await call('ivan', 'GET', '/api/mail-statements')).body.items.find((i: { file_name: string }) => i.file_name === 'ResumenDeCuenta_2026-11-10.pdf').id;
    const opened = (await call('ivan', 'POST', `/api/mail-statements/${id}/open`)).body;
    expect(opened).toMatchObject({ file_name: 'ResumenDeCuenta_2026-11-10.pdf', account_id: null });
    const detected = await call('ivan', 'POST', '/api/statements/detect', { upload_id: opened.upload_id });
    expect(detected.body.reader.id).toBe('naranjax-card');
    const preview = (await call('ivan', 'POST', '/api/statements/preview', { upload_id: opened.upload_id, account_id: card })).body;
    const rows = preview.items.filter((i: { include: boolean }) => i.include);
    const commit = (await call('ivan', 'POST', '/api/imports/commit', { file_name: opened.file_name, account_id: card, preset_id: null, rows })).body;
    expect(commit.imported).toBe(10);
    expect((await call('ivan', 'POST', `/api/mail-statements/${id}/imported`, { account_id: card, batch_id: commit.batch_id })).status).toBe(200);
  });

  it('proposes the same account next time', async () => {
    const other = (await call('ivan', 'GET', '/api/mail-statements')).body.items.find((i: { status: string }) => i.status === 'pending');
    expect((await call('ivan', 'POST', `/api/mail-statements/${other.id}/open`)).body.account_id).toBe(card);
  });

  it('drops the file of a discarded statement', async () => {
    const other = (await call('ivan', 'GET', '/api/mail-statements')).body.items.find((i: { status: string }) => i.status === 'pending');
    expect((await call('ivan', 'POST', `/api/mail-statements/${other.id}/dismiss`)).status).toBe(200);
    expect(db().prepare('SELECT status, data FROM mail_statements WHERE id = ?').get(other.id)).toEqual({ status: 'dismissed', data: null });
    expect((await call('ivan', 'GET', '/api/mail-statements')).body.items.map((i: { status: string }) => i.status)).toEqual(['imported']);
  });
});

describe('Losing access', () => {
  it('shows the error when Google no longer accepts the grant', async () => {
    refreshValid = false;
    inbox = [];
    const { fetchStatements } = await import('../src/lib/mail-statements.js');
    await expect(fetchStatements(1)).rejects.toThrow(/Conectá Gmail de nuevo/);
    expect((await call('ivan', 'GET', '/api/me/gmail')).body).toMatchObject({ connected: true, error: expect.stringMatching(/Conectá Gmail/), sync: { error: expect.stringMatching(/Conectá Gmail/) } });
  });

  it('disconnects, revoking the token with Google', async () => {
    const r = await call('ivan', 'DELETE', '/api/me/gmail');
    expect(r.body.connected).toBe(false);
    expect(seen.at(-1)).toMatchObject({ method: 'POST', path: '/revoke' });
    expect(coreDb().prepare('SELECT 1 FROM gmail_connections').get()).toBeUndefined();
  });
});
