import dayjs from 'dayjs';
import 'dayjs/locale/es';
import type { AccountType, Currency, TxType } from './types';

dayjs.locale('es');

const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

// Ajustes → Monedas, set once the household settings load (see AppStateProvider).
let hideCents: Record<Currency, boolean> = { ARS: true, USD: true };
export function setHideCents(v: Record<Currency, boolean> | undefined) {
  if (v) hideCents = v;
}

/** Formats cents, e.g. 123456 -> "$ 1.234,56" / "US$ 1.234,56" ("$ 1.235" with cents hidden). */
export function money(cents: number | null | undefined, currency: Currency = 'ARS', opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (cents == null) return '—';
  const v = cents / 100;
  const abs = Math.abs(v);
  let body: string;
  if (opts.compact && abs >= 1_000_000) body = `${nf2.format(abs / 1_000_000).replace(/,00$/, '')} M`;
  else if (opts.compact || hideCents[currency]) body = nf0.format(abs);
  else body = nf2.format(abs);
  const sign = v < 0 ? '-' : opts.sign && v > 0 ? '+' : '';
  return `${sign}${currency === 'USD' ? 'US$' : '$'} ${body}`;
}

const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/** Chart axes: "$ 150k", "US$ 1,2M", "$ 800". */
export function moneyShort(cents: number, currency: Currency = 'ARS'): string {
  const v = cents / 100;
  const abs = Math.abs(v);
  const body = abs >= 1_000_000 ? `${nf1.format(abs / 1_000_000)}M` : abs >= 1_000 ? `${nf1.format(abs / 1_000)}k` : nf0.format(abs);
  return `${v < 0 ? '-' : ''}${currency === 'USD' ? 'US$' : '$'} ${body}`;
}

/** Converts a decimal amount typed by the user into cents. */
export function toCents(v: number | string | null | undefined): number {
  if (v === '' || v == null) return 0;
  return Math.round(Number(v) * 100);
}

export function fromCents(c: number | null | undefined): number {
  return c == null ? 0 : c / 100;
}

export function pct(v: number | null | undefined, digits = 1, sign = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${sign && v > 0 ? '+' : ''}${v.toFixed(digits).replace('.', ',')}%`;
}

export function date(d: string, fmt = 'D MMM YYYY'): string {
  return dayjs(d).format(fmt);
}

export function monthName(m: string, short = false): string {
  const s = dayjs(`${m}-01`).format(short ? 'MMM YY' : 'MMMM YYYY');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function today(): string {
  return dayjs().format('YYYY-MM-DD');
}

export function currentMonth(): string {
  return dayjs().format('YYYY-MM');
}

export function addMonths(m: string, n: number): string {
  return dayjs(`${m}-01`).add(n, 'month').format('YYYY-MM');
}

export const TYPE_LABEL: Record<TxType, string> = {
  expense: 'Gasto',
  income: 'Ingreso',
  transfer: 'Transferencia',
  adjustment: 'Ajuste de saldo',
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  credit_card: 'Tarjeta de crédito',
  savings: 'Ahorro',
  investment: 'Inversión',
  wallet: 'Billetera virtual',
};

// Decorative colors only: red, yellow and teal are reserved for errors, warnings and positive change.
export const MANTINE_COLORS = ['indigo', 'blue', 'cyan', 'green', 'lime', 'orange', 'pink', 'grape', 'violet', 'gray', 'dark'];

/** Splits an integer total into n parts that add up exactly (earlier parts take the remainder). */
export function allocateEqual(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.trunc(total / n);
  const parts = Array(n).fill(base);
  for (let i = 0; i < total - base * n; i++) parts[i]++;
  return parts;
}
