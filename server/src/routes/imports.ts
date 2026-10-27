import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { accountVisible, loadAccounts } from '../lib/domain.js';
import { parseRows, presetConfigSchema, readTable, type Cell } from '../lib/importer.js';
import { applyRules, loadRules } from '../lib/rules.js';
import { assertWritable, importHash, insertTx, normaliseTx } from '../lib/transactions.js';
import { autoLink } from '../lib/commitments.js';
import { loadConverter } from '../lib/fx.js';
import { idParam, parse } from './util.js';

// Uploaded files are kept in memory for a short while so the preset builder can re-parse them.
const uploads = new Map<string, { userId: number; fileName: string; data: Buffer; expires: number }>();
const UPLOAD_TTL = 30 * 60_000;

function getUpload(id: string, userId: number) {
  for (const [k, u] of uploads) if (u.expires < Date.now()) uploads.delete(k);
  const u = uploads.get(id);
  if (!u || u.userId !== userId) throw new HttpError(404, 'El archivo expiró. Volvé a subirlo.');
  return u;
}

const presetSchema = z.object({ name: z.string().trim().min(1).max(60), config: presetConfigSchema });

const commitRowSchema = z.object({
  date: z.string(),
  description: z.string().max(300),
  amount: z.number().int().positive(),
  direction: z.enum(['out', 'in']),
  type: z.enum(['expense', 'income', 'transfer']),
  category_id: z.number().int().nullish(),
  merchant: z.string().nullish(),
  notes: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  to_account_id: z.number().int().nullish(),
  is_shared: z.boolean().default(false),
  import_hash: z.string(),
});

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
    const id = crypto.randomUUID();
    uploads.set(id, { userId: req.userId, fileName: file.filename, data, expires: Date.now() + UPLOAD_TTL });
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
    const rules = loadRules();
    const kinds = new Map((db().prepare('SELECT id, kind FROM categories').all() as { id: number; kind: string }[]).map((c) => [c.id, c.kind]));
    const hashExists = db().prepare('SELECT 1 FROM transactions WHERE import_hash = ? LIMIT 1');
    const similar = db().prepare('SELECT id, description FROM transactions WHERE account_id = ? AND date = ? AND amount = ? LIMIT 1');
    const items = rows.map((r) => {
      const amount = Math.abs(r.amount);
      const direction = r.amount < 0 ? 'out' : 'in';
      const hash = importHash(account.id, r.date, r.amount, r.description);
      const patch = applyRules(rules, { description: r.description, amount: r.amount, account_id: account.id });
      const type = patch?.type ?? (direction === 'out' ? 'expense' : 'income');
      // A rule's category only applies when it matches the row's kind (gasto / ingreso).
      const categoryId = patch?.category_id != null && kinds.get(patch.category_id) === type ? patch.category_id : null;
      const dup = hashExists.get(hash) ? 'exact' : similar.get(account.id, r.date, amount) ? 'similar' : null;
      return {
        line: r.line,
        date: r.date,
        description: r.description,
        amount,
        direction,
        currency_mismatch: r.currency != null && r.currency !== account.currency,
        type,
        category_id: categoryId,
        merchant: patch?.merchant ?? r.merchant,
        notes: r.notes,
        tags: patch?.tags ?? [],
        to_account_id: patch?.to_account_id ?? null,
        is_shared: patch?.is_shared ?? false,
        rule: patch ? patch.rule_name : null,
        duplicate: dup,
        import_hash: hash,
        include: dup !== 'exact' && !(r.currency != null && r.currency !== account.currency),
      };
    });
    return { items, errors, total_rows: table.length };
  });

  app.post('/imports/commit', async (req) => {
    const { file_name, account_id, preset_id, rows } = parse(
      z.object({ file_name: z.string().max(200), account_id: z.number().int(), preset_id: z.number().int().nullish(), rows: z.array(commitRowSchema).min(1).max(5000) }),
      req.body,
    );
    const accounts = loadAccounts();
    const account = accounts.get(account_id);
    if (!account || !accountVisible(account, req.userId)) throw new HttpError(400, 'Cuenta inválida');
    assertWritable(account, req.userId);
    const fx = loadConverter();
    const created: number[] = [];
    const result = db().transaction(() => {
      const batchId = Number(
        db().prepare('INSERT INTO import_batches (file_name, preset_id, account_id, created_by) VALUES (?, ?, ?, ?)').run(file_name, preset_id ?? null, account_id, req.userId)
          .lastInsertRowid,
      );
      let count = 0;
      const failures: { description: string; error: string }[] = [];
      for (const r of rows) {
        try {
          // The row amount is always in this account's currency.
          let from = account.id;
          let to: number | null = null;
          let amount = r.amount;
          let toAmount: number | null = null;
          if (r.type === 'transfer') {
            if (r.to_account_id == null) throw new Error('Falta la cuenta destino de la transferencia');
            const other = accounts.get(r.to_account_id);
            if (!other) throw new Error('Cuenta destino inválida');
            const converted = other.currency === account.currency ? r.amount : fx.convert(r.amount, account.currency, other.currency, r.date);
            if (!converted) throw new Error('No hay cotización para convertir la transferencia');
            if (r.direction === 'out') {
              to = other.id;
              if (other.currency !== account.currency) toAmount = converted;
            } else {
              // Money coming in is a transfer from the other account into this one.
              from = other.id;
              to = account.id;
              amount = converted;
              if (other.currency !== account.currency) toAmount = r.amount;
            }
          }
          const tx = normaliseTx(
            {
              type: r.type,
              date: r.date,
              amount,
              account_id: from,
              to_account_id: to,
              to_amount: toAmount,
              category_id: r.category_id ?? null,
              description: r.description,
              merchant: r.merchant ?? null,
              notes: r.notes ?? null,
              tags: r.tags,
              is_shared: r.is_shared,
              is_private: false,
            },
            req.userId,
          );
          created.push(insertTx({ ...tx, import_batch_id: batchId, import_hash: r.import_hash }));
          count++;
        } catch (e) {
          failures.push({ description: r.description, error: (e as Error).message });
        }
      }
      db().prepare('UPDATE import_batches SET row_count = ? WHERE id = ?').run(count, batchId);
      return { batch_id: batchId, imported: count, failures };
    })();
    for (const id of created) autoLink(id);
    return result;
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
