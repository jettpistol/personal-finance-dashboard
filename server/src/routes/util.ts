import type { z } from 'zod';
import { HttpError } from '../lib/http.js';
import { parseScope, scopeVisible, loadUsers, type Scope } from '../lib/domain.js';
import { currentMonth } from '../lib/dates.js';
import type { Currency } from '../lib/money.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export function idParam(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Id inválido');
  return id;
}

export function scopeQuery(query: unknown, viewer: number): Scope {
  const raw = (query as { scope?: string }).scope ?? 'household';
  const scope = parseScope(raw);
  if (!scope) throw new HttpError(400, 'Ámbito inválido');
  if (!scopeVisible(scope, viewer, loadUsers())) throw new HttpError(403, 'Este tablero es privado.');
  return scope;
}

export function monthQuery(query: unknown, key = 'month'): string {
  const m = (query as Record<string, string | undefined>)[key];
  if (m === undefined || m === '') return currentMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HttpError(400, 'Mes inválido');
  return m;
}

export function currencyQuery(query: unknown): Currency {
  const c = (query as { currency?: string }).currency;
  return c === 'USD' ? 'USD' : 'ARS';
}

export function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 1;
}
