import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { isValidDate } from '../lib/dates.js';
import { accountBalances, accountVisible, loadAccounts, loadUsers } from '../lib/domain.js';
import { HttpError } from '../lib/http.js';
import { httpStatusOf, mpClientFor } from '../lib/mercadopago/client.js';
import { connectionForUser, type Connection } from '../lib/mercadopago/ingest.js';
import { encryptSecret, decryptSecret } from '../lib/mercadopago/secrets.js';
import { InvalidWebhookSignatureError, verifyWebhookSignature } from '../lib/mercadopago/signature.js';
import { drainWebhookEvents, refreshBalance, reportCycle, syncPayments } from '../lib/mercadopago/sync.js';
import { parse } from './util.js';

const dateStr = z.string().refine(isValidDate, 'Fecha inválida');

const connectSchema = z.object({
  access_token: z.string().trim().regex(/^(APP_USR|TEST)-[\w-]+$/, 'El access token empieza con APP_USR- o TEST-'),
  /** Existing account to load movements into; null creates a "Mercado Pago" wallet account. */
  account_id: z.number().int().nullish(),
  sync_from: dateStr,
  webhook_secret: z.string().trim().min(8).max(200).nullish(),
});

const patchSchema = z.object({
  webhook_secret: z.string().trim().min(8).max(200).nullable().optional(),
  sync_from: dateStr.optional(),
});

/** Reads the fields the balance endpoint is known to return; anything else stays in `raw`. */
function balanceSummary(json: string | null) {
  if (!json) return null;
  const raw = JSON.parse(json) as Record<string, unknown>;
  const num = (k: string) => (typeof raw?.[k] === 'number' ? Math.round((raw[k] as number) * 100) : null);
  const available = num('available_balance');
  const unavailable = num('unavailable_balance');
  const total = num('total_amount') ?? (available !== null ? available + (unavailable ?? 0) : null);
  return { available, unavailable, total, currency: typeof raw?.currency_id === 'string' ? raw.currency_id : null, raw };
}

function webhookUrl(conn: Connection) {
  const base = config.mpWebhookBaseUrl.replace(/\/$/, '');
  return `${base || '<URL pública>'}/api/mp/webhook/${conn.webhook_key}`;
}

function present(conn: Connection, viewer: number, balances: Map<number, number>) {
  const own = conn.user_id === viewer;
  const counts = db()
    .prepare(`SELECT tx_state AS state, COUNT(*) AS n FROM mp_movements WHERE connection_id = ? GROUP BY tx_state`)
    .all(conn.id) as { state: string; n: number }[];
  const balance = balanceSummary(conn.balance_json);
  const appBalance = balances.get(conn.account_id) ?? null;
  return {
    user_id: conn.user_id,
    account_id: conn.account_id,
    nickname: conn.nickname,
    site_id: conn.site_id,
    test_credentials: !!conn.test_credentials,
    sync_from: conn.sync_from,
    last_sync_at: conn.last_sync_at,
    last_sync_error: conn.last_sync_error,
    balance: balance && { available: balance.available, unavailable: balance.unavailable, total: balance.total, currency: balance.currency },
    balance_at: conn.balance_at,
    balance_error: conn.balance_error,
    app_balance: appBalance,
    // Positive: Mercado Pago holds more than the app knows about.
    balance_drift: balance?.total != null && appBalance != null ? balance.total - appBalance : null,
    report_error: conn.report_error,
    movements: Object.fromEntries(counts.map((c) => [c.state, c.n])),
    // Only the owner sees how to configure webhooks for their account.
    webhook: own ? { url: webhookUrl(conn), has_secret: !!conn.webhook_secret_enc, public_url_set: !!config.mpWebhookBaseUrl } : null,
  };
}

function requireOwn(userId: number): Connection {
  const conn = connectionForUser(userId);
  if (!conn) throw new HttpError(404, 'No tenés Mercado Pago conectado.');
  return conn;
}

const upstream = (e: unknown, what: string) => {
  const status = httpStatusOf(e);
  if (status === 401) return new HttpError(400, 'Mercado Pago rechazó el access token. Revisá que esté completo y vigente.');
  return new HttpError(502, `No se pudo ${what}: ${(e as Error).message}`);
};

export default async function mercadoPagoRoutes(app: FastifyInstance) {
  app.get('/mp/connections', async (req) => {
    const accounts = loadAccounts();
    const balances = accountBalances(accounts);
    const rows = db().prepare('SELECT * FROM mp_connections ORDER BY id').all() as Connection[];
    return loadUsers().map((u) => {
      const conn = rows.find((c) => c.user_id === u.id);
      const account = conn ? accounts.get(conn.account_id) : undefined;
      // A partner's connection is shown like their account: hidden when that account is private.
      if (conn && account && !accountVisible(account, req.userId)) return { user_id: u.id, display_name: u.display_name, connected: true, hidden: true };
      return {
        user_id: u.id,
        display_name: u.display_name,
        connected: !!conn,
        account_name: account?.name ?? null,
        ...(conn ? present(conn, req.userId, balances) : {}),
      };
    });
  });

  app.post('/mp/connection', async (req) => {
    const body = parse(connectSchema, req.body);
    let me: Awaited<ReturnType<ReturnType<typeof mpClientFor>['getMe']>>;
    try {
      me = await mpClientFor(body.access_token).getMe();
    } catch (e) {
      throw upstream(e, 'validar el token con Mercado Pago');
    }
    const taken = db().prepare('SELECT user_id FROM mp_connections WHERE mp_user_id = ? AND user_id != ?').get(me.id, req.userId);
    if (taken) throw new HttpError(409, 'Esa cuenta de Mercado Pago ya está conectada por otra persona del hogar.');

    const existing = connectionForUser(req.userId);
    const accounts = loadAccounts();
    let accountId = body.account_id ?? existing?.account_id ?? null;
    if (accountId != null) {
      const a = accounts.get(accountId);
      if (!a || a.owner_id !== req.userId) throw new HttpError(400, 'Elegí una cuenta tuya.');
      if (a.currency !== 'ARS') throw new HttpError(400, 'La cuenta de Mercado Pago tiene que ser en pesos.');
    } else {
      accountId = Number(
        db()
          .prepare(`INSERT INTO accounts (name, type, currency, owner_id, color) VALUES (?, 'wallet', 'ARS', ?, 'blue')`)
          .run('Mercado Pago', req.userId).lastInsertRowid,
      );
    }

    const secret = body.webhook_secret ? encryptSecret(body.webhook_secret) : existing?.webhook_secret_enc ?? null;
    const fields = [accountId, me.id, me.nickname, me.site_id, body.access_token.startsWith('TEST-') ? 1 : 0, encryptSecret(body.access_token), secret, body.sync_from];
    if (existing) {
      const restart = existing.mp_user_id !== me.id || existing.sync_from !== body.sync_from;
      db()
        .prepare(
          `UPDATE mp_connections SET account_id = ?, mp_user_id = ?, nickname = ?, site_id = ?, test_credentials = ?, access_token_enc = ?,
           webhook_secret_enc = ?, sync_from = ?, last_sync_error = NULL${restart ? ', sync_cursor = NULL, report_state = NULL' : ''} WHERE id = ?`,
        )
        .run(...fields, existing.id);
    } else {
      db()
        .prepare(
          `INSERT INTO mp_connections (account_id, mp_user_id, nickname, site_id, test_credentials, access_token_enc, webhook_secret_enc, sync_from, user_id, webhook_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...fields, req.userId, crypto.randomBytes(18).toString('base64url'));
    }

    // First sync in the background; the page polls the connection status.
    const conn = connectionForUser(req.userId)!;
    setImmediate(() => {
      syncPayments(conn)
        .then(() => refreshBalance(connectionForUser(req.userId) ?? conn))
        .catch((e) => console.error('[mercadopago] first sync failed:', (e as Error).message));
    });
    return { ok: true, nickname: me.nickname, account_id: accountId };
  });

  app.patch('/mp/connection', async (req) => {
    const conn = requireOwn(req.userId);
    const body = parse(patchSchema, req.body);
    if (body.webhook_secret !== undefined) {
      db().prepare('UPDATE mp_connections SET webhook_secret_enc = ? WHERE id = ?').run(body.webhook_secret ? encryptSecret(body.webhook_secret) : null, conn.id);
    }
    if (body.sync_from && body.sync_from !== conn.sync_from) {
      db().prepare('UPDATE mp_connections SET sync_from = ?, sync_cursor = NULL, report_state = NULL WHERE id = ?').run(body.sync_from, conn.id);
    }
    return { ok: true };
  });

  // Disconnecting keeps every transaction already created; it only forgets the token and the raw movements.
  app.delete('/mp/connection', async (req) => {
    const conn = requireOwn(req.userId);
    db().prepare('DELETE FROM mp_connections WHERE id = ?').run(conn.id);
    return { ok: true };
  });

  app.post('/mp/connection/sync', async (req) => {
    const conn = requireOwn(req.userId);
    try {
      const result = await syncPayments(conn);
      await refreshBalance(connectionForUser(req.userId)!);
      return result;
    } catch (e) {
      throw upstream(e, 'sincronizar con Mercado Pago');
    }
  });

  app.post('/mp/connection/report', async (req) => {
    await reportCycle(requireOwn(req.userId), undefined, { force: true });
    const conn = connectionForUser(req.userId)!;
    return { ok: !conn.report_error, error: conn.report_error };
  });

  app.get('/mp/connection/movements', async (req) => {
    const conn = requireOwn(req.userId);
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50) || 50, 200);
    return db()
      .prepare(
        `SELECT m.id, m.source, m.external_id, m.status, m.payment_type, m.description, m.amount, m.fee, m.currency, m.date, m.tx_state,
                m.transaction_id, t.status AS tx_status, m.note, m.updated_at
         FROM mp_movements m LEFT JOIN transactions t ON t.id = m.transaction_id
         WHERE m.connection_id = ? ORDER BY m.date DESC, m.id DESC LIMIT ?`,
      )
      .all(conn.id, limit);
  });

  // ---- Public: Mercado Pago's notification URL. No session; authenticated by the signature. ----
  app.post('/mp/webhook/:key', async (req, reply) => {
    const key = (req.params as { key: string }).key;
    const conn = db().prepare('SELECT * FROM mp_connections WHERE webhook_key = ?').get(key) as Connection | undefined;
    if (!conn) return reply.code(404).send({ error: 'not found' });
    if (!conn.webhook_secret_enc) {
      req.log.warn({ connection: conn.id }, 'mp webhook received but no secret configured');
      return reply.code(401).send({ error: 'webhook secret not configured' });
    }

    const query = req.query as Record<string, string | string[] | undefined>;
    const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const dataId = first(query['data.id']);
    const xRequestId = req.headers['x-request-id'];
    try {
      verifyWebhookSignature({
        xSignature: req.headers['x-signature'],
        xRequestId,
        dataId,
        secret: decryptSecret(conn.webhook_secret_enc),
        toleranceSeconds: config.mpWebhookToleranceSeconds,
      });
    } catch (e) {
      if (e instanceof InvalidWebhookSignatureError) {
        req.log.warn({ connection: conn.id, reason: e.reason, requestId: e.requestId }, 'mp webhook rejected');
        return reply.code(401).send({ error: 'invalid signature' });
      }
      throw e;
    }

    const body = (req.body ?? {}) as { id?: unknown; type?: string; action?: string; live_mode?: boolean; data?: { id?: unknown } };
    const bodyDataId = body.data?.id != null ? String(body.data.id) : undefined;
    if (dataId && bodyDataId && bodyDataId !== dataId) return reply.code(400).send({ error: 'data.id mismatch' });
    const requestId = first(xRequestId);
    // Mercado Pago retries the same notification (same body id) until it gets a 2xx.
    const dedupe = body.id != null ? `n:${conn.id}:${body.id}` : `r:${conn.id}:${requestId ?? crypto.randomUUID()}`;
    db()
      .prepare(
        `INSERT INTO mp_webhook_events (dedupe_key, connection_id, request_id, type, action, data_id, live_mode, body_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT (dedupe_key) DO UPDATE SET deliveries = deliveries + 1`,
      )
      .run(dedupe, conn.id, requestId ?? null, body.type ?? first(query.type) ?? null, body.action ?? null, dataId ?? bodyDataId ?? null,
        typeof body.live_mode === 'boolean' ? Number(body.live_mode) : null, JSON.stringify(body));

    // Acknowledge now, process after: the payment lookup must not hold up Mercado Pago's request.
    setImmediate(() => void drainWebhookEvents().catch((e) => console.error('[mercadopago] webhook processing failed:', (e as Error).message)));
    return { received: true };
  });
}
