import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { accountVisible, loadAccounts } from '../lib/domain.js';
import { parseRows, presetConfigSchema, readTable, type Cell } from '../lib/importer.js';
import { buildPreviewItems } from '../lib/import-preview.js';
import { assertWritable } from '../lib/transactions.js';
import { commitImportRows, commitRowSchema } from '../lib/import-commit.js';
import { autoLink } from '../lib/commitments.js';
import { getUpload, saveUpload } from '../lib/uploads.js';
import { idParam, parse } from './util.js';

const presetSchema = z.object({ name: z.string().trim().min(1).max(60), config: presetConfigSchema });

export default async function importRoutes(app: FastifyInstance) {
  // ---- Presets ----
  app.get('/presets', async () =>
    (db().prepare('SELECT * FROM csv_presets ORDER BY name').all() as { config: string }[]).map((p) => ({ ...p, config: JSON.parse(p.config) })),
  );

  app.post('/presets', async (req) => {
    const p = parse(presetSchema, req.body);
    const id = db().prepare('INSERT INTO csv_presets (name, config) VALUES (?, ?)').run(p.name, JSON.stringify(p.config)).lastInsertRowid;
    return { id: Number(id) };
  });

  app.put('/presets/:id', async (req) => {
    const id = idParam(req.params);
    const p = parse(presetSchema, req.body);
    const res = db().prepare('UPDATE csv_presets SET name = ?, config = ? WHERE id = ?').run(p.name, JSON.stringify(p.config), id);
    if (!res.changes) throw new HttpError(404, 'Preset no encontrado');
    return { ok: true };
  });

  app.delete('/presets/:id', async (req) => {
    db().prepare('DELETE FROM csv_presets WHERE id = ?').run(idParam(req.params));
    return { ok: true };
  });

  // ---- Import flow: upload -> preview (with a preset config) -> commit ----
  app.post('/imports/upload', async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Falta el archivo');
    const data = await file.toBuffer();
    const id = saveUpload(req.userId, file.filename, data);
    return { upload_id: id, file_name: file.filename, size: data.length };
  });

  // Raw grid, for building a preset by pointing at columns.
  app.post('/imports/raw', async (req) => {
    const { upload_id, delimiter, encoding, sheet } = parse(
      z.object({ upload_id: z.string(), delimiter: presetConfigSchema.shape.delimiter, encoding: presetConfigSchema.shape.encoding, sheet: z.number().int().min(0).default(0) }),
      req.body,
    );
    const u = getUpload(upload_id, req.userId);
    let table: Cell[][];
    try {
      table = await readTable(u.data, u.fileName, { delimiter, encoding, sheet });
    } catch (e) {
      throw new HttpError(400, `No se pudo leer el archivo: ${(e as Error).message}`);
    }
    return { rows: table.slice(0, 60), total_rows: table.length, max_columns: Math.max(0, ...table.slice(0, 200).map((r) => r.length)) };
  });

  app.post('/imports/preview', async (req) => {
    const { upload_id, config, account_id } = parse(
      z.object({ upload_id: z.string(), config: presetConfigSchema, account_id: z.number().int() }),
      req.body,
    );
    const u = getUpload(upload_id, req.userId);
    const accounts = loadAccounts();
    const account = accounts.get(account_id);
    if (!account || !accountVisible(account, req.userId)) throw new HttpError(400, 'Cuenta inválida');
    let table: Cell[][];
    try {
      table = await readTable(u.data, u.fileName, config);
    } catch (e) {
      throw new HttpError(400, `No se pudo leer el archivo: ${(e as Error).message}`);
    }
    const { rows, errors } = parseRows(table, config);
    const items = buildPreviewItems(rows, account);
    return { items, errors, total_rows: table.length };
  });

  app.post('/imports/commit', async (req) => {
    const { file_name, account_id, preset_id, rows } = parse(
      z.object({ file_name: z.string().max(200), account_id: z.number().int(), preset_id: z.number().int().nullish(), rows: z.array(commitRowSchema).min(1).max(5000) }),
      req.body,
    );
    const account = loadAccounts().get(account_id);
    if (!account || !accountVisible(account, req.userId)) throw new HttpError(400, 'Cuenta inválida');
    assertWritable(account, req.userId);
    const r = db().transaction(() => commitImportRows(account, rows, req.userId, { file_name, preset_id }))();
    for (const id of r.created) autoLink(id);
    return { batch_id: r.batch_id, imported: r.imported, merged: r.merged, failures: r.failures };
  });

  app.get('/imports', async () =>
    db()
      .prepare(
        `SELECT b.*, a.name AS account_name, u.display_name AS created_by_name,
           (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id) AS remaining
         FROM import_batches b LEFT JOIN accounts a ON a.id = b.account_id LEFT JOIN users u ON u.id = b.created_by
         ORDER BY b.id DESC LIMIT 50`,
      )
      .all(),
  );

  // Undo an import: removes every transaction it created.
  app.delete('/imports/:id', async (req) => {
    const id = idParam(req.params);
    const res = db().transaction(() => {
      const r = db().prepare('DELETE FROM transactions WHERE import_batch_id = ?').run(id);
      db().prepare('DELETE FROM import_batches WHERE id = ?').run(id);
      return r.changes;
    })();
    return { deleted: res };
  });
}
