import { describe, expect, it } from 'vitest';
import { allocate } from '../src/lib/money.js';
import { addMonths, monthRange } from '../src/lib/dates.js';
import { Converter } from '../src/lib/fx.js';
import { CpiIndex } from '../src/lib/cpi.js';
import { parseAmount, parseDate, parseRows, presetConfigSchema, readTable } from '../src/lib/importer.js';
import { backupsToKeep } from '../src/lib/backup.js';

describe('allocate', () => {
  it('splits without losing cents', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(1001, [50, 50])).toEqual([501, 500]);
    expect(allocate(10000, [70, 30])).toEqual([7000, 3000]);
    expect(allocate(-1001, [1, 1]).reduce((a, b) => a + b)).toBe(-1001);
  });
});

describe('dates', () => {
  it('clamps month ends and keeps the anchor day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('Converter', () => {
  const fx = new Converter(
    [
      { date: '2026-10-01', buy: 1000, sell: 1050, source: 't' },
      { date: '2026-10-03', buy: 1100, sell: 1150, source: 't' },
    ],
    'sell',
  );
  it('uses the closest previous quote', () => {
    expect(fx.rate('2026-10-02')).toBe(1050);
    expect(fx.rate('2026-10-05')).toBe(1150);
    expect(fx.rate('2026-09-01')).toBe(1050);
  });
  it('converts both ways', () => {
    expect(fx.convert(10000, 'USD', 'ARS', '2026-10-01')).toBe(10500000);
    expect(fx.convert(1050000, 'ARS', 'USD', '2026-10-01')).toBe(1000);
  });
});

describe('CpiIndex', () => {
  const cpi = new CpiIndex([
    { month: '2026-01', pct: 10 },
    { month: '2026-02', pct: 10 },
  ]);
  it('restates past pesos', () => {
    expect(cpi.factor('2026-01', '2026-02')).toBeCloseTo(1.1);
    expect(cpi.between('2026-01', '2026-02')).toBeCloseTo(10);
    expect(cpi.factor('2026-02', '2026-05')).toBe(1); // not published yet
  });
});

describe('importer', () => {
  it('parses Argentine amounts', () => {
    expect(parseAmount('$ 1.234,56', ',')).toBe(123456);
    expect(parseAmount('-1.234,56', ',')).toBe(-123456);
    expect(parseAmount('(500,00)', ',')).toBe(-50000);
    expect(parseAmount('1,234.56', '.')).toBe(123456);
    expect(parseAmount('12,5-', ',')).toBe(-1250);
    expect(parseAmount(99.9, ',')).toBe(9990);
    expect(parseAmount('abc', ',')).toBeNull();
  });
  it('parses dates', () => {
    expect(parseDate('05/10/2026', 'DD/MM/YYYY')).toBe('2026-10-05');
    expect(parseDate('5/10/26', 'DD/MM/YY')).toBe('2026-10-05');
    expect(parseDate('10/05/2026', 'MM/DD/YYYY')).toBe('2026-10-05');
    expect(parseDate('2026-10-05T10:00', 'DD/MM/YYYY')).toBe('2026-10-05');
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
    expect(parseDate(46300, 'DD/MM/YYYY')).toMatch(/^20\d\d-\d\d-\d\d$/);
  });
  it('reads a bank CSV with a preset', async () => {
    const csv = 'Banco X\nFecha;Concepto;Débito;Crédito;Saldo\n01/10/2026;COMPRA SUPERMERCADO;12.345,60;;100\n02/10/2026;SUELDO;;500.000,00;200\n03/10/2026;SALDO ANTERIOR;;;0\n';
    const cfg = presetConfigSchema.parse({
      delimiter: 'auto',
      encoding: 'windows-1252',
      skipRows: 1,
      columns: { date: 0, description: [1], debit: 2, credit: 3 },
      amountMode: 'split',
      skipIfContains: ['saldo anterior'],
    });
    const table = await readTable(Buffer.from(csv, 'latin1'), 'x.csv', cfg);
    const { rows, errors } = parseRows(table, cfg);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.date, r.description, r.amount])).toEqual([
      ['2026-10-01', 'COMPRA SUPERMERCADO', -1234560],
      ['2026-10-02', 'SUELDO', 50000000],
    ]);
    expect(table[1][2]).toBe('Débito');
  });
});

describe('backup rotation', () => {
  it('keeps recent days and one per month', () => {
    const dates = ['2026-08-01', '2026-08-15', '2026-09-01', '2026-09-20', '2026-10-01', '2026-10-02', '2026-10-03'];
    expect([...backupsToKeep(dates, 2, 2)].sort()).toEqual(['2026-09-01', '2026-10-01', '2026-10-02', '2026-10-03']);
  });
});
