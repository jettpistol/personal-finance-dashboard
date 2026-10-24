import fs from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.js';
import { sessionUser } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import { validationMessage } from './lib/validation-message.js';
import { registerRoutes } from './routes/index.js';
import { PROFILE_COOKIE, profileDb, profilesEnabled, resolveProfile } from './lib/profiles.js';
import { withDb } from './db/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

export const SESSION_COOKIE = 'pfd_session';
const PUBLIC_API = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/setup', '/api/health']);

export async function buildApp(opts: { logger?: boolean; serveWeb?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Warnings and errors only: per-request lines would flood the log of a two-person app.
    logger: opts.logger ? { level: 'warn' } : false,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  app.decorateRequest('userId', 0);
  // Each request reads and writes the data profile chosen in this browser (cookie), or the default one.
  app.addHook('onRequest', (req, _reply, done) => {
    if (!profilesEnabled() || !req.url.startsWith('/api/')) return done();
    const p = resolveProfile(req.cookies[PROFILE_COOKIE]);
    withDb(profileDb(p), p.id, done);
  });
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');
    const path = req.url.split('?')[0];
    if (PUBLIC_API.has(path)) return;
    const uid = sessionUser(req.cookies[SESSION_COOKIE]);
    if (!uid) {
      reply.code(401).send({ error: 'No autenticado' });
      return reply;
    }
    req.userId = uid;
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, fields: err.field ? [err.field] : undefined });
    if (err instanceof ZodError) return reply.code(400).send({ error: validationMessage(err), issues: err.issues, fields: [...new Set(err.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))] });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    console.error(err);
    return reply.code(500).send({ error: 'Error interno del servidor' });
  });

  await app.register(registerRoutes, { prefix: '/api' });

  if (opts.serveWeb && fs.existsSync(config.webDir)) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
    // Single-page app: unknown non-API paths serve index.html.
    app.setNotFoundHandler((req: FastifyRequest, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'No encontrado' });
      return reply.type('text/html').sendFile('index.html');
    });
  }

  return app;
}
