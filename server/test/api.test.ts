import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/lib/csv.js';
import { API_TOKEN, payment, setup } from './helpers.js';

const auth = { Authorization: `Bearer ${API_TOKEN}` };

describe('dashboard API', () => {
  it('requires the bearer token', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/mp/payments')).status).toBe(401);
    expect((await request(app).get('/api/mp/payments').set('Authorization', 'Bearer wrong')).status).toBe(401);
  });

  it('syncs payments in both directions and exports them as CSV', async () => {
    const payments = new Map<string, Record<string, unknown>>([
      ['1', payment('1')],
      ['2', payment('2', { collector_id: 999, payer: { id: '111', email: 'me@example.com' }, description: '=HYPERLINK("x")', transaction_amount: 200 })],
    ]);
    const { app, api } = setup(payments);

    const sync = await request(app).post('/api/mp/sync').set(auth).send({ since: '2026-10-01T00:00:00Z' });
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ scanned: 2, inserted: 2 });
    expect(api.calls.filter((c) => c.startsWith('search:'))).toHaveLength(2);
    expect(api.calls.some((c) => c.includes('"payer.id":"111"'))).toBe(true);

    const list = await request(app).get('/api/mp/payments').set(auth);
    expect(list.body.map((p: { id: string; direction: string }) => [p.id, p.direction]).sort()).toEqual([['1', 'in'], ['2', 'out']]);

    const csv = await request(app).get('/api/mp/export/payments.csv?direction=out').set(auth);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('validates report kind', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/mp/reports/nope').set(auth)).status).toBe(400);
    expect((await request(app).get('/api/mp/reports/release_report').set(auth)).status).toBe(200);
  });
});

describe('toCsv', () => {
  it('quotes and escapes', () => {
    expect(toCsv(['a', 'b'], [{ a: 'x,y', b: 'he said "hi"' }])).toBe('a,b\r\n"x,y","he said ""hi"""\r\n');
  });
});
