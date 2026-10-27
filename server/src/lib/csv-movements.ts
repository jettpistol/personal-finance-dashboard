import { db } from '../db/index.js';
import { HttpError } from './http.js';
import { accountVisible, loadAccounts, loadCategories, type Account, type Category } from './domain.js';
import { importHash, insertTx, normaliseTx, type TxInput } from './transactions.js';
import { parseAmount, parseDate, readTable } from './importer.js';
import { autoLink } from './commitments.js';

// Bulk upload of movements from a simple CSV with fixed, named columns (the downloadable
// ejemplo-movimientos.csv). Unlike Importar, there is no per-bank setup: one row is one movement.

export const CSV_COLUMNS = ['fecha', 'tipo', 'monto', 'cuenta', 'categoria', 'descripcion', 'comercio', 'compartido', 'etiquetas', 'notas'] as const;
const REQUIRED = ['fecha', 'tipo', 'monto', 'cuenta'] as const;

export type CsvRow = {
  line: number;
  status: 'ok' | 'error' | 'duplicate';
  message?: string;
  date?: string;
  type?: 'expense' | 'income';
  amount?: number;
  currency?: string;
  account?: string;
  category?: string | null;
  description?: string;
};

/** Lowercase, no accents, single spaces: so "Categoría" matches "categoria" and "Común" matches "comun". */
const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const YES = new Set(['si', 's', 'x', 'true', '1', 'yes']);

function findCategory(raw: string, kind: 'expense' | 'income', cats: Category[]): Category | null | undefined {
  const name = norm(raw);
  if (!name) return null;
  const ofKind = cats.filter((c) => c.kind === kind && !c.archived);
  // "Padre > Hijo" or just a name (a subcategory name, or a main category).
  const [a, b] = name.split('>').map((x) => x.trim());
  if (b) {
    const parent = ofKind.find((c) => c.parent_id === null && norm(c.name) === a);
    return parent ? ofKind.find((c) => c.parent_id === parent.id && norm(c.name) === b) : undefined;
  }
  return ofKind.find((c) => c.parent_id !== null && norm(c.name) === a) ?? ofKind.find((c) => norm(c.name) === a);
}

/** Reads the file and checks every row; with `commit`, also saves the valid, non-duplicate ones. */
export async function processMovementsCsv(data: Buffer, fileName: string, viewer: number, commit: boolean): Promise<{ rows: CsvRow[]; created: number }> {
  const table = await readTable(data, fileName, { delimiter: 'auto', encoding: 'utf-8', sheet: 0 });
  const headerIndex = table.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (headerIndex < 0) throw new HttpError(400, 'El archivo está vacío.');
  const header = table[headerIndex].map(norm);
  const col = Object.fromEntries(CSV_COLUMNS.map((name) => [name, header.indexOf(name)])) as Record<(typeof CSV_COLUMNS)[number], number>;
  const missing = REQUIRED.filter((c) => col[c] < 0);
  if (missing.length) throw new HttpError(400, `Faltan columnas: ${missing.join(', ')}. Usá el archivo de ejemplo como modelo.`);

  const accounts = loadAccounts();
  const usable = [...accounts.values()].filter((a) => !a.archived && accountVisible(a, viewer));
  const cats = [...loadCategories().values()];
  const hashExists = db().prepare('SELECT 1 FROM transactions WHERE import_hash = ? LIMIT 1');
  const seen = new Set<string>();

  const rows: CsvRow[] = [];
  const valid: { tx: ReturnType<typeof normaliseTx>; hash: string }[] = [];
  table.slice(headerIndex + 1).forEach((cells, i) => {
    const line = headerIndex + i + 2;
    const get = (c: (typeof CSV_COLUMNS)[number]) => (col[c] < 0 ? '' : String(cells[col[c]] ?? '').trim());
    if (cells.every((c) => String(c ?? '').trim() === '')) return;
    const fail = (message: string, extra: Partial<CsvRow> = {}) => rows.push({ line, status: 'error', message, ...extra });

    const date = parseDate(cells[col.fecha] ?? '', 'DD/MM/YYYY');
    if (!date) return fail(`Fecha inválida: «${get('fecha')}». Usá DD/MM/AAAA o AAAA-MM-DD.`);
    const tipo = norm(get('tipo'));
    const type = tipo === 'gasto' || tipo === 'expense' ? 'expense' : tipo === 'ingreso' || tipo === 'income' ? 'income' : null;
    if (!type) return fail(`Tipo inválido: «${get('tipo')}». Usá gasto o ingreso.`, { date });
    const amount = parseAmount(cells[col.monto] ?? '', ',');
    if (amount === null || amount <= 0) return fail(`Monto inválido: «${get('monto')}». Usá números positivos con coma decimal, ej. 12.500,50.`, { date, type });
    const account: Account | undefined = usable.find((a) => norm(a.name) === norm(get('cuenta')));
    if (!account) return fail(`No hay una cuenta llamada «${get('cuenta')}».`, { date, type, amount });
    const category = findCategory(get('categoria'), type, cats);
    if (category === undefined) return fail(`No hay una categoría de ${type === 'expense' ? 'gasto' : 'ingreso'} llamada «${get('categoria')}».`, { date, type, amount, account: account.name });

    const input: TxInput = {
      type,
      date,
      amount,
      account_id: account.id,
      category_id: category?.id ?? null,
      description: get('descripcion'),
      merchant: get('comercio') || null,
      notes: get('notas') || null,
      tags: get('etiquetas')
        .split('|')
        .map((t) => t.trim())
        .filter(Boolean),
      is_shared: YES.has(norm(get('compartido'))),
      split: null,
      is_private: false,
    };
    const preview: CsvRow = { line, status: 'ok', date, type, amount, currency: account.currency, account: account.name, category: category?.name ?? null, description: input.description };
    let tx: ReturnType<typeof normaliseTx>;
    try {
      tx = normaliseTx(input, viewer);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), preview);
    }
    const hash = importHash(account.id, date, type === 'expense' ? -amount : amount, input.description);
    if (hashExists.get(hash) || seen.has(hash)) {
      rows.push({ ...preview, status: 'duplicate', message: 'Ya existe un movimiento igual: no se vuelve a cargar.' });
      return;
    }
    seen.add(hash);
    rows.push(preview);
    valid.push({ tx, hash });
  });

  if (commit && valid.length) {
    const ids = db().transaction(() => valid.map((v) => insertTx({ ...v.tx, import_hash: v.hash })))();
    for (const id of ids) autoLink(id);
  }
  return { rows, created: commit ? valid.length : 0 };
}
