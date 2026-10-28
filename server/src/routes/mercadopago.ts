import type { FastifyInstance } from 'fastify';
import { HttpError } from '../lib/http.js';
import { logAction } from '../lib/audit.js';
import { isValidDate, today } from '../lib/dates.js';
import {
  checkSources,
  checkTokenFormat,
  connectionView,
  deleteConnection,
  linkMpAccount,
  mpAccountState,
  saveChecks,
  saveConnection,
  setHistoryStart,
  setupReports,
  storedToken,
  verifyToken,
} from '../lib/mercadopago.js';

// Each person connects their own Mercado Pago account; these routes only ever act on the logged-in
// user's connection. The token goes in once (PUT) and never comes back out.

const CHECK_EVERY_MS = 30_000;
const lastCheck = new Map<number, number>();

function historyStart(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !isValidDate(v) || v > today()) throw new HttpError(400, 'Elegí una fecha válida, no futura.', 'history_start');
  return v;
}

export default async function mercadoPagoRoutes(app: FastifyInstance) {
  app.get('/me/mercadopago', async (req) => connectionView(req.userId));

  // Connect or replace the token (verified with Mercado Pago before it's stored), or just change the start date.
  app.put('/me/mercadopago', async (req) => {
    const body = (req.body ?? {}) as { access_token?: unknown; history_start?: unknown };
    const start = historyStart(body.history_start);
    if (body.access_token === undefined) {
      setHistoryStart(req.userId, start);
      return connectionView(req.userId);
    }
    // Checked by hand rather than with a schema, so no error can ever echo the value back.
    if (typeof body.access_token !== 'string') throw new HttpError(400, 'Pegá el token.', 'access_token');
    const token = body.access_token.trim();
    if (!token) throw new HttpError(400, 'Pegá el token.', 'access_token');
    checkTokenFormat(token);
    const who = await verifyToken(token);
    saveConnection(req.userId, token, who, start);
    lastCheck.delete(req.userId);
    // No Mercado Pago account in Cuentas yet: make one. If there are some, the screen asks which.
    if (!mpAccountState(req.userId).candidates.length) {
      const made = linkMpAccount(req.userId, null);
      // The hook logs the connection; the account made along with it is its own entry.
      if (made.created)
        logAction({ userId: req.userId, section: 'Mercado Pago', action: 'crear', summary: `Se creó la cuenta «${made.name}» en Cuentas para Mercado Pago`, entity: 'account', entityId: made.id, privateTo: req.userId });
    }
    return connectionView(req.userId);
  });

  // Both talk to Mercado Pago several times in a row, so each person can run one every 30 s.
  const takeTurn = (userId: number) => {
    const stored = storedToken(userId);
    if (!stored) throw new HttpError(400, 'Conectá tu cuenta de Mercado Pago de nuevo.');
    if (Date.now() - (lastCheck.get(userId) ?? 0) < CHECK_EVERY_MS) throw new HttpError(429, 'Esperá unos segundos antes de volver a probar.');
    lastCheck.set(userId, Date.now());
    return stored;
  };

  app.post('/me/mercadopago/check', async (req) => {
    const stored = takeTurn(req.userId);
    const who = await verifyToken(stored.token);
    saveChecks(req.userId, await checkSources(stored.token, stored.mpUserId ?? who.id));
    return connectionView(req.userId);
  });

  // Saves the settings of the reports that have none (approved write), then checks again.
  app.post('/me/mercadopago/reports', async (req) => {
    const stored = takeTurn(req.userId);
    const who = await verifyToken(stored.token);
    const setup = await setupReports(stored.token);
    saveChecks(req.userId, await checkSources(stored.token, stored.mpUserId ?? who.id));
    return { ...connectionView(req.userId), setup };
  });

  // Which account in Cuentas is this person's Mercado Pago (in the active data profile).
  app.post('/me/mercadopago/account', async (req) => {
    if (!connectionView(req.userId).connected) throw new HttpError(400, 'Primero conectá tu cuenta de Mercado Pago.');
    const raw = (req.body as { account_id?: unknown } | null)?.account_id;
    if (raw != null && !Number.isInteger(raw)) throw new HttpError(400, 'Cuenta inválida.', 'account_id');
    const linked = linkMpAccount(req.userId, (raw as number | null | undefined) ?? null);
    return { ...connectionView(req.userId), linked };
  });

  app.delete('/me/mercadopago', async (req) => {
    deleteConnection(req.userId);
    lastCheck.delete(req.userId);
    return { connected: false };
  });
}
