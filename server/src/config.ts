import path from 'node:path';

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

// `--demo` (used by `npm run demo`) keeps demo data apart from real data without needing env vars.
const dataDir = path.resolve(env('DATA_DIR', path.join(process.cwd(), process.argv.includes('--demo') ? 'data-demo' : 'data')));

export const config = {
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  dataDir,
  dbPath: path.join(dataDir, 'finanzas.sqlite'),
  receiptsDir: path.join(dataDir, 'receipts'),
  backupsDir: path.join(dataDir, 'backups'),
  webDir: path.resolve(env('WEB_DIR', path.join(process.cwd(), '..', 'web', 'dist'))),
  timezone: env('TZ_APP', 'America/Argentina/Buenos_Aires'),
  // Set to "true" when served over HTTPS (behind Caddy) so cookies get the Secure flag.
  secureCookies: env('SECURE_COOKIES', 'false') === 'true',
  sessionDays: Number(env('SESSION_DAYS', '30')),
  telegramToken: env('TELEGRAM_BOT_TOKEN', ''),
  // Public URL used in Telegram messages, e.g. https://finanzas.example.com
  publicUrl: env('PUBLIC_URL', ''),
  backupKeepDaily: Number(env('BACKUP_KEEP_DAILY', '14')),
  backupKeepMonthly: Number(env('BACKUP_KEEP_MONTHLY', '12')),
  disableScheduler: env('DISABLE_SCHEDULER', 'false') === 'true',
  fxProviders: {
    latestUrl: env('FX_LATEST_URL', 'https://dolarapi.com/v1/dolares/oficial'),
    historyUrl: env('FX_HISTORY_URL', 'https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial'),
  },
  cpiUrl: env('CPI_URL', 'https://api.argentinadatos.com/v1/finanzas/indices/inflacion'),
  maxReceiptBytes: 3 * 1024 * 1024,
  // Mercado Pago. Access tokens are stored encrypted with this key (32 bytes, hex or base64).
  // Empty = a key is generated once in DATA_DIR/mp-token.key.
  mpTokenKey: env('MP_TOKEN_KEY', ''),
  mpTokenKeyFile: path.join(dataDir, 'mp-token.key'),
  // Allowed drift between a webhook's signed timestamp and the server clock. 0 disables the check.
  mpWebhookToleranceSeconds: Number(env('MP_WEBHOOK_TOLERANCE_SECONDS', '300')),
  mpApiBase: env('MP_API_BASE', 'https://api.mercadopago.com'),
  // Public HTTPS base Mercado Pago can reach for webhooks. Separate from PUBLIC_URL so the app itself can
  // stay private (e.g. Tailscale serve) while only the webhook path is published (Tailscale Funnel on :8443).
  mpWebhookBaseUrl: env('MP_WEBHOOK_BASE_URL', env('PUBLIC_URL', '')),
};
