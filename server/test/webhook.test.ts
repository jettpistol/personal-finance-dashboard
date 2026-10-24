import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { drainPending } from '../src/webhooks/processor.js';
import { payment, randomUUID, setup, sign } from './helpers.js';

function notification(dataId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    live_mode: false,
    type: 'payment',
    date_created: '2026-10-20T10:00:06.000-03:00',
    user_id: 111,
    api_version: 'v1',
    action: 'payment.created',
    data: { id: dataId },
    ...overrides,
  };
}

function post(app: Parameters<typeof request>[0], dataId: string, body: object, opts: { requestId?: string; signature?: string } = {}) {
  const requestId = opts.requestId ?? randomUUID();
  const signature = opts.signature ?? sign(dataId, requestId, String(Date.now()));
  return request(app)
    .post(`/webhooks/mercadopago?data.id=${dataId}&type=payment`)
    .set('content-type', 'application/json')
    .set('x-signature', signature)
    .set('x-request-id', requestId)
    .send(JSON.stringify(body));
}

describe('POST /webhooks/mercadopago', () => {
  it('acknowledges a valid notification, then stores the fetched payment', async () => {
    const { app, db, api, payments } = setup();
    payments.set('555', payment('555'));

    const res = await post(app, '555', notification('555'));
    expect(res.status).toBe(200);
    await drainPending(db, api);

    const row = db.prepare('SELECT id, status, direction, transaction_amount, fee_amount, source FROM mp_payments WHERE id = ?').get('555');
    expect(row).toEqual({ id: '555', status: 'approved', direction: 'in', transaction_amount: 1500, fee_amount: 100, source: 'webhook' });
    const ev = db.prepare('SELECT status, deliveries FROM mp_webhook_events').get();
    expect(ev).toEqual({ status: 'processed', deliveries: 1 });
  });

  it('rejects an invalid signature with 401 and stores nothing', async () => {
    const { app, db } = setup();
    const res = await post(app, '555', notification('555'), { signature: `ts=${Date.now()},v1=${'0'.repeat(64)}` });
    expect(res.status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mp_webhook_events').get()).toEqual({ n: 0 });
  });

  it('rejects a body whose data.id differs from the signed query data.id', async () => {
    const { app } = setup();
    const res = await post(app, '555', notification('666'));
    expect(res.status).toBe(400);
  });

  it('treats a re-delivery of the same notification as a duplicate (idempotent)', async () => {
    const { app, db, api, payments } = setup();
    payments.set('555', payment('555'));

    for (let i = 0; i < 3; i++) expect((await post(app, '555', notification('555'))).status).toBe(200);
    await drainPending(db, api);

    expect(db.prepare('SELECT COUNT(*) AS n, MAX(deliveries) AS d FROM mp_webhook_events').get()).toEqual({ n: 1, d: 3 });
    expect(api.calls.filter((c) => c.startsWith('getPayment'))).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mp_payments').get()).toEqual({ n: 1 });
  });

  it('applies a newer status and ignores an out-of-order older one', async () => {
    const { app, db, api, payments } = setup();
    payments.set('555', payment('555', { status: 'pending', date_last_updated: '2026-10-20T10:00:00.000-03:00' }));
    await post(app, '555', notification('555', { id: 1 }));
    await drainPending(db, api);

    payments.set('555', payment('555', { status: 'approved', date_last_updated: '2026-10-20T10:05:00.000-03:00' }));
    await post(app, '555', notification('555', { id: 2, action: 'payment.updated' }));
    await drainPending(db, api);

    payments.set('555', payment('555', { status: 'pending', date_last_updated: '2026-10-20T10:01:00.000-03:00' }));
    await post(app, '555', notification('555', { id: 3, action: 'payment.updated' }));
    await drainPending(db, api);

    expect(db.prepare('SELECT status FROM mp_payments WHERE id = ?').get('555')).toEqual({ status: 'approved' });
  });

  it('marks a notification for an unknown payment (panel simulation) as ignored, still 200', async () => {
    const { app, db, api } = setup();
    expect((await post(app, '123456', notification('123456'))).status).toBe(200);
    await drainPending(db, api);
    expect(db.prepare('SELECT status, last_error FROM mp_webhook_events').get()).toEqual({ status: 'ignored', last_error: 'payment not found (404)' });
  });

  it('keeps a transiently failing event pending for retry', async () => {
    const { app, db, api, payments } = setup();
    payments.set('555', payment('555'));
    const original = api.getPayment;
    api.getPayment = async () => { throw Object.assign(new Error('boom'), { status: 503 }); };
    await post(app, '555', notification('555'));
    await drainPending(db, api);
    expect(db.prepare('SELECT status, attempts FROM mp_webhook_events').get()).toEqual({ status: 'pending', attempts: 1 });

    api.getPayment = original;
    await drainPending(db, api); // still inside the backoff window: not retried yet
    expect(db.prepare('SELECT status, attempts FROM mp_webhook_events').get()).toEqual({ status: 'pending', attempts: 1 });

    db.prepare('UPDATE mp_webhook_events SET next_attempt_at = ?').run(new Date(Date.now() - 1000).toISOString());
    await drainPending(db, api);
    expect(db.prepare('SELECT status, attempts FROM mp_webhook_events').get()).toEqual({ status: 'processed', attempts: 2 });
  });
});
