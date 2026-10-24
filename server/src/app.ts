import express from 'express';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { errorFields, log } from './lib/logger.js';
import type { MpApi } from './mp/api.js';
import { apiRouter } from './routes/api.js';
import { drainPending } from './webhooks/processor.js';
import { webhookRouter } from './webhooks/router.js';

export function createApp(deps: { config: Pick<Config, 'mpWebhookSecret' | 'mpWebhookToleranceSeconds' | 'apiToken'>; db: Db; api: MpApi }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.get('/healthz', (_req, res) => { res.json({ ok: true }); });

  // Mounted before any global body parser: the webhook route reads the raw body itself.
  app.use('/webhooks', webhookRouter({
    db: deps.db,
    secret: deps.config.mpWebhookSecret,
    toleranceSeconds: deps.config.mpWebhookToleranceSeconds,
    onAccepted: () => {
      setImmediate(() => drainPending(deps.db, deps.api).catch((err) => log.error('mp.webhook.drain_error', errorFields(err))));
    },
  }));

  app.use('/api', apiRouter({ db: deps.db, api: deps.api, apiToken: deps.config.apiToken }));

  return app;
}
