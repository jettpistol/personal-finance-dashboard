import crypto from 'node:crypto';
import Papa from 'papaparse';
import { parseAmount } from '../importer.js';
import { today } from '../dates.js';
import type { MovementInput } from './ingest.js';

// Account money report ("settlement_report"): every movement that changed the account balance, including
// the ones that never show up as payments (fund yields, card spend, withdrawals).
//
// The column keys below are the ones Mercado Pago documents for this report. They could not be checked
// against a real file while this was written, so parsing is tolerant: it looks for the first known alias
// of each field and reports which headers it found when it cannot read a file.

const ALIASES = {
  sourceId: ['SOURCE_ID'],
  date: ['TRANSACTION_DATE', 'SETTLEMENT_DATE', 'DATE'],
  type: ['TRANSACTION_TYPE', 'RECORD_TYPE', 'DESCRIPTION'],
  description: ['DESCRIPTION', 'PAYMENT_METHOD', 'PAYMENT_METHOD_TYPE'],
  net: ['SETTLEMENT_NET_AMOUNT', 'REAL_AMOUNT', 'NET_AMOUNT'],
  credit: ['NET_CREDIT_AMOUNT'],
  debit: ['NET_DEBIT_AMOUNT'],
  gross: ['TRANSACTION_AMOUNT'],
  currency: ['SETTLEMENT_CURRENCY', 'TRANSACTION_CURRENCY', 'CURRENCY'],
} as const;

/** Config sent when the account has none yet. Field names per the report configuration reference. */
export const DEFAULT_REPORT_CONFIG = {
  file_name_prefix: 'finanzas-dinero-en-cuenta',
  display_timezone: 'GMT-03',
  report_translation: 'en',
  include_withdraw: true,
  shipping_detail: false,
  refund_detailed: true,
  coupon_detailed: true,
  show_fee_prevision: false,
  show_chargeback_cancel: true,
  columns: ['TRANSACTION_DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE', 'TRANSACTION_TYPE', 'PAYMENT_METHOD_TYPE', 'PAYMENT_METHOD', 'TRANSACTION_AMOUNT', 'TRANSACTION_CURRENCY', 'FEE_AMOUNT', 'SETTLEMENT_NET_AMOUNT', 'SETTLEMENT_CURRENCY'].map((key) => ({ key })),
  frequency: { hour: 0, type: 'daily', value: 1 },
};

export type ParsedReport = { movements: MovementInput[]; headers: string[]; unreadable: string | null };

function pick(row: Record<string, string>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v.trim() !== '') return v.trim();
  }
  return null;
}

function toDate(raw: string): string | null {
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return today(new Date(t));
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseSettlementReport(csv: string): ParsedReport {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toUpperCase(),
  });
  const headers = parsed.meta.fields ?? [];
  const has = (keys: readonly string[]) => keys.some((k) => headers.includes(k));
  if (!has(ALIASES.date) || !(has(ALIASES.net) || has(ALIASES.credit) || has(ALIASES.gross))) {
    return { movements: [], headers, unreadable: `Columnas no reconocidas: ${headers.join(', ') || '(ninguna)'}` };
  }

  const movements: MovementInput[] = [];
  for (const row of parsed.data) {
    const dateRaw = pick(row, ALIASES.date);
    const date = dateRaw ? toDate(dateRaw) : null;
    if (!date) continue; // totals and blank lines
    let amount: number | null = null;
    const net = pick(row, ALIASES.net);
    if (net !== null) amount = parseAmount(net, '.');
    else if (has(ALIASES.credit)) amount = (parseAmount(pick(row, ALIASES.credit) ?? '0', '.') ?? 0) - (parseAmount(pick(row, ALIASES.debit) ?? '0', '.') ?? 0);
    else amount = parseAmount(pick(row, ALIASES.gross) ?? '', '.');
    if (amount === null) continue;

    const sourceId = pick(row, ALIASES.sourceId);
    const type = pick(row, ALIASES.type) ?? '';
    const description = [type, pick(row, ALIASES.description)].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') || 'Movimiento Mercado Pago';
    // Stable across overlapping report ranges, so the same line is never stored twice.
    const external_id = crypto.createHash('sha1').update(`${sourceId}|${type}|${dateRaw}|${amount}`).digest('hex');
    movements.push({
      source: 'report',
      external_id,
      status: type || null,
      payment_type: null,
      payment_ref: sourceId,
      description,
      amount,
      fee: 0,
      currency: pick(row, ALIASES.currency),
      date,
      date_last_updated: null,
      raw: row,
    });
  }
  return { movements, headers, unreadable: null };
}
