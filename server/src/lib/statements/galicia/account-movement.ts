import { stableId } from '../money.js'
import type { CardIssuer, Counterparty, SourceRef, Transaction, TransactionKind } from '../types.js'

export interface RawAccountMovement {
  date: string
  /** First line is the bank's label; the rest are detail lines (merchant, tax id, ids...). */
  lines: string[]
  /** Signed: credits positive, debits negative. */
  amountMinor: number
  balanceAfterMinor: number
  source: SourceRef
}

// Some rows print only "CU 20123456789" (or "NO ...") instead of a name.
const TAX_ID = /^(?:[A-Z]{2}\s+)?(\d{11})$/

function findTaxId(lines: string[]): string | null {
  for (const l of lines) {
    const m = TAX_ID.exec(l)
    if (m) return m[1]!
  }
  return null
}

/** Name line: the first detail line unless it is just a tax id / account number. */
function findName(lines: string[]): string | null {
  const first = lines[0]
  return !first || /^(?:[A-Z]{2}\s+)?\d+$/.test(first) ? null : first
}

function counterparty(lines: string[]): Counterparty {
  return { name: findName(lines), taxId: findTaxId(lines) }
}

function fxInfo(lines: string[]): { side: 'buy' | 'sell'; rate: number } | null {
  const text = lines.join(' ')
  const rate = /Cotizacion:\s*([\d.]+)/i.exec(text)
  if (!rate) return null
  const side = /Venta Moneda/i.test(text) ? 'sell' : /Compra Moneda/i.test(text) ? 'buy' : null
  return side ? { side, rate: Number(rate[1]) } : null
}

interface Classified {
  kind: TransactionKind
  merchant: string | null
  counterparty: Counterparty | null
  cardIssuer: CardIssuer | 'other' | null
}

function classify(label: string, details: string[]): Classified {
  const L = label.toUpperCase()
  const base: Classified = { kind: 'other', merchant: null, counterparty: null, cardIssuer: null }

  if (/^COMPRA DEBITO/.test(L)) {
    const merchant = details[0] ?? null
    // Paying a store card (e.g. "PAGO TC CENCO") shows up as a debit purchase.
    if (merchant && /^PAGO TC\b/i.test(merchant)) return { ...base, kind: 'card_payment', merchant, cardIssuer: 'other' }
    return { ...base, kind: 'purchase', merchant }
  }
  if (/^PAGO EN TRANSPORTE/.test(L)) return { ...base, kind: 'purchase', merchant: details[0] ?? null }
  if (/^PAGO CON TRANSFERENCIA/.test(L)) {
    return { ...base, kind: 'purchase', merchant: details[0] ?? null, counterparty: counterparty(details) }
  }
  if (/REINTEGRO PROMO/.test(L)) return { ...base, kind: 'rebate', merchant: details[0] ?? null }
  if (/^ACREDITAMIENTO DE HABERES/.test(L)) return { ...base, kind: 'salary', counterparty: counterparty(details) }
  const card = /^PAGO TARJETA (VISA|AMEX)/.exec(L)
  if (card) return { ...base, kind: 'card_payment', cardIssuer: card[1] === 'VISA' ? 'visa' : 'amex' }
  if (/^(TRANSF\. CTAS PROPIAS|TRANSFERENCIA DE CUENTA PROPIA|INGRESO DE DINERO A CUENTA PROPIA)/.test(L)) {
    return { ...base, kind: 'own_transfer', counterparty: counterparty(details) }
  }
  if (/^TRANSFERENCIA A TERCEROS/.test(L)) return { ...base, kind: 'transfer_out', counterparty: counterparty(details) }
  if (/^(TRANSFERENCIA DE TERCEROS|CREDITO TRANSFERENCIA)/.test(L)) {
    return { ...base, kind: 'transfer_in', counterparty: counterparty(details) }
  }
  if (/^DEBITO DEBIN/.test(L)) return { ...base, kind: 'direct_debit', counterparty: { name: null, taxId: findTaxId(details) } }
  if (/^EXTRACCION EN AUTOSERVICIO/.test(L)) return { ...base, kind: 'cash_withdrawal' }
  if (/^COMPRA VENTA DE DOLARES/.test(L)) return { ...base, kind: 'fx', counterparty: counterparty(details) }
  if (/^INTERES CAPITALIZADO/.test(L)) return { ...base, kind: 'interest' }
  return base
}

export function buildAccountTransaction(m: RawAccountMovement): Transaction {
  const [label = '', ...details] = m.lines
  const c = classify(label, details)
  return {
    id: stableId('galicia-account', m.source.accountRef, m.date, m.lines.join('/'), m.amountMinor, m.balanceAfterMinor),
    source: m.source,
    date: m.date,
    statementCloseDate: null,
    amountMinor: m.amountMinor,
    currency: 'ARS',
    kind: c.kind,
    description: label,
    merchant: c.merchant,
    counterparty: c.counterparty,
    installment: null,
    balanceAfterMinor: m.balanceAfterMinor,
    flag: null,
    cardIssuer: c.cardIssuer,
    cardLast4: null,
    fx: fxInfo(details),
    raw: m.lines.join('\n'),
  }
}
