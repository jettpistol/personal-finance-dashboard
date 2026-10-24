import { parseDashDate, parseDashMonthDate, parseMonthYear } from '../../domain/dates'
import { parseArAmount, stableId } from '../../domain/money'
import type {
  CardIssuer,
  CardStatement,
  CurrencyPair,
  IntegrityCheck,
  SourceRef,
  Transaction,
  TransactionKind,
} from '../../domain/types'
import { summarize } from './integrity'

// Amounts are only ever read from the PESOS / DÓLARES columns. Numbers embedded in the
// description ("USD 2,99", "TC1525,000", tax bases) sit far to the left and are ignored.
const AMOUNT = /(?<![\w.,])-?\d[\d.]*,\d\d(?!\d)/g
const DATE_LINE = /^(\s*)(\d{2}-\d{2}-\d{2})\s+(.*)$/

interface Columns {
  pesosEnd: number
  /** Boundary between the PESOS and DÓLARES columns. */
  middle: number
}

interface ColumnAmounts {
  ars: number | null
  usd: number | null
  /** Start offset of the leftmost amount that sits in a column. */
  start: number
}

function columnAmounts(line: string, cols: Columns): ColumnAmounts {
  const out: ColumnAmounts = { ars: null, usd: null, start: line.length }
  for (const m of line.matchAll(AMOUNT)) {
    const end = m.index + m[0].length
    if (end < cols.pesosEnd - 8) continue
    out.start = Math.min(out.start, m.index)
    if (end > cols.middle) out.usd = parseArAmount(m[0])
    else out.ars = parseArAmount(m[0])
  }
  return out
}

function columnsFromHeader(line: string): Columns | null {
  const p = line.indexOf('PESOS')
  const d = line.indexOf('DÓLARES')
  if (p === -1 || d === -1) return null
  const pesosEnd = p + 5
  return { pesosEnd, middle: (pesosEnd + d + 7) / 2 }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

function chargeKind(description: string): TransactionKind {
  const d = description.toUpperCase()
  if (/INTERES|PUNIT/.test(d)) return 'interest'
  if (/SELLOS|\bIVA\b|IIBB|PERCEP|\bRG\b|DB\.RG/.test(d)) return 'tax'
  return 'fee'
}

function detectIssuer(text: string): CardIssuer {
  if (/AMERICAN EXPRESS/i.test(text.slice(0, 600))) return 'amex'
  if (/\bVISA\b/i.test(text.slice(0, 600))) return 'visa'
  throw new Error('Not a Galicia Visa/American Express statement')
}

function pair(ars: number | null, usd: number | null): CurrencyPair {
  return { arsMinor: ars ?? 0, usdMinor: usd ?? 0 }
}

/**
 * Parses a Galicia credit-card statement (Visa or American Express) from the output of
 * `pdftotext -layout`. Both issuers share one layout.
 *
 * Statement amounts are positive for charges; transactions get the opposite sign so that
 * expenses are negative everywhere in the app.
 */
export function parseGaliciaCardText(text: string): CardStatement {
  const issuer = detectIssuer(text)
  const lines = text.split(/\r?\n/)
  const statementId = /Resumen N°\s*(\S+)/.exec(text)?.[1] ?? 'unknown'
  const accountRef = (/N° Cuenta:\s*(\d+)/.exec(text)?.[1] ?? 'unknown').slice(-4)
  const source: SourceRef = { bank: 'galicia', product: issuer, accountRef }

  // Header: previous close, previous due, close, due, next close, next due.
  const headerLine = lines.find((l) => (l.match(/\d{2}-[A-Za-zñ]{3}-\d{2}/g) ?? []).length >= 6)
  const hd = (headerLine?.match(/\d{2}-[A-Za-zñ]{3}-\d{2}/g) ?? []).map(parseDashMonthDate)
  if (hd.length < 6) throw new Error('Could not find the statement dates header')
  const [previousCloseDate, previousDueDate, closeDate, dueDate, nextCloseDate, nextDueDate] = hd as [
    string, string, string, string, string, string,
  ]

  const limitsIdx = lines.findIndex((l) => /^\s*PAGO MINIMO/.test(l))
  const limitsLine = lines.slice(limitsIdx + 1, limitsIdx + 6).find((l) => (l.match(/\$\s*-?[\d.]+,\d\d/g) ?? []).length >= 3)
  const limitValues = (limitsLine?.match(/\$\s*-?[\d.]+,\d\d/g) ?? []).map(parseArAmount)
  const rateLine = lines.find((l) => /En pesos\s+[\d,]+%\s+En d[óo]lares/.test(l))
  const rates = (rateLine?.match(/[\d,]+(?=%)/g) ?? []).map((r) => Number(r.replace(',', '.')))

  const txs: Transaction[] = []
  const detailTxs: Transaction[] = []
  const cardTotals: CardStatement['cardTotals'] = []
  const warnings: string[] = []
  let previousBalance = pair(null, null)
  let totalDue: CurrencyPair | null = null
  let section: 'none' | 'consolidated' | 'detail' | 'charges' = 'none'
  let cols: Columns = { pesosEnd: 115, middle: 126 }
  let pending: Transaction[] = []

  const push = (
    date: string,
    amounts: ColumnAmounts,
    base: Omit<Transaction, 'id' | 'amountMinor' | 'currency' | 'date'> & { voucher?: string },
  ) => {
    const { voucher, ...rest } = base
    for (const [currency, value] of [['ARS', amounts.ars], ['USD', amounts.usd]] as const) {
      if (value === null) continue
      const tx: Transaction = {
        ...rest,
        id: stableId('galicia-card', issuer, statementId, date, rest.description, voucher, rest.installment?.number, currency, value),
        date,
        amountMinor: -value,
        currency,
      }
      txs.push(tx)
      if (section === 'detail') {
        detailTxs.push(tx)
        pending.push(tx)
      }
    }
  }

  const common = {
    source,
    statementCloseDate: closeDate,
    counterparty: null,
    installment: null,
    balanceAfterMinor: null,
    flag: null,
    cardIssuer: null,
    cardLast4: null,
    fx: null,
    merchant: null,
  } as const

  for (const line of lines) {
    const header = columnsFromHeader(line)
    if (header) {
      cols = header
      if (/^\s*CONSOLIDADO/.test(line)) section = 'consolidated'
      continue
    }
    if (/DETALLE DEL CONSUMO/.test(line)) {
      section = 'detail'
      continue
    }
    if (/^\s*SALDO ANTERIOR/.test(line)) {
      const a = columnAmounts(line, cols)
      previousBalance = pair(a.ars, a.usd)
      continue
    }
    const totals = /TARJETA\s+(\d{4})\s+Total Consumos de\s+(.+?)\s{2,}/.exec(line)
    if (totals) {
      const a = columnAmounts(line, cols)
      cardTotals.push({ last4: totals[1]!, holder: totals[2]!.trim(), arsMinor: a.ars ?? 0, usdMinor: a.usd ?? 0 })
      for (const tx of pending) tx.cardLast4 = totals[1]!
      pending = []
      section = 'charges'
      continue
    }
    if (/^\s*TOTAL A PAGAR/.test(line)) {
      const a = columnAmounts(line, cols)
      totalDue = pair(a.ars, a.usd)
      section = 'none'
      continue
    }

    const m = DATE_LINE.exec(line)
    if (!m || section === 'none') continue
    const date = parseDashDate(m[2]!)
    const amounts = columnAmounts(line, cols)
    if (amounts.ars === null && amounts.usd === null) {
      warnings.push(`Dated line without amount skipped: "${clean(line)}"`)
      continue
    }
    const body = line.slice(m[1]!.length + m[2]!.length).trimStart()
    const preAmount = line.slice(line.length - body.length, amounts.start).trimEnd()

    // A second physical card's purchases follow the first card's "Total Consumos"; only purchases
    // carry a 6-digit voucher number, charges (interest, taxes) never do.
    if (section === 'charges' && /\s\d{6}\s*$/.test(` ${preAmount}`)) section = 'detail'

    if (section === 'consolidated') {
      const description = clean(preAmount)
      const kind: TransactionKind = /^SU PAGO/.test(description)
        ? 'card_payment'
        : /^TRANSFERENCIA DEUDA/.test(description)
          ? 'debt_transfer'
          : (amounts.ars ?? amounts.usd ?? 0) < 0
            ? 'refund'
            : 'purchase'
      push(date, amounts, {
        ...common,
        kind,
        description,
        raw: clean(line),
        merchant: kind === 'refund' || kind === 'purchase' ? description : null,
      })
    } else if (section === 'detail') {
      const flagMatch = /^([*KF])\s+(.*)$/.exec(preAmount.trimStart())
      const flag = flagMatch?.[1] ?? null
      const rest = flagMatch ? flagMatch[2]! : preAmount.trimStart()
      const tail = /^(.*?)(?:\s+(\d{2})\/(\d{2}))?\s+(\d{6})\s*$/.exec(rest)
      const description = clean(tail ? tail[1]! : rest)
      const amount = amounts.ars ?? amounts.usd ?? 0
      push(date, amounts, {
        ...common,
        kind: amount < 0 ? 'refund' : 'purchase',
        description,
        merchant: description,
        installment: tail?.[2] ? { number: Number(tail[2]), total: Number(tail[3]) } : null,
        flag,
        raw: clean(line),
        voucher: tail?.[4],
      })
    } else if (section === 'charges') {
      const description = clean(preAmount)
      push(date, { ...amounts, ars: amounts.ars, usd: amounts.usd }, {
        ...common,
        kind: chargeKind(description),
        description,
        raw: clean(line),
      })
    }
  }

  if (!totalDue) throw new Error('Could not find "TOTAL A PAGAR"')

  const sum = (list: Transaction[], currency: 'ARS' | 'USD') =>
    list.filter((t) => t.currency === currency).reduce((s, t) => s + t.amountMinor, 0)
  const checks: IntegrityCheck[] = (['ARS', 'USD'] as const).flatMap((cur) => {
    const key = cur === 'ARS' ? 'arsMinor' : 'usdMinor'
    const expected = totalDue![key]
    const actual = previousBalance[key] - sum(txs, cur)
    const purchasesTotal = cardTotals.reduce((s, c) => s + c[key], 0)
    return [
      { name: `total-due-${cur}`, ok: actual === expected, expected, actual },
      { name: `card-totals-${cur}`, ok: -sum(detailTxs, cur) === purchasesTotal, expected: purchasesTotal, actual: -sum(detailTxs, cur) },
    ]
  })

  return {
    kind: 'card',
    bank: 'galicia',
    issuer,
    statementId,
    accountRef,
    previousCloseDate,
    previousDueDate,
    closeDate,
    dueDate,
    nextCloseDate,
    nextDueDate,
    previousBalance,
    totalDue,
    minimumPaymentArsMinor: limitValues[0] ?? null,
    limits: { purchaseArsMinor: limitValues[1] ?? null, financingArsMinor: limitValues[2] ?? null },
    rates: { tnaArs: rates[0] ?? null, tnaUsd: rates[1] ?? null, temArs: rates[2] ?? null, temUsd: rates[3] ?? null },
    cardTotals,
    transactions: txs,
    upcomingInstallments: parseUpcomingInstallments(lines),
    integrity: summarize(checks),
    warnings,
  }
}

/** "Cuotas a vencer:" -> a row of months followed by a row of amounts. */
function parseUpcomingInstallments(lines: string[]): CardStatement['upcomingInstallments'] {
  const i = lines.findIndex((l) => /Cuotas a vencer/.test(l))
  if (i === -1) return []
  const rest = lines.slice(i + 1, i + 6)
  const monthsLine = rest.find((l) => /[A-Za-zñ]+\/\d{2}/.test(l))
  const monthsIdx = monthsLine ? rest.indexOf(monthsLine) : -1
  if (!monthsLine) return []
  const months = (monthsLine.match(/[A-Za-zñ]+\/\d{2}/g) ?? []).map(parseMonthYear)
  const amounts = (rest.slice(monthsIdx + 1).find((l) => /\$\s*[\d.]+,\d\d/.test(l))?.match(/\$\s*[\d.]+,\d\d/g) ?? []).map(parseArAmount)
  return months.map((month, k) => ({ month, arsMinor: amounts[k] ?? 0 }))
}
