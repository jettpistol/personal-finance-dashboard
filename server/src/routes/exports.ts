import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { accountVisible, fetchTxs, loadAccounts, loadCategories, loadUsers, parseScope, presentTx, scopeVisible, txVisibility, type Scope } from '../lib/domain.js';
import { buildReviewDocx, reviewFileName } from '../lib/review.js';
import { notify } from '../lib/notify.js';
import { listBackups, runBackup } from '../lib/backup.js';
import { monthLabel } from '../lib/dates.js';
import { telegramEnabled } from '../lib/telegram.js';
import { currencyQuery, monthQuery, parse, scopeQuery } from './util.js';

const TYPE_ES = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia', adjustment: 'Ajuste' } as const;

function exportRows(viewer: number, from?: string, to?: string) {
  const accounts = loadAccounts();
  const cats = loadCategories();
  const users = loadUsers();
  const name = (id: number | null) => (id == null ? '' : (accounts.get(id)?.name ?? ''));
  const catName = (id: number | null) => {
    const c = id == null ? undefined : cats.get(id);
    if (!c) return '';
    const parent = c.parent_id ? cats.get(c.parent_id)?.name : null;
    return parent ? `${parent} > ${c.name}` : c.name;
  };
  return fetchTxs({ from, to })
    .filter((t) => txVisibility(t, viewer, accounts) !== 'hidden')
    .map((t) => {
      const p = presentTx(t, viewer, accounts);
      return {
        Fecha: t.date,
        Tipo: TYPE_ES[t.type],
        Estado: t.status === 'pending' ? 'Pendiente' : 'Confirmado',
        Descripción: t.description,
        Comercio: t.merchant ?? '',
        Categoría: catName(t.category_id),
        Cuenta: p.account_id ? name(p.account_id) : '(privada)',
        'Cuenta destino': p.to_account_id ? name(p.to_account_id) : '',
        Moneda: t.currency,
        Monto: (t.type === 'expense' ? -t.amount : t.type === 'transfer' ? -t.amount : t.amount) / 100,
        'Monto destino': t.to_amount ? t.to_amount / 100 : '',
        Compartido: t.is_shared ? 'Sí' : '',
        División: t.splits.map((s) => `${users.find((u) => u.id === s.user_id)?.display_name}: ${s.amount / 100}`).join('; '),
        Cuota: t.installment_number ? `${t.installment_number}` : '',
        Etiquetas: p.tags.join(', '),
        Notas: p.notes ?? '',
      };
    });
}

export default async function exportRoutes(app: FastifyInstance) {
  const rangeSchema = z.object({ from: z.string().optional(), to: z.string().optional() });

  app.get('/export/transactions.csv', async (req, reply) => {
    const { from, to } = parse(rangeSchema, req.query);
    // BOM so Excel opens accents correctly; ';' because Spanish-locale Excel expects it.
    const csv = '﻿' + Papa.unparse(exportRows(req.userId, from, to), { delimiter: ';' });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="movimientos.csv"');
    return csv;
  });

  app.get('/export/workbook.xlsx', async (req, reply) => {
    const { from, to } = parse(rangeSchema, req.query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Finanzas';
    const addSheet = (name: string, rows: Record<string, unknown>[]) => {
      const ws = wb.addWorksheet(name);
      if (!rows.length) return;
      ws.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k, width: Math.min(40, Math.max(12, k.length + 4)) }));
      ws.addRows(rows);
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
    };
    addSheet('Movimientos', exportRows(req.userId, from, to));
    const accounts = loadAccounts();
    addSheet(
      'Cuentas',
      [...accounts.values()]
        .filter((a) => accountVisible(a, req.userId))
        .map((a) => ({ Nombre: a.name, Tipo: a.type, Moneda: a.currency, Titular: a.owner_id == null ? 'Común' : (loadUsers().find((u) => u.id === a.owner_id)?.display_name ?? ''), 'Saldo inicial': a.opening_balance / 100, Archivada: a.archived ? 'Sí' : '' })),
    );
    const cats = loadCategories();
    addSheet(
      'Categorías',
      [...cats.values()].map((c) => ({ Nombre: c.name, Padre: c.parent_id ? (cats.get(c.parent_id)?.name ?? '') : '', Tipo: c.kind === 'expense' ? 'Gasto' : 'Ingreso' })),
    );
    const users = loadUsers();
    addSheet(
      'Presupuestos',
      (db().prepare('SELECT * FROM budgets').all() as { category_id: number; scope: Scope; amount: number; currency: string }[])
        .filter((b) => scopeVisible(b.scope, req.userId, users))
        .map((b) => ({ Categoría: cats.get(b.category_id)?.name ?? '', Ámbito: b.scope === 'household' ? 'Hogar' : (users.find((u) => `user:${u.id}` === b.scope)?.display_name ?? ''), Monto: b.amount / 100, Moneda: b.currency })),
    );
    const buf = await wb.xlsx.writeBuffer();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', 'attachment; filename="finanzas.xlsx"');
    return Buffer.from(buf);
  });

  // ---- Monthly review ----
  app.get('/reviews/:month', async (req) => {
    const month = monthQuery(req.params);
    const scope = scopeQuery(req.query, req.userId);
    const row = db().prepare('SELECT * FROM month_reviews WHERE month = ? AND scope = ?').get(month, scope);
    return row ?? { month, scope, notes: '', closed_at: null, sent_at: null };
  });

  app.put('/reviews/:month', async (req) => {
    const month = monthQuery(req.params);
    const { scope, notes, closed } = parse(z.object({ scope: z.string(), notes: z.string().max(10_000), closed: z.boolean().optional() }), req.body);
    const sc = parseScope(scope);
    if (!sc || (sc !== 'household' && sc !== `user:${req.userId}`)) throw new HttpError(403, 'Solo podés editar tu propio cierre o el del hogar.');
    db()
      .prepare(
        `INSERT INTO month_reviews (month, scope, notes, closed_at) VALUES (?, ?, ?, CASE WHEN ? THEN datetime('now') END)
         ON CONFLICT(month, scope) DO UPDATE SET notes = excluded.notes, closed_at = CASE WHEN ? THEN COALESCE(month_reviews.closed_at, datetime('now')) ELSE month_reviews.closed_at END`,
      )
      .run(month, sc, notes, closed ? 1 : 0, closed ? 1 : 0);
    return { ok: true };
  });

  app.get('/reviews/:month/docx', async (req, reply) => {
    const month = monthQuery(req.params);
    const scope = scopeQuery(req.query, req.userId);
    const buf = await buildReviewDocx(month, scope, req.userId, currencyQuery(req.query));
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('content-disposition', `attachment; filename="${reviewFileName(month, scope)}"`);
    return buf;
  });

  app.post('/reviews/:month/send', async (req) => {
    const month = monthQuery(req.params);
    const scope = scopeQuery(req.body, req.userId);
    if (!telegramEnabled()) throw new HttpError(400, 'El bot de Telegram no está configurado.');
    const buf = await buildReviewDocx(month, scope, req.userId);
    const recipients = scope === 'household' ? null : [req.userId];
    await notify({ kind: 'review', users: recipients, title: `Cierre de ${monthLabel(month)}`, body: 'Adjunto el resumen del mes.', link: '/cierre', document: { fileName: reviewFileName(month, scope), data: buf } });
    db()
      .prepare(`INSERT INTO month_reviews (month, scope, sent_at) VALUES (?, ?, datetime('now')) ON CONFLICT(month, scope) DO UPDATE SET sent_at = datetime('now')`)
      .run(month, scope);
    return { ok: true };
  });

  // ---- Backups (server-side snapshots of the whole database) ----
  app.get('/backups', async () => listBackups());
  app.post('/backups', async () => ({ file: (await runBackup()).split('/').pop() }));
}
