// LOCAL TEST TOOL, not a Mercado Pago feature.
// Sends a webhook to your own receiver, signed exactly as the docs/SDK describe
// (HMAC-SHA256 hex of "id:{data.id};request-id:{x-request-id};ts:{ts};" with MP_WEBHOOK_SECRET),
// so the receiver can be exercised before Mercado Pago can reach it.
//
//   npm run simulate:webhook -- --url http://localhost:3001/webhooks/mercadopago --data-id 123456789
//   options: --action payment.updated  --bad-signature  --stale  --repeat 3
import { createHmac, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: `http://localhost:${process.env.PORT ?? 3001}/webhooks/mercadopago` },
    'data-id': { type: 'string', default: '123456789' },
    action: { type: 'string', default: 'payment.updated' },
    'notification-id': { type: 'string' },
    'bad-signature': { type: 'boolean', default: false },
    stale: { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' },
  },
});

const secret = process.env.MP_WEBHOOK_SECRET;
if (!secret) throw new Error('MP_WEBHOOK_SECRET is not set');

const dataId = values['data-id']!;
const notificationId = values['notification-id'] ?? String(Date.now());
const body = {
  id: Number(notificationId),
  live_mode: false,
  type: 'payment',
  date_created: new Date().toISOString(),
  user_id: 0, // <REPLACE> optional: your test user's id; the receiver does not depend on it
  api_version: 'v1',
  action: values.action,
  data: { id: dataId },
};

for (let i = 0; i < Number(values.repeat); i++) {
  const requestId = randomUUID();
  const ts = String(values.stale ? Date.now() - 3600_000 : Date.now());
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = values['bad-signature'] ? 'f'.repeat(64) : createHmac('sha256', secret).update(manifest).digest('hex');

  const url = new URL(values.url!);
  url.searchParams.set('data.id', dataId);
  url.searchParams.set('type', 'payment');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    body: JSON.stringify(body),
  });
  console.log(`#${i + 1} ${res.status} ${await res.text()}  (x-request-id ${requestId})`);
}
