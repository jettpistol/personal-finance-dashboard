import type { FastifyInstance } from 'fastify';
import { HttpError } from '../lib/http.js';
import { isValidDate, today } from '../lib/dates.js';
import {
  checkSources,
  checkTokenFormat,
  connectionView,
  deleteConnection,
  saveChecks,
  saveConnection,
  setHistoryStart,
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
    return connectionView(req.userId);
  });

  app.post('/me/mercadopago/check', async (req) => {
    const stored = storedToken(req.userId);
    if (!stored) throw new HttpError(400, 'Conectá tu cuenta de Mercado Pago de nuevo.');
    const last = lastCheck.get(req.userId) ?? 0;
    if (Date.now() - last < CHECK_EVERY_MS) throw new HttpError(429, 'Esperá unos segundos antes de volver a probar.');
    lastCheck.set(req.userId, Date.now());
    const who = await verifyToken(stored.token);
    saveChecks(req.userId, await checkSources(stored.token, stored.mpUserId ?? who.id));
    return connectionView(req.userId);
  });

  app.delete('/me/mercadopago', async (req) => {
    deleteConnection(req.userId);
    lastCheck.delete(req.userId);
    return { connected: false };
  });
}
