import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Papa from 'papaparse';
import { config } from '../config.js';
import { currentProfileId } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { AUDIT_SECTIONS, assertTimeZone, auditSectionCounts, clearAudit, exportAudit, formatInZone, formatInZoneShort, listAudit, logAction, type AuditFilter } from '../lib/audit.js';
import { parse } from './util.js';

// Actividad: the log of who did what. Times travel as UTC milliseconds; the browser shows them in
// the zone the viewer picks (the CSV export takes that zone as a parameter).

const ms = z.coerce.number().int().min(0).max(8_640_000_000_000_000);

const filterSchema = z.object({
  section: z.enum(AUDIT_SECTIONS).optional(),
  user: z.union([z.literal('auto'), z.coerce.number().int().positive()]).optional(),
  profile: z.enum(['current', 'all']).default('current'),
  from: ms.optional(),
  to: ms.optional(),
  q: z.string().max(100).optional(),
});

const listSchema = filterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

function zoneParam(v: unknown): string {
  const zone = typeof v === 'string' && v ? v : config.timezone;
  try {
    return assertTimeZone(zone);
  } catch {
    throw new HttpError(400, 'Zona horaria inválida.', 'tz');
  }
}

const filterOf = (q: z.infer<typeof filterSchema>, viewer: number): AuditFilter => ({
  viewer,
  section: q.section,
  user: q.user,
  profile: q.profile,
  from: q.from,
  to: q.to,
  q: q.q,
});

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', async (req) => {
    const q = parse(listSchema, req.query);
    return listAudit(filterOf(q, req.userId), q.page, q.page_size);
  });

  app.get('/audit/sections', async (req) => {
    const q = parse(filterSchema, req.query);
    return auditSectionCounts(filterOf(q, req.userId));
  });

  app.get('/audit/export.csv', async (req, reply) => {
    const q = parse(filterSchema, req.query);
    const tz = zoneParam((req.query as { tz?: string }).tz);
    const fields = ['Fecha y hora (UTC)', `Fecha y hora (${tz})`, 'Usuario', 'Perfil', 'Sección', 'Acción', 'Resumen', 'Detalle'];
    const data = exportAudit(filterOf(q, req.userId)).map((e) => [
      new Date(e.at_ms).toISOString(),
      formatInZone(e.at_ms, tz),
      e.user_name ?? 'Automático',
      e.profile_name ?? 'Todos',
      e.section,
      e.action,
      e.summary,
      [
        ...(e.details?.changes ?? []).map((c) => `${c.field}: ${c.from} → ${c.to}`),
        ...(e.details?.facts ?? []).map((f) => `${f.label}: ${f.value}`),
        ...(e.details?.items ?? []),
      ].join(' | '),
    ]);
    // BOM so Excel opens accents correctly; ';' because Spanish-locale Excel expects it.
    const csv = '﻿' + Papa.unparse({ fields, data }, { delimiter: ';' });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="actividad-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  // Clears what the viewer can see: everything, one section, or what's older than an instant.
  // A partner's private entries (which the viewer can't see) stay. The clearing itself is logged.
  app.delete('/audit', async (req) => {
    const q = parse(
      z.object({
        scope: z.enum(['all', 'section', 'before']),
        section: z.enum(AUDIT_SECTIONS).optional(),
        before: ms.optional(),
        profile: z.enum(['current', 'all']).default('current'),
        tz: z.string().max(64).optional(),
      }),
      req.query,
    );
    if (q.scope === 'section' && !q.section) throw new HttpError(400, 'Elegí la sección a borrar.', 'section');
    if (q.scope === 'before' && q.before == null) throw new HttpError(400, 'Elegí la fecha.', 'before');
    const tz = zoneParam(q.tz);
    const deleted = clearAudit({
      viewer: req.userId,
      section: q.scope === 'section' ? q.section : null,
      before: q.scope === 'before' ? q.before : null,
      profile: q.profile,
    });
    const what =
      q.scope === 'section'
        ? ` de ${q.section}`
        : q.scope === 'before'
          ? ` anteriores al ${formatInZoneShort(q.before!, tz)}`
          : '';
    logAction({
      userId: req.userId,
      section: 'Actividad',
      action: 'borrar',
      summary: `Borró ${deleted} ${deleted === 1 ? 'entrada' : 'entradas'} de la actividad${what}${q.profile === 'all' ? ' (todos los perfiles)' : ''}`,
      details: q.scope === 'before' ? { facts: [{ label: 'Anteriores a (UTC)', value: new Date(q.before!).toISOString() }] } : null,
      profileId: q.profile === 'all' ? null : currentProfileId(),
    });
    return { deleted };
  });
}
