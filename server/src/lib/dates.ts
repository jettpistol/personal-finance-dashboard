import { config } from '../config.js';

// All dates are plain 'YYYY-MM-DD' strings in the household's timezone; months are 'YYYY-MM'.

export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function currentMonth(now = new Date()): string {
  return today(now).slice(0, 7);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d ?? 1];
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds months keeping the day, clamped to the target month's length (Jan 31 + 1 month = Feb 28). */
export function addMonths(date: string, n: number, preferredDay?: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(preferredDay ?? d, daysInMonth(ny, nm)));
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonthsToMonth(month: string, n: number): string {
  return addMonths(`${month}-01`, n).slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = parts(`${month}-01`);
  return fmt(y, m, daysInMonth(y, m));
}

/** Inclusive list of months between two 'YYYY-MM' values. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonthsToMonth(m, 1)) out.push(m);
  return out;
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = parts(`${from}-01`);
  const [ty, tm] = parts(`${to}-01`);
  return (ty - fy) * 12 + (tm - fm);
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function monthLabel(month: string): string {
  const [y, m] = parts(`${month}-01`);
  return `${MONTHS_ES[m - 1]} ${y}`;
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = parts(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
