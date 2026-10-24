import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db, openDb, setDb } from '../src/db/index.js';
import { addDays, today } from '../src/lib/dates.js';
import { setMpClientFactory, type MpClient, type MpPayment } from '../src/lib/mercadopago/client.js';
import { parseSettlementReport } from '../src/lib/mercadopago/report.js';
import { drainWebhookEvents, reportCycle } from '../src/lib/mercadopago/sync.js';
import { connectionForUser } from '../src/lib/mercadopago/ingest.js';

// A fake Mercado Pago: one account per access token.
type FakeAccount = { id: string; payments: Map<string, Record<string, unknown>>; balance: unknown; reports: Map<string, string>; configured: boolean };
const accountsByToken = new Map<string, FakeAccount>();
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function fakeClient(token: string): MpClient {
  const acc = accountsByToken.get(token);
  return {
    getMe: async () => {
      if (!acc) throw httpError(401);
      return { id: acc.id, nickname: `NICK${acc.id}`, site_id: 'MLA' };
    },
    getPayment: async (id) => {
      const p = acc?.payments.get(id);
      if (!p) throw httpError(404);
      return p as MpPayment;
    },
    async *searchPayments(options) {
      for (const p of acc?.payments.values() ?? []) {
        // The default search returns money in; payer.id narrows it to money out.
        const wanted = options['payer.id'] ? (p.payer as { id: string }).id === options['payer.id'] : String(p.collector_id) === acc!.id;
        if (wanted) yield p as MpPayment;
      }
    },
    getBalance: async () => acc?.balance,
    settlementReport: {
      getConfig: async () => {
        if (!acc!.configured) throw httpError(404);
        return {};
      },
      createConfig: async () => {
        acc!.configured = true;
        return {};
      },
      create: async () => ({}),
      list: async () => [...acc!.reports.keys()].map((file_name) => ({ file_name })),
      download: async (f) => acc!.reports.get(f)!,
    },
  };
}

const ANA_TOKEN = 'APP_USR-ana-0000';
const BETO_TOKEN = 'APP_USR-beto-0000';
const SECRET = 'ana-webhook-secret';
const D = today();
const START = addDays(D, -10);

function payment(id: string, o: Record<string, unknown> = {}) {
  return {
    id: Number(id),
    status: 'approved',
    status_detail: 'accredited',
    payment_type_id: 'account_money',
    currency_id: 'ARS',
    description: 'Transferencia recibida',
    transaction_amount: 1500,
    fee_details: [],
    collector_id: 1001,
    payer: { id: '9999', email: 'amigo@example.com' },
    date_created: `${D}T12:00:00.000-03:00`,
    date_approved: `${D}T12:00:01.000-03:00`,
    date_last_updated: `${D}T12:00:02.000-03:00`,
    ...o,
  };
}

let app: FastifyInstance;
const cookies: Record<string, string> = {};
async function call(who: 'ana' | 'beto' | null, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { ...(who ? { cookie: cookies[who] } : {}), ...headers } });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body, raw: res.body };
}
const ana = () => accountsByToken.get(ANA_TOKEN)!;
const movement = (externalId: string) =>
  db().prepare(`SELECT * FROM mp_movements WHERE external_id = ?`).get(externalId) as { tx_state: string; transaction_id: number | null; fee_transaction_id: number | null; note: string | null };
const tx = (id: number | null) => (id == null ? undefined : (db().prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<string, any> | undefined));
const sync = async (who: 'ana' | 'beto' = 'ana') => (await call(who, 'POST', '/api/mp/connection/sync')).body;

beforeAll(async () => {
  setDb(openDb(':memory:'));
  setMpClientFactory(fakeClient);
  app = await buildApp();
  accountsByToken.set(ANA_TOKEN, { id: '1001', payments: new Map(), balance: { available_balance: 100, unavailable_balance: 15, total_amount: 115, currency_id: 'ARS' }, reports: new Map(), configured: false });
  accountsByToken.set(BETO_TOKEN, { id: '2002', payments: new Map(), balance: {}, reports: new Map(), configured: true });

  let r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'ana', display_name: 'Ana', password: 'contraseña-larga' } });
  cookies.ana = r.headers['set-cookie']!.toString().split(';')[0];
  await call('ana', 'POST', '/api/users', { username: 'beto', display_name: 'Beto', password: 'otra-contraseña' });
  r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'beto', password: 'otra-contraseña' } });
  cookies.beto = r.headers['set-cookie']!.toString().split(';')[0];
});

afterAll(() => setMpClientFactory(null));

describe('connecting an account', () => {
  it('rejects a token Mercado Pago does not accept', async () => {
    const r = await call('ana', 'POST', '/api/mp/connection', { access_token: 'APP_USR-unknown', sync_from: START });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/rechazó el access token/);
  });

  it('connects, creates the wallet account and stores the token encrypted', async () => {
    const r = await call('ana', 'POST', '/api/mp/connection', { access_token: ANA_TOKEN, sync_from: START, webhook_secret: SECRET });
    expect(r.status).toBe(200);
    expect(r.body.nickname).toBe('NICK1001');
    const acct = db().prepare('SELECT * FROM accounts WHERE id = ?').get(r.body.account_id) as { type: string; owner_id: number; currency: string };
    expect(acct).toMatchObject({ type: 'wallet', owner_id: 1, currency: 'ARS' });
    const conn = connectionForUser(1)!;
    expect(conn.access_token_enc).not.toContain(ANA_TOKEN);
    expect(conn.webhook_secret_enc).not.toContain(SECRET);
  });

  it('refuses the same Mercado Pago account for the partner', async () => {
    expect((await call('beto', 'POST', '/api/mp/connection', { access_token: ANA_TOKEN, sync_from: START })).status).toBe(409);
    expect((await call('beto', 'POST', '/api/mp/connection', { access_token: BETO_TOKEN, sync_from: START })).status).toBe(200);
  });

  it('never returns tokens, and shows webhook details only to the owner', async () => {
    const asBeto = await call('beto', 'GET', '/api/mp/connections');
    expect(asBeto.raw).not.toContain('APP_USR');
    const anaRow = asBeto.body.find((c: { user_id: number }) => c.user_id === 1);
    expect(anaRow.connected).toBe(true);
    expect(anaRow.webhook).toBeNull();
    const own = (await call('ana', 'GET', '/api/mp/connections')).body.find((c: { user_id: number }) => c.user_id === 1);
    expect(own.webhook.url).toMatch(/\/api\/mp\/webhook\/[\w-]{20,}$/);
    expect(own.webhook.has_secret).toBe(true);
  });
});

describe('payments become transactions', () => {
  it('adds an approved incoming payment, with its fee as a separate expense', async () => {
    ana().payments.set('11', payment('11', { fee_details: [{ type: 'mercadopago_fee', amount: 45, fee_payer: 'collector' }] }));
    const r = await sync();
    expect(r.inserted).toBeGreaterThanOrEqual(1);
    const mv = movement('11');
    expect(mv.tx_state).toBe('created');
    expect(tx(mv.transaction_id)).toMatchObject({ type: 'income', status: 'confirmed', amount: 1500_00, date: D });
    expect(tx(mv.fee_transaction_id)).toMatchObject({ type: 'expense', amount: 45_00 });
  });

  it('applies rules to categorise', async () => {
    const cat = db().prepare(`SELECT id FROM categories WHERE name = 'Delivery'`).get() as { id: number };
    await call('ana', 'POST', '/api/rules', { name: 'Rappi', match_type: 'contains', pattern: 'rappi', set_category_id: cat.id });
    ana().payments.set('12', payment('12', { description: 'RAPPI pedido', collector_id: 5555, payer: { id: '1001' }, transaction_amount: 8000 }));
    await sync();
    const mv = movement('12');
    expect(tx(mv.transaction_id)).toMatchObject({ type: 'expense', status: 'confirmed', amount: 8000_00, category_id: cat.id });
    expect(mv.note).toBe('Regla: Rappi.');
  });

  it('adds card-funded payments as pending, since they do not move the wallet balance', async () => {
    ana().payments.set('13', payment('13', { collector_id: 5555, payer: { id: '1001' }, payment_type_id: 'credit_card', payment_method_id: 'visa' }));
    await sync();
    const t = tx(movement('13').transaction_id)!;
    expect(t.status).toBe('pending');
    expect(t.notes).toMatch(/credit_card/);
  });

  it('is idempotent across repeated syncs', async () => {
    const before = (db().prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;
    await sync();
    await sync();
    expect((db().prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(before);
  });

  it('links to a transaction that was already in the app instead of duplicating it', async () => {
    const conn = connectionForUser(1)!;
    const manual = await call('ana', 'POST', '/api/transactions', { type: 'expense', date: D, amount: 2222_00, account_id: conn.account_id, description: 'Cargado a mano' });
    ana().payments.set('14', payment('14', { collector_id: 5555, payer: { id: '1001' }, transaction_amount: 2222 }));
    await sync();
    const mv = movement('14');
    expect(mv.tx_state).toBe('matched');
    expect(mv.transaction_id).toBe(manual.body.id);
  });

  it('removes the transaction when the payment is refunded, and ignores older updates', async () => {
    const id = movement('11').transaction_id;
    ana().payments.set('11', payment('11', { status: 'refunded', date_last_updated: `${D}T13:00:00.000-03:00` }));
    await sync();
    expect(movement('11').tx_state).toBe('reversed');
    expect(tx(id)).toBeUndefined();
    // A late, older "approved" must not bring it back.
    ana().payments.set('11', payment('11', { date_last_updated: `${D}T12:30:00.000-03:00` }));
    await sync();
    expect(movement('11').tx_state).toBe('reversed');
  });

  it('does not recreate transactions removed with Importar > Deshacer', async () => {
    ana().payments.set('15', payment('15', { transaction_amount: 777 }));
    await sync();
    const t = tx(movement('15').transaction_id)!;
    expect((await call('ana', 'DELETE', `/api/imports/${t.import_batch_id}`)).status).toBe(200);
    await sync();
    expect(movement('15').tx_state).toBe('created');
    expect(movement('15').transaction_id).toBeNull();
    expect(db().prepare(`SELECT COUNT(*) AS n FROM transactions WHERE import_hash LIKE 'mp:%:15'`).get()).toEqual({ n: 0 });
  });

  it('skips payments before the chosen start date', async () => {
    ana().payments.set('16', payment('16', { date_approved: `${addDays(START, -3)}T12:00:00.000-03:00` }));
    await sync();
    expect(movement('16').tx_state).toBe('skipped');
  });
});

describe('webhooks', () => {
  const key = () => connectionForUser(1)!.webhook_key;
  const sign = (dataId: string, requestId: string, ts = String(Date.now()), secret = SECRET) =>
    `ts=${ts},v1=${crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}`;
  const deliver = (dataId: string, notificationId: number, signature?: string) => {
    const requestId = crypto.randomUUID();
    return call(null, 'POST', `/api/mp/webhook/${key()}?data.id=${dataId}&type=payment`,
      { id: notificationId, type: 'payment', action: 'payment.created', live_mode: true, data: { id: dataId } },
      { 'x-request-id': requestId, 'x-signature': signature ?? sign(dataId, requestId) });
  };

  it('accepts a signed notification without a session and processes the payment', async () => {
    ana().payments.set('21', payment('21', { transaction_amount: 321 }));
    const r = await deliver('21', 9001);
    expect(r.status).toBe(200);
    await drainWebhookEvents();
    expect(movement('21').tx_state).toBe('created');
    expect(db().prepare(`SELECT status FROM mp_webhook_events WHERE dedupe_key = ?`).get(`n:${connectionForUser(1)!.id}:9001`)).toEqual({ status: 'processed' });
  });

  it('rejects a bad signature and unknown keys', async () => {
    expect((await deliver('21', 9002, `ts=${Date.now()},v1=${'0'.repeat(64)}`)).status).toBe(401);
    expect((await call(null, 'POST', '/api/mp/webhook/nope?data.id=1', { data: { id: '1' } })).status).toBe(404);
  });

  it('rejects a replayed old notification', async () => {
    const requestId = crypto.randomUUID();
    const old = String(Date.now() - 3600_000);
    const r = await call(null, 'POST', `/api/mp/webhook/${key()}?data.id=21&type=payment`, { id: 9003, type: 'payment', data: { id: '21' } }, { 'x-request-id': requestId, 'x-signature': sign('21', requestId, old) });
    expect(r.status).toBe(401);
  });

  it('counts re-deliveries of the same notification once', async () => {
    await deliver('21', 9004);
    await deliver('21', 9004);
    await drainWebhookEvents();
    expect(db().prepare(`SELECT deliveries FROM mp_webhook_events WHERE dedupe_key = ?`).get(`n:${connectionForUser(1)!.id}:9004`)).toEqual({ deliveries: 2 });
  });

  it('marks notifications for unknown payments (panel simulations) as ignored', async () => {
    await deliver('123456', 9005);
    await drainWebhookEvents();
    expect(db().prepare(`SELECT status FROM mp_webhook_events WHERE dedupe_key = ?`).get(`n:${connectionForUser(1)!.id}:9005`)).toEqual({ status: 'ignored' });
  });

  it('refuses notifications for a connection without a webhook secret', async () => {
    const betoKey = connectionForUser(2)!.webhook_key;
    expect((await call(null, 'POST', `/api/mp/webhook/${betoKey}?data.id=1`, { data: { id: '1' } })).status).toBe(401);
  });
});

describe('account money report and balance', () => {
  const csv = [
    'TRANSACTION_DATE,SOURCE_ID,TRANSACTION_TYPE,PAYMENT_METHOD_TYPE,TRANSACTION_AMOUNT,SETTLEMENT_NET_AMOUNT,SETTLEMENT_CURRENCY',
    `${D}T12:00:01.000-03:00,12,SETTLEMENT,account_money,-8000.00,-8000.00,ARS`,
    `${D}T03:00:00.000-03:00,,INVESTMENT_YIELD,,52.31,52.31,ARS`,
    `${D}T03:00:00.000-03:00,,,,,,`,
  ].join('\n');

  it('parses known columns', () => {
    const r = parseSettlementReport(csv);
    expect(r.unreadable).toBeNull();
    expect(r.movements.map((m) => [m.payment_ref, m.amount])).toEqual([['12', -8000_00], [null, 52_31]]);
    expect(parseSettlementReport('A,B\n1,2').unreadable).toMatch(/Columnas no reconocidas/);
  });

  it('creates the report config, matches lines to payments and adds the rest as pending', async () => {
    ana().reports.set('finanzas-dinero-en-cuenta-1.csv', csv);
    await reportCycle(connectionForUser(1)!);
    expect(ana().configured).toBe(true);
    const rows = db().prepare(`SELECT payment_ref, tx_state, transaction_id FROM mp_movements WHERE source = 'report' ORDER BY id`).all() as { payment_ref: string | null; tx_state: string; transaction_id: number | null }[];
    expect(rows.map((r) => r.tx_state)).toEqual(['matched', 'created']);
    expect(tx(rows[1].transaction_id)).toMatchObject({ type: 'income', status: 'pending', amount: 52_31 });
    // Re-running does not import the same file again.
    await reportCycle(connectionForUser(1)!);
    expect(db().prepare(`SELECT COUNT(*) AS n FROM mp_movements WHERE source = 'report'`).get()).toEqual({ n: 2 });
  });

  it('reports the Mercado Pago balance next to the app balance', async () => {
    await sync();
    const own = (await call('ana', 'GET', '/api/mp/connections')).body.find((c: { user_id: number }) => c.user_id === 1);
    expect(own.balance).toMatchObject({ available: 100_00, unavailable: 15_00, total: 115_00 });
    expect(own.balance_drift).toBe(115_00 - own.app_balance);
  });

  it('keeps transactions when disconnecting', async () => {
    const before = (db().prepare(`SELECT COUNT(*) AS n FROM transactions WHERE import_hash LIKE 'mp:%'`).get() as { n: number }).n;
    expect((await call('ana', 'DELETE', '/api/mp/connection')).status).toBe(200);
    expect(connectionForUser(1)).toBeUndefined();
    expect((db().prepare(`SELECT COUNT(*) AS n FROM transactions WHERE import_hash LIKE 'mp:%'`).get() as { n: number }).n).toBe(before);
  });
});
