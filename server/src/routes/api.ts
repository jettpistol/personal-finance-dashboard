// Dashboard API (all routes require `Authorization: Bearer <DASHBOARD_API_TOKEN>`).
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Db } from '../db.js';
import { getKv } from '../db.js';
import { toCsv } from '../lib/csv.js';
import { errorFields, log } from '../lib/logger.js';
import { MpHttpError, type MpApi, type ReportKind } from '../mp/api.js';
import { getOwnUserId, syncPayments, type PaymentRow } from '../mp/payments.js';

const EXPORT_COLUMNS: readonly (keyof PaymentRow)[] = [
  'id', 'date_created', 'date_approved', 'date_last_updated', 'money_release_date', 'direction', 'status',
  'status_detail', 'operation_type', 'payment_type_id', 'payment_method_id', 'description', 'currency_id',
  'transaction_amount', 'fee_amount', 'net_received_amount', 'collector_id', 'payer_id', 'payer_email',
  'external_reference', 'live_mode',
];

function bearerAuth(token: string) {
  const expected = Buffer.from(token);
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

const asyncRoute = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

function parseDate(v: unknown, name: string): string | undefined {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new BadRequest(`${name} must be an ISO 8601 date`);
  return new Date(v).toISOString();
}

class BadRequest extends Error {}

function reportKind(v: unknown): ReportKind {
  if (v === 'release_report' || v === 'settlement_report') return v;
  throw new BadRequest('kind must be release_report or settlement_report');
}

function queryPayments(db: Db, q: Request['query']) {
  const from = parseDate(q.from, 'from');
  const to = parseDate(q.to, 'to');
  const where: string[] = [];
  const args: string[] = [];
  if (from) { where.push('date_created >= ?'); args.push(from); }
  if (to) { where.push('date_created <= ?'); args.push(to); }
  if (typeof q.status === 'string' && q.status) { where.push('status = ?'); args.push(q.status); }
  if (typeof q.direction === 'string' && q.direction) { where.push('direction = ?'); args.push(q.direction); }
  const sql = `SELECT ${EXPORT_COLUMNS.join(', ')} FROM mp_payments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date_created DESC`;
  return db.prepare(sql).all(...args) as Record<string, unknown>[];
}

export function apiRouter(deps: { db: Db; api: MpApi; apiToken: string }) {
  const { db, api } = deps;
  const router = express.Router();
  router.use(bearerAuth(deps.apiToken));
  router.use(express.json({ limit: '64kb' }));

  // Connection check: proves the access token works and shows which account it belongs to.
  router.get('/mp/me', asyncRoute(async (_req, res) => {
    const me = await api.getMe();
    res.json({ id: me.id, nickname: me.nickname, site_id: me.site_id });
  }));

  router.get('/mp/balance', asyncRoute(async (_req, res) => {
    const userId = await getOwnUserId(db, api);
    res.json({ user_id: userId, balance: await api.getBalance(userId), note: 'Undocumented endpoint; shape not guaranteed.' });
  }));

  router.post('/mp/sync', asyncRoute(async (req, res) => {
    const since = parseDate(req.body?.since, 'since');
    const until = parseDate(req.body?.until, 'until');
    res.json(await syncPayments(db, api, { since: since ? new Date(since) : undefined, until: until ? new Date(until) : undefined }));
  }));

  router.get('/mp/sync/status', (_req, res) => {
    const counts = db.prepare('SELECT status, COUNT(*) AS n FROM mp_webhook_events GROUP BY status').all();
    const payments = db.prepare('SELECT COUNT(*) AS n, MAX(date_last_updated) AS latest FROM mp_payments').get();
    res.json({ cursor: getKv(db, 'mp_sync_cursor') ?? null, payments, webhookEvents: counts });
  });

  router.get('/mp/payments', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 1000);
    res.json(queryPayments(db, req.query).slice(0, limit));
  });

  router.get('/mp/export/payments.csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mercadopago-payments-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + toCsv(EXPORT_COLUMNS, queryPayments(db, req.query)));
  });

  router.get('/mp/export/payments.json', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="mercadopago-payments-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(queryPayments(db, req.query));
  });

  router.get('/mp/webhook-events', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 500);
    res.json(db.prepare(
      `SELECT dedupe_key, notification_id, request_id, type, action, data_id, live_mode, status, attempts,
              deliveries, last_error, received_at, processed_at
       FROM mp_webhook_events ORDER BY received_at DESC LIMIT ?`,
    ).all(limit));
  });

  // Reports (Releases = release_report, Account money = settlement_report).
  router.get('/mp/reports/:kind/config', asyncRoute(async (req, res) => { res.json(await api.reports.getConfig(reportKind(req.params.kind))); }));
  router.post('/mp/reports/:kind/config', asyncRoute(async (req, res) => { res.json(await api.reports.createConfig(reportKind(req.params.kind), req.body)); }));
  router.put('/mp/reports/:kind/config', asyncRoute(async (req, res) => { res.json(await api.reports.updateConfig(reportKind(req.params.kind), req.body)); }));
  router.get('/mp/reports/:kind', asyncRoute(async (req, res) => { res.json(await api.reports.list(reportKind(req.params.kind))); }));
  router.post('/mp/reports/:kind', asyncRoute(async (req, res) => {
    const begin = parseDate(req.body?.begin_date, 'begin_date');
    const end = parseDate(req.body?.end_date, 'end_date');
    if (!begin || !end) throw new BadRequest('begin_date and end_date are required');
    // The reports API expects UTC timestamps without milliseconds, e.g. 2026-09-01T00:00:00Z.
    const strip = (s: string) => s.replace(/\.\d{3}Z$/, 'Z');
    res.status(202).json(await api.reports.create(reportKind(req.params.kind), { begin_date: strip(begin), end_date: strip(end) }));
  }));
  router.get('/mp/reports/:kind/files/:fileName', asyncRoute(async (req, res) => {
    const fileName = String(req.params.fileName);
    if (!/^[\w.\-]+$/.test(fileName)) throw new BadRequest('invalid file name');
    const upstream = await api.reports.download(reportKind(req.params.kind), fileName);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    if (upstream.body) Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
    else res.end();
  }));

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BadRequest) {
      res.status(400).json({ error: err.message });
      return;
    }
    const status = err instanceof MpHttpError ? err.status : (err as { status?: number })?.status;
    log.error('api.error', errorFields(err));
    // Surface Mercado Pago's status (e.g. 401 bad token, 403 missing scope, 404) without leaking internals.
    res.status(status && status >= 400 && status < 600 ? 502 : 500).json({
      error: 'upstream_error',
      mercadopagoStatus: status ?? null,
      detail: err instanceof MpHttpError ? err.body.slice(0, 500) : undefined,
    });
  });

  return router;
}
