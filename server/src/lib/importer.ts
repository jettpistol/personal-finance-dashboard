import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { z } from 'zod';

// Bank statement import. Each bank exports a different layout, so a preset describes
// where the relevant values are and how to read them.

export const presetConfigSchema = z.object({
  delimiter: z.enum(['auto', ',', ';', '\t', '|']).default('auto'),
  encoding: z.enum(['utf-8', 'windows-1252']).default('utf-8'),
  sheet: z.number().int().min(0).default(0),
  skipRows: z.number().int().min(0).max(200).default(0),
  hasHeader: z.boolean().default(true),
  columns: z.object({
    date: z.number().int().min(0),
    description: z.array(z.number().int().min(0)).min(1),
    amount: z.number().int().min(0).nullish(),
    debit: z.number().int().min(0).nullish(),
    credit: z.number().int().min(0).nullish(),
    currency: z.number().int().min(0).nullish(),
    merchant: z.number().int().min(0).nullish(),
    notes: z.number().int().min(0).nullish(),
  }),
  amountMode: z.enum(['single', 'split']).default('single'),
  // In 'single' mode, true means positive numbers are money going out (typical for card statements).
  invertSign: z.boolean().default(false),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD/MM/YY', 'DD-MM-YYYY', 'DD.MM.YYYY']).default('DD/MM/YYYY'),
  decimalSeparator: z.enum([',', '.']).default(','),
  skipIfContains: z.array(z.string()).default([]),
  accountId: z.number().int().nullish(),
});
export type PresetConfig = z.infer<typeof presetConfigSchema>;

export type Cell = string | number;
export type ParsedRow = {
  line: number; // 1-based line in the file
  date: string;
  description: string;
  amount: number; // signed cents: negative = money out
  currency: 'ARS' | 'USD' | null;
  merchant: string | null;
  notes: string | null;
};

function isXlsx(fileName: string, data: Buffer) {
  return /\.xlsx$/i.test(fileName) || (data[0] === 0x50 && data[1] === 0x4b);
}

function cellToValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellToValue(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v);
}

/** Reads a CSV or XLSX file into a grid of raw cells. */
export async function readTable(data: Buffer, fileName: string, cfg: Pick<PresetConfig, 'delimiter' | 'encoding' | 'sheet'>): Promise<Cell[][]> {
  if (/\.xls$/i.test(fileName)) throw new Error('El formato .xls antiguo no está soportado. Guardalo como .xlsx o .csv.');
  if (isXlsx(fileName, data)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[cfg.sheet] ?? wb.worksheets[0];
    if (!ws) return [];
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1); // exceljs rows are 1-indexed
      rows.push(values.map(cellToValue));
    });
    return rows;
  }
  let text = new TextDecoder(cfg.encoding).decode(data);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parsed = Papa.parse<string[]>(text, {
    delimiter: cfg.delimiter === 'auto' ? '' : cfg.delimiter,
    skipEmptyLines: false,
  });
  return parsed.data;
}

export function parseAmount(raw: Cell, decimalSeparator: ',' | '.'): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^\d.,-]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  const thousands = decimalSeparator === ',' ? '.' : ',';
  s = s.split(thousands).join('');
  if (decimalSeparator === ',') s = s.replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

export function parseDate(raw: Cell, format: PresetConfig['dateFormat']): string | null {
  if (typeof raw === 'number') {
    // Excel serial date (days since 1899-12-30).
    if (raw > 20000 && raw < 80000) return new Date(Math.round((raw - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
    return null;
  }
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(s);
  if (!m) return null;
  let [a, b, c] = [m[1], m[2], m[3]];
  let y: string, mo: string, d: string;
  switch (format) {
    case 'MM/DD/YYYY':
      [mo, d, y] = [a, b, c];
      break;
    case 'YYYY-MM-DD':
      [y, mo, d] = [a, b, c];
      break;
    default:
      [d, mo, y] = [a, b, c];
  }
  if (y.length === 2) y = `20${y}`;
  const out = `${y.padStart(4, '0')}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const dt = new Date(`${out}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== out) return null;
  return out;
}

function parseCurrency(raw: Cell): 'ARS' | 'USD' | null {
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  if (/USD|U\$S|US\$|DOLAR|DÓLAR/.test(s)) return 'USD';
  if (/ARS|\$|PESO/.test(s)) return 'ARS';
  return null;
}

const text = (row: Cell[], i: number | null | undefined) => (i == null ? '' : String(row[i] ?? '').trim());

export function parseRows(table: Cell[][], cfg: PresetConfig): { rows: ParsedRow[]; errors: { line: number; message: string }[] } {
  const rows: ParsedRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const start = cfg.skipRows + (cfg.hasHeader ? 1 : 0);
  const skipWords = cfg.skipIfContains.map((w) => w.toLowerCase()).filter(Boolean);
  for (let i = start; i < table.length; i++) {
    const row = table[i];
    const line = i + 1;
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;
    const joined = row.map((c) => String(c)).join(' ').toLowerCase();
    if (skipWords.some((w) => joined.includes(w))) continue;

    const date = parseDate(row[cfg.columns.date] ?? '', cfg.dateFormat);
    if (!date) {
      errors.push({ line, message: `Fecha no reconocida: "${text(row, cfg.columns.date)}"` });
      continue;
    }
    let amount: number | null;
    if (cfg.amountMode === 'single') {
      const v = cfg.columns.amount == null ? null : parseAmount(row[cfg.columns.amount] ?? '', cfg.decimalSeparator);
      amount = v == null ? null : cfg.invertSign ? -v : v;
    } else {
      const debit = cfg.columns.debit == null ? null : parseAmount(row[cfg.columns.debit] ?? '', cfg.decimalSeparator);
      const credit = cfg.columns.credit == null ? null : parseAmount(row[cfg.columns.credit] ?? '', cfg.decimalSeparator);
      amount = debit == null && credit == null ? null : (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
    }
    if (amount == null || amount === 0) {
      errors.push({ line, message: 'Monto vacío o no reconocido' });
      continue;
    }
    rows.push({
      line,
      date,
      description: cfg.columns.description.map((c) => text(row, c)).filter(Boolean).join(' - ') || '(sin descripción)',
      amount,
      currency: cfg.columns.currency == null ? null : parseCurrency(row[cfg.columns.currency] ?? ''),
      merchant: text(row, cfg.columns.merchant) || null,
      notes: text(row, cfg.columns.notes) || null,
    });
  }
  return { rows, errors };
}
