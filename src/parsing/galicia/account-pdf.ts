import { parseSlashDate } from '../../domain/dates'
import { parseArAmount } from '../../domain/money'
import type { AccountStatement, IntegrityCheck, SourceRef } from '../../domain/types'
import { buildAccountTransaction } from './account-movement'
import { checkBalanceChain, summarize } from './integrity'

const ROW = /^(\d{2}\/\d{2}\/\d{2})\s{2,}(.+?)\s{2,}(?:(\d{4})\s+)?(-?[\d.]+,\d\d)\s+(-?[\d.]+,\d\d)\s*$/
// The PDF wraps long labels onto a second line ("TRANSFERENCIA DE CUENTA" / "PROPIA").
const WRAPPED_LABEL = new Set(['PROPIA', 'GALICIA'])

/**
 * Parses the monthly "Resumen de Caja de Ahorro en Pesos" PDF, given the output of
 * `pdftotext -layout`. Fallback for when the xlsx export is not available.
 */
export function parseGaliciaAccountText(text: string): AccountStatement {
  const lines = text.split(/\r?\n/)
  const accountRef = /N°\s*(\d{7})-(\d)\s+(\d{3})-(\d)/.exec(text)
  const ref = accountRef ? accountRef.slice(1).join('') : 'unknown'
  const source: SourceRef = { bank: 'galicia', product: 'account', accountRef: ref.slice(-7) }
  const period = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+\$?\s*([\d.]+,\d\d)/.exec(text)

  const rows: Array<{ date: string; lines: string[]; amountMinor: number; balanceAfterMinor: number }> = []
  for (let i = 0; i < lines.length; i++) {
    const m = ROW.exec(lines[i]!)
    if (!m) continue
    const detail: string[] = [m[2]!.trim()]
    for (let j = i + 1; j < lines.length && lines[j]!.trim() !== ''; j++) detail.push(lines[j]!.trim())
    if (detail[1] && WRAPPED_LABEL.has(detail[1])) detail.splice(0, 2, `${detail[0]} ${detail[1]}`)
    rows.push({
      date: parseSlashDate(m[1]!),
      lines: detail,
      amountMinor: parseArAmount(m[4]!),
      balanceAfterMinor: parseArAmount(m[5]!),
    })
  }

  const transactions = rows.map((r) => buildAccountTransaction({ ...r, source }))
  const first = transactions[0]
  const openingBalanceMinor = first ? first.balanceAfterMinor! - first.amountMinor : 0
  const closingBalanceMinor = transactions.at(-1)?.balanceAfterMinor ?? openingBalanceMinor

  const checks: IntegrityCheck[] = [checkBalanceChain(openingBalanceMinor, transactions)]
  const total = /^\s*Total\s+\$?\s*([\d.]+,\d\d)\s+-\$?\s*([\d.]+,\d\d)\s+\$?\s*([\d.]+,\d\d)/m.exec(text)
  if (total) {
    const credits = transactions.filter((t) => t.amountMinor > 0).reduce((s, t) => s + t.amountMinor, 0)
    const debits = transactions.filter((t) => t.amountMinor < 0).reduce((s, t) => s - t.amountMinor, 0)
    checks.push(
      { name: 'total-credits', ok: credits === parseArAmount(total[1]!), expected: parseArAmount(total[1]!), actual: credits },
      { name: 'total-debits', ok: debits === parseArAmount(total[2]!), expected: parseArAmount(total[2]!), actual: debits },
      { name: 'closing-balance', ok: closingBalanceMinor === parseArAmount(total[3]!), expected: parseArAmount(total[3]!), actual: closingBalanceMinor },
    )
  }

  return {
    kind: 'account',
    bank: 'galicia',
    accountRef: source.accountRef,
    currency: 'ARS',
    periodFrom: period ? parseSlashDate(period[1]!) : null,
    periodTo: period ? parseSlashDate(period[2]!) : null,
    generatedAt: null,
    openingBalanceMinor,
    closingBalanceMinor,
    transactions,
    integrity: summarize(checks),
    warnings: transactions.length === 0 ? ['No movements found: is this a Caja de Ahorro statement?'] : [],
  }
}
