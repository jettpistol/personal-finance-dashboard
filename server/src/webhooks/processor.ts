// Processes accepted webhook events out of band: fetch the current resource, then apply it idempotently.
// The notification body is only a change signal; GET /v1/payments/{id} is the source of truth.
import { MPNotFoundError } from 'mercadopago';
import type { Db } from '../db.js';
import { errorFields, log } from '../lib/logger.js';
import type { MpApi } from '../mp/api.js';
import { MpHttpError } from '../mp/api.js';
import { getOwnUserId, upsertPayment } from '../mp/payments.js';

const MAX_ATTEMPTS = 5;

type EventRow = { dedupe_key: string; type: string | null; data_id: string | null; attempts: number };

function isNotFound(err: unknown) {
  return err instanceof MPNotFoundError || (err instanceof MpHttpError && err.status === 404) ||
    (typeof err === 'object' && err !== null && (err as { status?: number }).status === 404);
}

export async function processEvent(db: Db, api: MpApi, ev: EventRow): Promise<void> {
  const finish = (status: 'processed' | 'ignored' | 'failed' | 'pending', lastError: string | null) => {
    const now = Date.now();
    // Exponential backoff for transient failures: 30s, 60s, 120s, 240s.
    const nextAttempt = status === 'pending' ? new Date(now + 30_000 * 2 ** ev.attempts).toISOString() : null;
    db.prepare(
      `UPDATE mp_webhook_events SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ?,
       processed_at = CASE WHEN ? IN ('processed', 'ignored') THEN ? ELSE processed_at END
       WHERE dedupe_key = ?`,
    ).run(status, lastError, nextAttempt, status, new Date(now).toISOString(), ev.dedupe_key);
  };

  if (ev.type !== 'payment' || !ev.data_id) {
    // Only the `payment` topic is subscribed for now; other topics are stored for audit only.
    finish('ignored', `unhandled type ${ev.type}`);
    return;
  }

  try {
    const userId = await getOwnUserId(db, api);
    const payment = await api.getPayment(ev.data_id);
    const outcome = upsertPayment(db, payment, userId, 'webhook');
    finish('processed', null);
    log.info('mp.webhook.processed', { dedupeKey: ev.dedupe_key, paymentId: ev.data_id, outcome, status: payment.status });
  } catch (err) {
    if (isNotFound(err)) {
      // Expected for panel "simulate" notifications, whose data.id is not a real payment of this account.
      finish('ignored', 'payment not found (404)');
      log.warn('mp.webhook.payment_not_found', { dedupeKey: ev.dedupe_key, paymentId: ev.data_id });
      return;
    }
    const exhausted = ev.attempts + 1 >= MAX_ATTEMPTS;
    finish(exhausted ? 'failed' : 'pending', errorFields(err).error as string);
    log.error('mp.webhook.process_error', { dedupeKey: ev.dedupe_key, attempt: ev.attempts + 1, exhausted, ...errorFields(err) });
  }
}

/**
 * Processes pending events one at a time, with one drain loop per database. A call that arrives while a
 * drain is running is folded into it: the loop makes one more pass so events stored mid-drain are not missed.
 */
const drains = new WeakMap<Db, { again: boolean; promise?: Promise<void> }>();
export function drainPending(db: Db, api: MpApi): Promise<void> {
  const running = drains.get(db);
  if (running) {
    running.again = true;
    return running.promise!;
  }
  // Register before the loop starts: with nothing pending the loop body completes synchronously.
  const state: { again: boolean; promise?: Promise<void> } = { again: true };
  drains.set(db, state);
  state.promise = (async () => {
    try {
      while (state.again) {
        state.again = false;
        const rows = db.prepare(
          `SELECT dedupe_key, type, data_id, attempts FROM mp_webhook_events
           WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY received_at LIMIT 100`,
        ).all(new Date().toISOString()) as EventRow[];
        for (const row of rows) await processEvent(db, api, row);
      }
    } finally {
      drains.delete(db);
    }
  })();
  return state.promise;
}
