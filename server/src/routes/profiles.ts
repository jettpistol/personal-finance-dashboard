import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { currentProfileId } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { createProfile, deleteProfile, getProfile, listProfiles, PROFILE_COOKIE, profileDb, profilesEnabled, renameProfile } from '../lib/profiles.js';
import { idParam, parse } from './util.js';

const nameSchema = z.object({ name: z.string().trim().min(1).max(60) });

export default async function profileRoutes(app: FastifyInstance) {
  app.get('/profiles', async () => {
    if (!profilesEnabled()) return { profiles: [], current: null };
    const profiles = listProfiles().map((p) => {
      const d = profileDb(p);
      const count = (d.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;
      const accounts = (d.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
      return { id: p.id, name: p.name, is_default: !!p.is_default, created_at: p.created_at, transactions: count, accounts };
    });
    return { profiles, current: currentProfileId() };
  });

  app.post('/profiles', async (req) => {
    if (!profilesEnabled()) throw new HttpError(400, 'Los perfiles no están disponibles.');
    const { name } = parse(nameSchema, req.body);
    return { id: createProfile(name).id };
  });

  app.patch('/profiles/:id', async (req) => {
    const { name } = parse(nameSchema, req.body);
    renameProfile(idParam(req.params), name);
    return { ok: true };
  });

  app.delete('/profiles/:id', async (req, reply) => {
    const id = idParam(req.params);
    deleteProfile(id);
    if (currentProfileId() === id) reply.clearCookie(PROFILE_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Remembered per browser for a year.
  app.post('/profiles/select', async (req, reply) => {
    const { id } = parse(z.object({ id: z.number().int() }), req.body);
    if (!getProfile(id)) throw new HttpError(404, 'Perfil no encontrado');
    reply.setCookie(PROFILE_COOKIE, String(id), { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 365 * 24 * 3600 });
    return { ok: true };
  });
}
