import { createHmac, randomUUID } from 'node:crypto';
import { MPNotFoundError } from 'mercadopago';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import type { MpApi } from '../src/mp/api.js';

process.env.LOG_SILENT = 'true';

export const SECRET = 'test-webhook-secret';
export const API_TOKEN = 'test-api-token';
export const OWN_USER_ID = '111';

export function sign(dataId: string | undefined, requestId: string, ts: string, secret = SECRET) {
  const parts = [];
  if (dataId) parts.push(`id:${dataId}`);
  parts.push(`request-id:${requestId}`, `ts:${ts}`);
  return `ts=${ts},v1=${createHmac('sha256', secret).update(parts.join(';') + ';').digest('hex')}`;
}

export function payment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: Number(id),
    status: 'approved',
    status_detail: 'accredited',
    operation_type: 'regular_payment',
    payment_type_id: 'account_money',
    payment_method_id: 'account_money',
    description: 'Test payment',
    currency_id: 'ARS',
    transaction_amount: 1500,
    transaction_details: { net_received_amount: 1400 },
    fee_details: [{ type: 'mercadopago_fee', amount: 100 }],
    collector_id: Number(OWN_USER_ID),
    payer: { id: '222', email: 'payer@example.com' },
    live_mode: false,
    date_created: '2026-10-20T10:00:00.000-03:00',
    date_last_updated: '2026-10-20T10:00:05.000-03:00',
    ...overrides,
  };
}

export function fakeApi(payments: Map<string, Record<string, unknown>>): MpApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getMe: async () => ({ id: Number(OWN_USER_ID), nickname: 'TESTUSER', site_id: 'MLA' }),
    getPayment: async (id) => {
      calls.push(`getPayment:${id}`);
      const p = payments.get(id);
      if (!p) throw new MPNotFoundError({ message: 'Payment not found', error: 'not_found', status: 404, cause: [] } as never);
      return p as never;
    },
    async *searchPayments(options) {
      calls.push(`search:${JSON.stringify(options)}`);
      for (const p of payments.values()) yield p as never;
    },
    getBalance: async () => ({ available_balance: 1000 }),
    reports: {
      getConfig: async () => ({}),
      createConfig: async () => ({}),
      updateConfig: async () => ({}),
      create: async () => ({}),
      list: async () => [],
      download: async () => new Response('a,b\n1,2\n'),
    },
  };
}

export function setup(payments = new Map<string, Record<string, unknown>>(), toleranceSeconds = 300) {
  const db = openDb(':memory:');
  const api = fakeApi(payments);
  const app = createApp({ config: { mpWebhookSecret: SECRET, mpWebhookToleranceSeconds: toleranceSeconds, apiToken: API_TOKEN }, db, api });
  return { db, api, app, payments };
}

export { randomUUID };
