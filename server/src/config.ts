// Runtime configuration, read once from the environment.
// Every value marked <REPLACE> in .env.example must be supplied per environment.

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable ${name} (see server/.env.example)`);
  }
  return value.trim();
}

function optional(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

export type Config = {
  port: number;
  nodeEnv: string;
  /** Access token of the Mercado Pago application (TEST-... in sandbox, APP_USR-... in production). */
  mpAccessToken: string;
  /** "Secret signature" shown in Your integrations > Webhooks for the application. */
  mpWebhookSecret: string;
  /** Max allowed drift between the x-signature `ts` and the server clock. 0 disables the check. */
  mpWebhookToleranceSeconds: number;
  /** Bearer token protecting the dashboard's own /api routes. */
  apiToken: string;
  databasePath: string;
  /** Minutes between background reconciliation syncs (safety net for missed webhooks). 0 disables. */
  reconcileIntervalMinutes: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env, 'PORT', 3001),
    nodeEnv: optional(env, 'NODE_ENV', 'development'),
    mpAccessToken: required(env, 'MP_ACCESS_TOKEN'),
    mpWebhookSecret: required(env, 'MP_WEBHOOK_SECRET'),
    mpWebhookToleranceSeconds: int(env, 'MP_WEBHOOK_TOLERANCE_SECONDS', 300),
    apiToken: required(env, 'DASHBOARD_API_TOKEN'),
    databasePath: optional(env, 'DATABASE_PATH', './data/finance.db'),
    reconcileIntervalMinutes: int(env, 'MP_RECONCILE_INTERVAL_MINUTES', 15),
  };
}
