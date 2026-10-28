import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accountVisible, loadAccounts } from '../lib/domain.js';
import { HttpError } from '../lib/http.js';
import { buildPreviewItems } from '../lib/import-preview.js';
import { formatMoney } from '../lib/money.js';
import { READERS, readStatement, readerInfo, UnrecognisedFile, type ReaderInfo } from '../lib/statements/registry.js';
import { statementRows, summarizeStatement } from '../lib/statements/rows.js';
import type { Statement } from '../lib/statements/types.js';
import { getUpload } from '../lib/uploads.js';
import { parse } from './util.js';

const CHECK_LABELS: Record<string, string> = {
  'balance-chain': 'Saldo de cada movimiento',
  'total-credits': 'Total de créditos',
  'total-debits': 'Total de débitos',
  'closing-balance': 'Saldo final',
  'total-due-ARS': 'Total a pagar en pesos',
  'card-totals-ARS': 'Suma de compras en pesos',
  'total-due-USD': 'Total a pagar en dólares',
  'card-totals-USD': 'Suma de compras en dólares',
};

type Parsed = { reader: ReaderInfo; statement: Statement };

/** Reads the uploaded file once; later calls reuse the result. */
async function parsedUpload(uploadId: string, userId: number): Promise<Parsed> {
  const u = getUpload(uploadId, userId);
  if (u.cache) return u.cache as Parsed;
  try {
    const parsed = await readStatement(u.fileName, u.data);
    u.cache = parsed;
    return parsed;
  } catch (e) {
    throw new HttpError(400, e instanceof UnrecognisedFile ? e.message : `No se pudo leer el archivo: ${(e as Error).message}`);
  }
}

function describeResult({ reader, statement }: Parsed) {
  const money = (cents: number | undefined) => (cents == null ? '' : formatMoney(cents, 'ARS'));
  return {
    reader,
    summary: summarizeStatement(statement),
    integrity: {
      ok: statement.integrity.ok,
      checks: statement.integrity.checks.map((c) => ({
        name: c.name,
        label: CHECK_LABELS[c.name] ?? c.name,
        ok: c.ok,
        detail: c.ok ? null : (c.detail ?? `Se esperaba ${money(c.expected)} y se leyó ${money(c.actual)}.`),
      })),
    },
    warnings: statement.warnings,
  };
}

export default async function statementRoutes(app: FastifyInstance) {
  // What the system can read today. The page lists these, so a new reader shows up without touching it.
  app.get('/statements/readers', async () => READERS.map(readerInfo));

  // Upload first with POST /imports/upload, then recognise the file.
  app.post('/statements/detect', async (req) => {
    const { upload_id } = parse(z.object({ upload_id: z.string() }), req.body);
    return describeResult(await parsedUpload(upload_id, req.userId));
  });

  // The rows go through the same review and POST /imports/commit as any other import.
  app.post('/statements/preview', async (req) => {
    const { upload_id, account_id } = parse(z.object({ upload_id: z.string(), account_id: z.number().int() }), req.body);
    const account = loadAccounts().get(account_id);
    if (!account || !accountVisible(account, req.userId)) throw new HttpError(400, 'Cuenta inválida');
    const parsed = await parsedUpload(upload_id, req.userId);
    if (!parsed.statement.integrity.ok) {
      throw new HttpError(400, 'Los números del resumen no coinciden con sus propios totales, así que no se importa: podría haberse leído mal.');
    }
    const items = buildPreviewItems(statementRows(parsed.statement), account, { suggest: true });
    return { ...describeResult(parsed), items, errors: [], total_rows: items.length };
  });
}
