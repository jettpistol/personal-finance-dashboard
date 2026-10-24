import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { errorFields, log } from './lib/logger.js';
import { createMpApi } from './mp/api.js';
import { syncPayments } from './mp/payments.js';
import { drainPending } from './webhooks/processor.js';

const config = loadConfig();
const db = openDb(config.databasePath);
const api = createMpApi(config.mpAccessToken);
const app = createApp({ config, db, api });

const credentialMode = config.mpAccessToken.startsWith('TEST-') ? 'test' : 'production';
app.listen(config.port, () => {
  log.info('server.listening', { port: config.port, credentialMode, webhookPath: '/webhooks/mercadopago' });
});

// Retry webhook events that failed transiently (Mercado Pago API errors, timeouts).
setInterval(() => drainPending(db, api).catch((err) => log.error('mp.webhook.drain_error', errorFields(err))), 30_000).unref();

// Safety net for notifications that never arrive: incremental reconcile via /v1/payments/search.
if (config.reconcileIntervalMinutes > 0) {
  setInterval(
    () => syncPayments(db, api).catch((err) => log.error('mp.sync.error', errorFields(err))),
    config.reconcileIntervalMinutes * 60_000,
  ).unref();
}
