// POST /webhooks/mercadopago is the <NOTIFICATION URL> registered in Mercado Pago.
//
// Expected request (Webhooks docs, payment topic):
//   POST {notification_url}?data.id=123456&type=payment
//   Headers: x-signature: ts=<ts>,v1=<hmac hex>   x-request-id: <uuid>   content-type: application/json
//   Body:    { "id": 12345, "live_mode": true, "type": "payment", "date_created": "...", "user_id": 44444,
//              "api_version": "v1", "action": "payment.created", "data": { "id": "123456" } }
// Mercado Pago expects an HTTP 200/201 quickly; anything else (or a timeout) is retried.
import { createHash } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import type { Db } from '../db.js';
import { errorFields, log } from '../lib/logger.js';
import { InvalidWebhookSignatureError, verifyWebhookSignature } from './verify.js';

export type WebhookDeps = {
  db: Db;
  secret: string;
  toleranceSeconds: number;
  /** Called after the event is stored; must not block the response. */
  onAccepted: () => void;
};

type NotificationBody = {
  id?: number | string;
  live_mode?: boolean;
  type?: string;
  action?: string;
  date_created?: string;
  user_id?: number | string;
  api_version?: string;
  data?: { id?: number | string };
};

const first = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' && x !== '' ? x : undefined;
};

/**
 * Idempotency key. Preference order:
 *  1. body.id, the notification id, stable across Mercado Pago's retries of the same notification;
 *  2. x-request-id, unique per request (GAP: the docs don't say whether it is reused on retries);
 *  3. a hash of the raw body.
 */
export function dedupeKey(body: NotificationBody, requestId: string | undefined, rawBody: Buffer): string {
  if (body.id !== undefined && body.id !== null && String(body.id) !== '') return `n:${body.id}`;
  if (requestId) return `r:${requestId}`;
  return `h:${createHash('sha256').update(rawBody).digest('hex')}`;
}

export function webhookRouter(deps: WebhookDeps) {
  const router = express.Router();

  router.post(
    '/mercadopago',
    // Keep the exact bytes for audit/hashing. The HMAC itself does not cover the body.
    express.raw({ type: '*/*', limit: '256kb' }),
    (req: Request, res: Response) => {
      const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const xSignature = req.get('x-signature');
      const xRequestId = req.get('x-request-id');
      // Query keys arrive literally as "data.id" (Express 5 "simple" query parser).
      const queryDataId = first(req.query['data.id']);
      const queryType = first(req.query['type']) ?? first(req.query['topic']);

      try {
        verifyWebhookSignature({
          xSignature,
          xRequestId,
          dataId: queryDataId,
          secret: deps.secret,
          toleranceSeconds: deps.toleranceSeconds,
        });
      } catch (err) {
        if (err instanceof InvalidWebhookSignatureError) {
          // Log the reason and correlation id only; never the secret or the full signature.
          log.warn('mp.webhook.invalid_signature', { reason: err.reason, requestId: err.requestId, ts: err.timestamp, dataId: queryDataId });
          res.status(401).json({ error: 'invalid signature' });
          return;
        }
        log.error('mp.webhook.verify_error', errorFields(err));
        res.status(500).end();
        return;
      }

      let body: NotificationBody = {};
      if (rawBody.length > 0) {
        try {
          body = JSON.parse(rawBody.toString('utf8')) as NotificationBody;
        } catch {
          log.warn('mp.webhook.bad_json', { requestId: xRequestId });
          res.status(400).json({ error: 'invalid JSON body' });
          return;
        }
      }

      const type = body.type ?? queryType ?? null;
      const dataId = body.data?.id !== undefined ? String(body.data.id) : queryDataId ?? null;
      if (queryDataId && body.data?.id !== undefined && String(body.data.id) !== queryDataId) {
        // The signed value is the query data.id; refuse a body that points elsewhere.
        log.warn('mp.webhook.data_id_mismatch', { requestId: xRequestId, queryDataId, bodyDataId: String(body.data.id) });
        res.status(400).json({ error: 'data.id mismatch' });
        return;
      }

      const key = dedupeKey(body, xRequestId, rawBody);
      const inserted = deps.db.prepare(
        `INSERT INTO mp_webhook_events
           (dedupe_key, notification_id, request_id, type, action, data_id, live_mode, body_json, status, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(dedupe_key) DO UPDATE SET deliveries = deliveries + 1`,
      ).run(
        key,
        body.id !== undefined ? String(body.id) : null,
        xRequestId ?? null,
        type,
        body.action ?? null,
        dataId,
        typeof body.live_mode === 'boolean' ? Number(body.live_mode) : null,
        rawBody.toString('utf8'),
        new Date().toISOString(),
      );

      const duplicate = deps.db.prepare('SELECT deliveries FROM mp_webhook_events WHERE dedupe_key = ?').get(key) as { deliveries: number };
      log.info('mp.webhook.accepted', {
        dedupeKey: key, requestId: xRequestId, type, action: body.action, dataId, liveMode: body.live_mode,
        duplicate: duplicate.deliveries > 1, changes: Number(inserted.changes),
      });

      // Acknowledge first, process after: keeps us well inside Mercado Pago's response timeout.
      res.status(200).json({ received: true });
      deps.onAccepted();
    },
  );

  return router;
}
