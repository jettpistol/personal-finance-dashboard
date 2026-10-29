import path from 'node:path';
import { resolveDataFolder } from './lib/data-folder.js';

// Optional settings file next to package.json (git-ignored), e.g. the email password. Real
// environment variables win over it.
try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch {
  /* no file: fine */
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

// One data folder for everything, demo included (the demo is a profile inside it): server/data.
// An install that lived in server/data-demo (the demo commands' folder up to 0.16.1) is copied
// over on the first start; see lib/data-folder.ts.
const dataDir = path.resolve(process.env.DATA_DIR ? process.env.DATA_DIR : resolveDataFolder(process.cwd()));

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
  smtp: {
    host: env('SMTP_HOST', ''),
    port: Number(env('SMTP_PORT', '465')),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('MAIL_FROM', ''),
  },
  // Public URL used in Telegram messages and emails, e.g. https://finanzas.example.com
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
  // Mercado Pago's API (overridable only so tests can point it at a local fake).
  mpApiUrl: env('MP_API_URL', 'https://api.mercadopago.com'),
};
