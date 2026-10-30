import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { accountVisible, loadAccounts } from '../lib/domain.js';
import { HttpError } from '../lib/http.js';
import {
  connectionView,
  defaultSince,
  disconnect,
  dismissItem,
  fetchStatements,
  finishConnect,
  listItems,
  markImported,
  openItem,
  startConnect,
  startSync,
  stopSync,
  syncView,
} from '../lib/mail-statements.js';
import { parse } from './util.js';

// Statements by email (lib/mail-statements.ts). Every route acts on the logged-in person's own
// Gmail and their own statements; the refresh token never leaves the server.

const FETCH_EVERY_MS = 30_000;
const lastFetch = new Map<number, number>();

const CALLBACK_PATH = '/api/me/gmail/callback';

/** Where Google sends the person back. It must be listed in the OAuth client exactly like this. */
function redirectUri(req: FastifyRequest): string {
  const base = config.publicUrl || `${req.protocol}://${req.headers.host}`;
  return `${base.replace(/\/$/, '')}${CALLBACK_PATH}`;
}

function view(req: FastifyRequest) {
  return { ...connectionView(req.userId), redirect_uri: redirectUri(req), sync: syncView(req.userId), default_since: defaultSince() };
}

const idParam = z.object({ id: z.coerce.number().int() });

export default async function mailStatementRoutes(app: FastifyInstance) {
  app.get('/me/gmail', async (req) => view(req));

  // Returns Google's consent page; the browser goes there and comes back to the callback.
  app.post('/me/gmail/connect', async (req) => ({ url: startConnect(req.userId, redirectUri(req)) }));

  // A plain page load from Google (SameSite=Lax cookies come along), so it answers with a redirect.
  app.get('/me/gmail/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const back = (result: string) => reply.redirect(`/ajustes?tab=gmail&gmail=${result}`);
    if (q.error || !q.code || !q.state) return back(q.error === 'access_denied' ? 'denied' : 'error');
    try {
      await finishConnect(req.userId, q.state, q.code);
      return back('ok');
    } catch (e) {
      req.log.warn(`Gmail connect failed: ${(e as Error).message}`);
      return back('error');
    }
  });

  app.delete('/me/gmail', async (req) => {
    await disconnect(req.userId);
    return view(req);
  });

  // Turn on (or change the start date of) the search in this data profile, and look right away.
  app.put('/me/gmail/sync', async (req) => {
    const { since } = parse(z.object({ since: z.string() }), req.body);
    startSync(req.userId, since);
    try {
      await fetchStatements(req.userId);
    } catch {
      /* the error is in sync.error, shown next to the switch */
    }
    return view(req);
  });

  app.delete('/me/gmail/sync', async (req) => {
    stopSync(req.userId);
    return view(req);
  });

  app.post('/me/gmail/fetch', async (req) => {
    if (Date.now() - (lastFetch.get(req.userId) ?? 0) < FETCH_EVERY_MS) throw new HttpError(429, 'Esperá unos segundos antes de volver a buscar.');
    lastFetch.set(req.userId, Date.now());
    const found = await fetchStatements(req.userId);
    return { ...view(req), found };
  });

  app.get('/mail-statements', async (req) => ({ on: syncView(req.userId).on, items: listItems(req.userId) }));

  // Opens a statement in the Resúmenes wizard: an upload id, as if the file had just been chosen.
  app.post('/mail-statements/:id/open', async (req) => openItem(req.userId, parse(idParam, req.params).id));

  app.post('/mail-statements/:id/imported', async (req) => {
    const { id } = parse(idParam, req.params);
    const { account_id, batch_id } = parse(z.object({ account_id: z.number().int(), batch_id: z.number().int().nullable() }), req.body);
    const account = loadAccounts().get(account_id);
    if (!account || !accountVisible(account, req.userId)) throw new HttpError(400, 'Cuenta inválida');
    markImported(req.userId, id, account_id, batch_id);
    return { ok: true };
  });

  app.post('/mail-statements/:id/dismiss', async (req) => {
    const r = dismissItem(req.userId, parse(idParam, req.params).id);
    return { ok: true, file_name: r.file_name };
  });
}
