import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { db, getSetting } from '../db/index.js';
import { addMonthsToMonth, monthEnd, monthLabel, today } from './dates.js';
import { loadUsers, scopeUserId, type Scope } from './domain.js';
import { formatMoney, type Currency } from './money.js';
import { balances, inflationReport, monthSummary, perPerson } from './reports.js';
import { budgetStatus } from './budgets.js';
import { loadConverter } from './fx.js';

// Builds the "cierre de mes" document: a printable summary of a month for one scope.

const COLORS: Record<string, string> = {
  indigo: '4C6EF5', cyan: '15AABF', green: '40C057', orange: 'FD7E14', grape: 'BE4BDB', red: 'FA5252',
  yellow: 'FAB005', pink: 'E64980', teal: '12B886', blue: '228BE6', gray: '868E96', dark: '495057', lime: '82C91E',
};
const ACCENT = '1C7ED6';
const MUTED = '6C757D';

function hex(color: string | null | undefined) {
  return COLORS[color ?? 'gray'] ?? COLORS.gray;
}

function pct(v: number | null | undefined, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits).replace('.', ',')}%`;
}

const thin = { style: BorderStyle.SINGLE, size: 4, color: 'DEE2E6' };
const cellBorders = { top: thin, bottom: thin, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } };

function cell(text: string, opts: { bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; fill?: string; width?: number; size?: number } = {}) {
  return new TableCell({
    borders: cellBorders,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: opts.align, children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: opts.size ?? 20 })] })],
  });
}

function table(header: string[], rows: TableCell[][], widths?: number[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((h, i) => cell(h, { bold: true, color: 'FFFFFF', fill: ACCENT, width: widths?.[i], align: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT })),
      }),
      ...rows.map((r) => new TableRow({ children: r })),
    ],
  });
}

function heading(text: string) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 120 }, children: [new TextRun({ text, color: ACCENT, bold: true })] });
}

function note(text: string) {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, color: MUTED, size: 18, italics: true })] });
}

function bar(fraction: number, color: string) {
  const blocks = Math.max(fraction > 0 ? 1 : 0, Math.round(fraction * 24));
  return new TableCell({
    borders: cellBorders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text: '█'.repeat(blocks), color, size: 16 })] })],
  });
}

function kpiTable(items: { label: string; value: string; sub?: string; color?: string }[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: items.map(
          (k) =>
            new TableCell({
              width: { size: Math.floor(100 / items.length), type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F3F5' },
              borders: { top: { style: BorderStyle.SINGLE, size: 18, color: k.color ?? ACCENT }, bottom: thin, left: thin, right: thin },
              margins: { top: 120, bottom: 120, left: 140, right: 140 },
              children: [
                new Paragraph({ children: [new TextRun({ text: k.label.toUpperCase(), color: MUTED, size: 16, bold: true })] }),
                new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: k.value, bold: true, size: 30 })] }),
                ...(k.sub ? [new Paragraph({ children: [new TextRun({ text: k.sub, color: MUTED, size: 16 })] })] : []),
              ],
            }),
        ),
      }),
    ],
  });
}

export function scopeLabel(scope: Scope) {
  const uid = scopeUserId(scope);
  if (uid === null) return getSetting<string>('household_name');
  return loadUsers().find((u) => u.id === uid)?.display_name ?? 'Personal';
}

export async function buildReviewDocx(month: string, scope: Scope, viewer: number, currency: Currency = 'ARS'): Promise<Buffer> {
  const fx = loadConverter();
  const s = monthSummary(month, { scope, currency, viewer, fx });
  const prevMonth = addMonthsToMonth(month, -1);
  const p = monthSummary(prevMonth, { scope, currency, viewer, fx });
  const otherCurrency: Currency = currency === 'ARS' ? 'USD' : 'ARS';
  const sOther = monthSummary(month, { scope, currency: otherCurrency, viewer, fx });
  const infl = inflationReport(month, { scope, viewer });
  const budgets = budgetStatus(month, scope, viewer);
  const notes = (db().prepare('SELECT notes FROM month_reviews WHERE month = ? AND scope = ?').get(month, scope) as { notes: string } | undefined)?.notes ?? '';
  const users = loadUsers();
  const m = (v: number) => formatMoney(v, currency);
  const change = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
  const rate = fx.rate(monthEnd(month) > today() ? today() : monthEnd(month));

  const children: (Paragraph | Table)[] = [];
  children.push(
    new Paragraph({ children: [new TextRun({ text: scopeLabel(scope).toUpperCase(), color: MUTED, bold: true, size: 20 })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 80 }, children: [new TextRun({ text: `Cierre de ${monthLabel(month)}`, bold: true, size: 52 })] }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: `Generado el ${today().split('-').reverse().join('/')}${rate ? ` · Dólar BNA: $ ${rate.toLocaleString('es-AR')}` : ''}`, color: MUTED, size: 18 })],
    }),
    kpiTable([
      { label: 'Ingresos', value: m(s.income), sub: `${pct(change(s.income, p.income))} vs ${monthLabel(prevMonth)}`, color: '40C057' },
      { label: 'Gastos', value: m(s.expense), sub: `${pct(change(s.expense, p.expense))} vs ${monthLabel(prevMonth)}`, color: 'FA5252' },
      { label: 'Ahorro', value: m(s.net), sub: `Tasa de ahorro: ${s.savings_rate == null ? '—' : `${s.savings_rate.toFixed(1).replace('.', ',')}%`}`, color: ACCENT },
    ]),
    note(`Equivalente en ${otherCurrency}: ingresos ${formatMoney(sOther.income, otherCurrency)}, gastos ${formatMoney(sOther.expense, otherCurrency)}, ahorro ${formatMoney(sOther.net, otherCurrency)} (cada movimiento al dólar BNA de su día).`),
  );

  // Inflation
  children.push(heading('Inflación'));
  if (infl.cpi_month == null) {
    children.push(note('Todavía no se publicó el IPC de este mes. La comparación usa el último dato disponible.'));
  }
  children.push(
    table(
      ['', 'Variación nominal', 'IPC', 'Variación real'],
      [
        [cell(`Gasto vs ${monthLabel(prevMonth)}`), cell(pct(infl.total.nominal_vs_prev), { align: AlignmentType.RIGHT }), cell(pct(infl.cpi_vs_prev), { align: AlignmentType.RIGHT }), cell(pct(infl.total.real_vs_prev), { align: AlignmentType.RIGHT, bold: true, color: (infl.total.real_vs_prev ?? 0) > 0 ? 'C92A2A' : '2B8A3E' })],
        [cell('Gasto vs hace un año'), cell(pct(infl.total.nominal_vs_year), { align: AlignmentType.RIGHT }), cell(pct(infl.cpi_vs_year), { align: AlignmentType.RIGHT }), cell(pct(infl.total.real_vs_year), { align: AlignmentType.RIGHT, bold: true, color: (infl.total.real_vs_year ?? 0) > 0 ? 'C92A2A' : '2B8A3E' })],
      ],
      [40, 20, 20, 20],
    ),
    note('Variación real positiva = el gasto creció más que los precios. Cifras en pesos.'),
  );

  // Categories
  children.push(heading('Gastos por categoría'));
  if (!s.by_category.length) children.push(note('Sin gastos registrados.'));
  else {
    const max = Math.max(...s.by_category.map((c) => c.amount));
    const prevBy = new Map(p.by_category.map((c) => [c.name, c.amount]));
    children.push(
      table(
        ['Categoría', '', 'Monto', '% del total', `vs ${monthLabel(prevMonth).split(' ')[0]}`],
        s.by_category.map((c) => [
          cell(c.name, { bold: true }),
          bar(c.amount / max, hex(c.color)),
          cell(m(c.amount), { align: AlignmentType.RIGHT }),
          cell(`${((c.amount / s.expense) * 100).toFixed(1).replace('.', ',')}%`, { align: AlignmentType.RIGHT, color: MUTED }),
          cell(pct(change(c.amount, prevBy.get(c.name) ?? 0), 0), { align: AlignmentType.RIGHT, color: MUTED }),
        ]),
        [28, 28, 18, 13, 13],
      ),
    );
  }

  // Budgets
  if (budgets.length) {
    children.push(heading('Presupuestos'));
    children.push(
      table(
        ['Categoría', 'Presupuesto', 'Gastado', 'Uso'],
        budgets.map((b) => {
          const color = b.pct >= 100 ? 'C92A2A' : b.pct >= 80 ? 'E67700' : '2B8A3E';
          return [cell(b.category_name), cell(formatMoney(b.amount, b.currency), { align: AlignmentType.RIGHT }), cell(formatMoney(b.spent, b.currency), { align: AlignmentType.RIGHT }), cell(`${b.pct.toFixed(0)}%`, { align: AlignmentType.RIGHT, bold: true, color })];
        }),
        [40, 22, 22, 16],
      ),
    );
  }

  // Merchants
  if (s.top_merchants.length) {
    children.push(heading('Dónde más gastamos'));
    children.push(
      table(
        ['Comercio / descripción', 'Veces', 'Total'],
        s.top_merchants.slice(0, 8).map((t) => [cell(t.name), cell(String(t.count), { align: AlignmentType.RIGHT }), cell(m(t.amount), { align: AlignmentType.RIGHT })]),
        [60, 15, 25],
      ),
    );
  }

  // Household-only sections
  if (scope === 'household') {
    const people = perPerson(month, month, { currency, viewer, fx });
    if (people.length > 1) {
      children.push(heading('Por persona'));
      children.push(
        table(
          ['Persona', 'Parte de gastos compartidos', 'Pagó de lo compartido'],
          people.map((pp) => [cell(pp.name, { bold: true }), cell(m(pp.shared_share), { align: AlignmentType.RIGHT }), cell(m(pp.paid_for_shared), { align: AlignmentType.RIGHT })]),
          [40, 30, 30],
        ),
      );
    }
    const bal = balances();
    const lines = bal.flatMap((b) =>
      b.settlements.map((st) => `${users.find((u) => u.id === st.from)?.display_name} le debe ${formatMoney(st.amount, b.currency)} a ${users.find((u) => u.id === st.to)?.display_name}`),
    );
    children.push(heading('Saldos entre ustedes'));
    children.push(new Paragraph({ children: [new TextRun({ text: lines.length ? lines.join(' · ') : 'Están a mano. 🎉', size: 22 })] }));
  }

  // Notes
  children.push(heading('Notas del mes'));
  const noteLines = notes.trim() ? notes.trim().split(/\r?\n/) : ['(Sin notas. Se pueden agregar desde la página Cierre de mes.)'];
  for (const line of noteLines) children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: line, size: 22 })] }));

  const doc = new Document({
    creator: 'Finanzas',
    title: `Cierre de ${monthLabel(month)}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: ['Finanzas · página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], color: MUTED, size: 16 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export function reviewFileName(month: string, scope: Scope) {
  const label = scopeLabel(scope).normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `cierre-${month}-${label || 'hogar'}.docx`;
}
