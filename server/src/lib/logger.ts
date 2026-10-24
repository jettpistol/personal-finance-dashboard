// Minimal structured (JSON lines) logger. Never pass secrets, access tokens or full signatures.

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (process.env.LOG_SILENT === 'true') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const extra = err as Error & { status?: number; error?: string };
    return { error: err.message, errorName: err.name, status: extra.status, apiError: extra.error };
  }
  return { error: String(err) };
}
