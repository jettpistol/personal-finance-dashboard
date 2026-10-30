import { parseMonthYear, parseSlashDate } from '../dates.js'
import { parseArAmount, stableId } from '../money.js'
import type { CardStatement, CurrencyPair, IntegrityCheck, SourceRef, Transaction, TransactionKind } from '../types.js'
import { summarize } from '../galicia/integrity.js'

// Naranja X sends one "Resumen de Cuenta" per account. It covers every card of the account
// (physical and virtual: "NX Master", "NX Visa", "NX Virtual"…), and each purchase names its card
// in the TARJETA column. Amounts are only read from the $ / U$S columns; numbers inside the
// description or a tax base ("(Base Imponible $12.090,40)") sit further left and are ignored.

const AMOUNT = /(?<![\w.,])-?\d[\d.]*,\d\d(?!\d)/g
const DATE_LINE = /^\s*(\d{2}\/\d{2}\/\d{2})\s/

interface Columns {
  /** Where each header word starts; -1 when the header doesn't have it. */
  tarjeta: number
  detalle: number
  cuota: number
  /** Start of the "$" header. Amounts end a few characters to its right. */
  pesos: number
  /** Start of the "U$S" header: an amount ending past it is in dollars. */
  dollars: number
}

function columnsFromHeader(line: string): Columns | null {
  const fecha = line.indexOf('FECHA')
  const dollars = line.indexOf('U$S')
  if (fecha === -1 || dollars === -1) return null
  const pesos = line.lastIndexOf('$', dollars - 1)
  if (pesos === -1) return null
  return { tarjeta: line.indexOf('TARJETA'), detalle: line.indexOf('DETALLE'), cuota: line.indexOf('CUOTA/PLAN'), pesos, dollars }
}

interface ColumnAmounts {
  ars: number | null
  usd: number | null
  /** Start of the leftmost amount in a column (line length when there is none). */
  start: number
}

function columnAmounts(line: string, cols: Columns): ColumnAmounts {
  const out: ColumnAmounts = { ars: null, usd: null, start: line.length }
  for (const m of line.matchAll(AMOUNT)) {
    const end = m.index + m[0].length
    if (end < cols.pesos - 12) continue
    out.start = Math.min(out.start, m.index)
    if (end > cols.dollars + 1) out.usd = parseArAmount(m[0])
    else out.ars = parseArAmount(m[0])
  }
  return out
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * "27/10" has no year: take the one that puts it on the given side of the anchor date, within a year.
 * The statement prints most dates like this; only the due date carries its year.
 */
function dayMonth(text: string, anchor: string, side: 'before' | 'after'): string {
  const m = /^(\d{2})\/(\d{2})$/.exec(text)
  if (!m) throw new Error(`Invalid date: "${text}"`)
  const year = Number(anchor.slice(0, 4))
  const same = iso(year, Number(m[2]), Number(m[1]))
  if (side === 'before') return same <= anchor ? same : iso(year - 1, Number(m[2]), Number(m[1]))
  return same >= anchor ? same : iso(year + 1, Number(m[2]), Number(m[1]))
}

function chargeKind(description: string): TransactionKind {
  const d = description.toUpperCase()
  if (/INTERES|PUNIT/.test(d)) return 'interest'
  if (/SELLOS|\bIVA\b|IIBB|PERCEP|\bRG\b|IMPUESTO/.test(d)) return 'tax'
  return 'fee'
}

const amountOf = (re: RegExp, text: string): number | null => {
  const m = re.exec(text)
  return m ? parseArAmount(m[1]!) : null
}

const rate = (s: string | undefined) => (s ? Number(s.replace(',', '.')) : null)

export function isNaranjaXStatement(text: string): boolean {
  return /TARJETA NARANJA S\.A\.U/.test(text) && /Tu total a pagar es/.test(text)
}

/**
 * Parses a Naranja X credit-card account statement from the output of `pdftotext -layout`.
 *
 * Statement amounts are positive for charges; transactions get the opposite sign so that
 * expenses are negative everywhere in the app.
 */
export function parseNaranjaXCardText(text: string): CardStatement {
  if (!isNaranjaXStatement(text)) throw new Error('Not a Naranja X statement')
  const lines = text.split(/\r?\n/)
  const warnings: string[] = []

  const statementId = /RESUMEN N\S{0,2}:?\s*(\d+)/.exec(text)?.[1] ?? 'unknown'
  const accountRef = (/^\s*(\d{3}\.\d{5}\/\d)\s*$/m.exec(text)?.[1] ?? 'unknown').replace(/\D/g, '').slice(-4) || 'unknown'
  const source: SourceRef = { bank: 'naranjax', product: 'naranjax', accountRef }

  // The due date is the only one printed with its year; every other date is placed around it.
  const dueText = /Tu total a pagar es[^\n]*\n\s*y vence el (\d{2}\/\d{2}\/\d{2})/.exec(text)?.[1]
  if (!dueText) throw new Error('Could not find the due date')
  const dueDate = parseSlashDate(dueText)
  const closeText = /El resumen actual cerr[óo] el (\d{2}\/\d{2})/.exec(text)?.[1]
  if (!closeText) throw new Error('Could not find the close date')
  const closeDate = dayMonth(closeText, dueDate, 'before')
  const prevCloseText = /resumen anterior cerr[óo] el (\d{2}\/\d{2})/.exec(text)?.[1]
  const prevDue = /venci[óo] el (\d{2}\/\d{2}), por \$\s*([\d.]+,\d\d)/.exec(text)
  // A second column ("Cuotas futuras") shares these lines, so allow some text in between.
  const next = /pr[óo]ximo resumen cierra el (\d{2}\/\d{2}),[\s\S]{0,200}?y vence el (\d{2}\/\d{2})\b/.exec(text)
  const previousCloseDate = prevCloseText ? dayMonth(prevCloseText, closeDate, 'before') : null
  const previousDueDate = prevDue ? dayMonth(prevDue[1]!, closeDate, 'before') : null
  const nextCloseDate = next ? dayMonth(next[1]!, closeDate, 'after') : null
  const nextDueDate = next ? dayMonth(next[2]!, closeDate, 'after') : null

  const headerTotal = amountOf(/Tu total a pagar es \$\s*([\d.]+,\d\d)/, text)
  if (headerTotal === null) throw new Error('Could not find the total to pay')
  const headerTotalUsd = amountOf(/Tu total a pagar es[^\n]*?U\$S\s*([\d.]+,\d\d)/, text)
  const previousBalance: CurrencyPair = { arsMinor: prevDue ? parseArAmount(prevDue[2]!) : 0, usdMinor: 0 }

  const limitOf = (re: RegExp) => {
    const m = re.exec(text)
    return m ? parseArAmount(m[1]!) : null
  }
  const financing = /SALDO A FINANCIAR SE ENCUENTRA COMPUESTO POR CUENTA DE TN: TEM: ([\d,]+)% TNA: ([\d,]+)%/.exec(text)
  const usdRates = /EN DOLARES\s+TEM ([\d,]+)% TNA ([\d,]+)%/.exec(text)

  const upcomingInstallments: CardStatement['upcomingInstallments'] = []
  for (const m of text.matchAll(/(?<!desde )\b([A-Za-zñÑ]+\/\d{2}) \$([\d.]+,\d\d)\./g)) {
    try {
      upcomingInstallments.push({ month: parseMonthYear(m[1]!), arsMinor: parseArAmount(m[2]!) })
    } catch {
      /* not a month: some other "word/NN $x." */
    }
  }

  const txs: Transaction[] = []
  const cardTotals: CardStatement['cardTotals'] = []
  // Purchases are grouped per holder ("Consumos tarjeta de crédito de <name>"), each with its subtotal.
  const holderBlocks: Array<{ printed: CurrencyPair; sum: CurrencyPair; holder: string }> = []
  let section: 'none' | 'purchases' | 'charges' | 'payments' = 'none'
  let cols: Columns | null = null
  let detailTotal: number | null = null
  let chargeLabel: string | null = null
  let expectSubtotal = false
  let expectTotal = false

  const common = {
    source,
    statementCloseDate: closeDate,
    counterparty: null,
    balanceAfterMinor: null,
    cardIssuer: null,
    cardLast4: null,
    fx: null,
  } as const

  const push = (
    date: string,
    amounts: ColumnAmounts,
    base: Omit<Transaction, 'id' | 'amountMinor' | 'currency' | 'date' | keyof typeof common> & { voucher?: string | null },
    sign: 1 | -1,
  ) => {
    const { voucher, ...rest } = base
    for (const [currency, value] of [['ARS', amounts.ars], ['USD', amounts.usd]] as const) {
      if (value === null) continue
      txs.push({
        ...common,
        ...rest,
        id: stableId('naranjax-card', statementId, txs.length, date, rest.cardName, voucher, rest.description, rest.installment?.number, currency, value),
        date,
        amountMinor: sign * value,
        currency,
      })
      if (section === 'purchases') {
        const block = holderBlocks.at(-1)
        // As printed: charges add to the holder's subtotal, refunds take from it.
        if (block) block.sum[currency === 'ARS' ? 'arsMinor' : 'usdMinor'] -= sign * value
      }
    }
  }

  for (const line of lines) {
    const header = columnsFromHeader(line)
    if (header) {
      cols = header
      continue
    }
    if (/Consumos tarjeta de cr[ée]dito de /.test(line)) {
      section = 'purchases'
      holderBlocks.push({ printed: { arsMinor: 0, usdMinor: 0 }, sum: { arsMinor: 0, usdMinor: 0 }, holder: '' })
      expectSubtotal = true
      continue
    }
    if (expectSubtotal && /^\s*(\$|U\$S)\s*[\d.]+,\d\d/.test(line)) {
      const block = holderBlocks.at(-1)!
      block.printed.arsMinor = amountOf(/(?<!U)\$\s*([\d.]+,\d\d)/, line) ?? 0
      block.printed.usdMinor = amountOf(/U\$S\s*([\d.]+,\d\d)/, line) ?? 0
      continue
    }
    const holder = /^\s*([^,]+), (Titular|Adicional)\s*$/.exec(line)
    if (holder && expectSubtotal) {
      holderBlocks.at(-1)!.holder = clean(holder[1]!)
      expectSubtotal = false
      continue
    }
    if (/^\s*Otros\s/.test(line)) section = 'charges'
    if (/Pago del resumen anterior/.test(line)) {
      section = 'payments'
      continue
    }
    if (/^\s*Total\s*$/.test(line)) {
      expectTotal = true
      section = 'none'
      continue
    }
    if (expectTotal) {
      const total = amountOf(/^\s*\$\s*([\d.]+,\d\d)\s*$/, line)
      if (total !== null) {
        detailTotal = total
        expectTotal = false
      }
      continue
    }
    if (/^\s*Para que\s*$|^Informaci[óo]n|^\s*legal:/.test(line)) {
      section = 'none'
      continue
    }
    if (section === 'none' || !cols) continue

    if (section === 'charges') {
      // "IVA Operaciones Identificadas con *" is printed above its amount; Sellos on the same line.
      const amounts = columnAmounts(line, cols)
      const label = clean(line.slice(0, amounts.start).replace(/^\s*(Otros|cargos:)/, '').replace(/\(Base Imponible[^)]*\)/, ''))
      if (amounts.ars === null && amounts.usd === null) {
        if (label) chargeLabel = label
        continue
      }
      const description = label || chargeLabel || 'Otros cargos'
      chargeLabel = null
      push(closeDate, amounts, { kind: chargeKind(description), description, merchant: null, installment: null, flag: null, cardName: null, raw: line.trim() }, -1)
      continue
    }

    const date = DATE_LINE.exec(line)?.[1]
    if (!date) continue
    const amounts = columnAmounts(line, cols)
    if (amounts.ars === null && amounts.usd === null) {
      warnings.push(`Renglón sin monto, no se importa: ${clean(line)}`)
      continue
    }
    const iso = parseSlashDate(date)

    if (section === 'payments') {
      const description = clean(line.slice(cols.detalle, amounts.start))
      push(iso, amounts, { kind: 'card_payment', description, merchant: null, installment: null, flag: null, cardName: null, raw: line.trim() }, 1)
      continue
    }

    // Purchases: FECHA | TARJETA CUPON | DETALLE | CUOTA/PLAN | $ | U$S. Split by content rather
    // than exact columns: from one statement to the next, text can sit a character or two away
    // from its header, which would cut a coupon number or a description in two.
    const from = DATE_LINE.exec(line)![0].length
    let body = line.slice(from, amounts.start)
    let plan = ''
    const planMatch = /\s{2,}(\S{1,5})\s*$/.exec(body)
    if (planMatch && cols.cuota > 0 && from + planMatch.index + planMatch[0].search(/\S/) >= cols.cuota - 8) {
      plan = planMatch[1]!
      body = body.slice(0, planMatch.index)
    }
    const starred = body.trimStart().startsWith('*')
    const parts = starred ? null : /^\s*(.*?)\s+(\d{1,10})\s+(\S.*?)\s*$/.exec(body)
    const cardName = clean(parts?.[1] ?? '') || null
    const voucher = parts?.[2] ?? null
    const description = starred ? clean(body).slice(1).trim() : clean(parts?.[3] ?? body)
    const cuota = /^(\d{1,2})\/(\d{1,2})$/.exec(plan)
    const installment = cuota && Number(cuota[2]) > 1 ? { number: Number(cuota[1]), total: Number(cuota[2]) } : null
    if (plan && !cuota && !/^0?1$/.test(plan)) {
      warnings.push(`Plan «${plan}» en «${description}»: se importa como una compra en un pago.`)
    }
    // Lines marked "*" are the account's own charges (interest, maintenance): no card, VAT applies.
    const credit = (amounts.ars ?? amounts.usd ?? 0) < 0
    const kind: TransactionKind = starred && !cardName ? chargeKind(description) : credit ? 'refund' : 'purchase'
    const signed: ColumnAmounts = { ...amounts, ars: amounts.ars === null ? null : Math.abs(amounts.ars), usd: amounts.usd === null ? null : Math.abs(amounts.usd) }
    push(
      iso,
      signed,
      {
        kind,
        description,
        merchant: kind === 'purchase' || kind === 'refund' ? description : null,
        installment,
        flag: starred ? '*' : null,
        cardName,
        voucher,
        raw: line.trim(),
      },
      credit ? 1 : -1,
    )
  }

  for (const b of holderBlocks) cardTotals.push({ last4: '', holder: b.holder, arsMinor: b.printed.arsMinor, usdMinor: b.printed.usdMinor })

  // Checks. ARS: previous balance − payments + purchases + charges = total to pay, and each
  // holder's purchases add up to the subtotal printed above them.
  const sumOf = (currency: 'ARS' | 'USD') => txs.filter((t) => t.currency === currency).reduce((s, t) => s - t.amountMinor, 0)
  const checks: IntegrityCheck[] = []
  const expectedArs = previousBalance.arsMinor + sumOf('ARS')
  checks.push({ name: 'total-due-ARS', ok: expectedArs === headerTotal, expected: headerTotal, actual: expectedArs })
  const blockSum = (c: keyof CurrencyPair) => holderBlocks.reduce((s, b) => s + b.sum[c], 0)
  const blockPrinted = (c: keyof CurrencyPair) => holderBlocks.reduce((s, b) => s + b.printed[c], 0)
  checks.push({ name: 'card-totals-ARS', ok: holderBlocks.length > 0 && blockSum('arsMinor') === blockPrinted('arsMinor'), expected: blockPrinted('arsMinor'), actual: blockSum('arsMinor') })
  if (detailTotal !== null) checks.push({ name: 'detail-total', ok: detailTotal === headerTotal, expected: headerTotal, actual: detailTotal })

  const usdSum = sumOf('USD')
  let totalUsd = 0
  if (headerTotalUsd !== null) {
    totalUsd = headerTotalUsd
    checks.push({ name: 'total-due-USD', ok: usdSum === headerTotalUsd, expected: headerTotalUsd, actual: usdSum })
    checks.push({ name: 'card-totals-USD', ok: blockSum('usdMinor') === blockPrinted('usdMinor'), expected: blockPrinted('usdMinor'), actual: blockSum('usdMinor') })
  } else if (usdSum !== 0) {
    totalUsd = usdSum
    warnings.push('El resumen tiene movimientos en dólares, pero no se encontró un total en dólares para comprobarlos. Revisá esos montos antes de importar.')
  }

  return {
    kind: 'card',
    bank: 'naranjax',
    issuer: 'naranjax',
    statementId,
    accountRef,
    previousCloseDate,
    previousDueDate,
    closeDate,
    dueDate,
    nextCloseDate,
    nextDueDate,
    previousBalance,
    totalDue: { arsMinor: headerTotal, usdMinor: totalUsd },
    minimumPaymentArsMinor: amountOf(/PAGO MINIMO: \$\s*([\d.]+,\d\d)/, text),
    limits: {
      purchaseArsMinor: limitOf(/\bCompra: \$\s*(\d[\d.]*\d)/),
      financingArsMinor: limitOf(/L[íi]mite de Financiaci[óo]n: \$\s*(\d[\d.]*\d)/),
    },
    rates: { tnaArs: rate(financing?.[2]), tnaUsd: rate(usdRates?.[2]), temArs: rate(financing?.[1]), temUsd: rate(usdRates?.[1]) },
    cardTotals,
    transactions: txs,
    upcomingInstallments,
    integrity: summarize(checks),
    warnings,
  }
}
