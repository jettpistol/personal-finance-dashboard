import { parseSlashDate } from '../dates.js'
import { parseArAmount } from '../money.js'
import type { AccountStatement, SourceRef } from '../types.js'
import { buildAccountTransaction } from './account-movement.js'
import { readFirstSheet } from '../xlsx-reader.js'
import { checkBalanceChain, summarize } from './integrity.js'

/**
 * Parses the "Extracto" spreadsheet exported from Galicia home banking (Caja de Ahorro).
 * Every cell is text, Débito/Crédito use "1.234,56" while Saldo uses "361552,35",
 * and rows come newest-first, so the order is normalised here.
 */
export function parseGaliciaAccountXlsx(data: Uint8Array): AccountStatement {
  const sheet = readFirstSheet(data)
  const headerRow = sheet.findIndex((r) => r[0]?.trim() === 'Fecha' && /Movimiento/.test(r[1] ?? ''))
  if (headerRow === -1) throw new Error('Could not find the Fecha/Movimiento header row')
  const meta = sheet.slice(0, headerRow).map((r) => r[0] ?? '')

  const metaText = meta.join('\n')
  const accountRef = /Nro\. de Cuenta:\s*\.*\s*(\d+)/.exec(metaText)?.[1] ?? 'unknown'
  const interval = /del\s+(\d{2}\/\d{2}\/\d{4})\s+al\s+(\d{2}\/\d{2}\/\d{4})/.exec(metaText)
  const generated = /Fecha Actual:\s*(\d{2}\/\d{2}\/\d{4})/.exec(metaText)?.[1]
  const source: SourceRef = { bank: 'galicia', product: 'account', accountRef }

  const rows: Array<{ date: string; lines: string[]; amountMinor: number; balanceAfterMinor: number }> = []
  for (const cells of sheet.slice(headerRow + 1)) {
    const dateText = cells[0]?.trim()
    if (!dateText) continue
    const debit = parseArAmount(cells[2]?.trim() || '0')
    const credit = parseArAmount(cells[3]?.trim() || '0')
    rows.push({
      date: parseSlashDate(dateText),
      lines: (cells[1] ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
      amountMinor: credit !== 0 ? credit : -Math.abs(debit),
      balanceAfterMinor: parseArAmount(cells[4] ?? ''),
    })
  }

  // Newest-first in the export: reverse so the balance chain reads forwards.
  // Same-day order is preserved by the reversal (the chain is the only reliable tie-breaker).
  if (rows.length > 1 && rows[0]!.date > rows[rows.length - 1]!.date) rows.reverse()

  const transactions = rows.map((r) => buildAccountTransaction({ ...r, source }))
  const first = transactions[0]
  const openingBalanceMinor = first ? first.balanceAfterMinor! - first.amountMinor : 0
  const closingBalanceMinor = transactions.at(-1)?.balanceAfterMinor ?? openingBalanceMinor

  const warnings: string[] = []
  const generatedAt = generated ? parseSlashDate(generated) : null
  const future = generatedAt ? transactions.filter((t) => t.date > generatedAt) : []
  if (future.length) warnings.push(`${future.length} movement(s) dated after the export date ${generatedAt}: ${future.map((t) => t.date).join(', ')}`)
  const firstDate = transactions[0]?.date
  const periodFrom = interval ? parseSlashDate(interval[1]!) : null
  if (firstDate && periodFrom && firstDate > periodFrom) {
    warnings.push(`Export says it starts ${periodFrom} but the first movement is ${firstDate}`)
  }

  return {
    kind: 'account',
    bank: 'galicia',
    accountRef,
    currency: 'ARS',
    periodFrom,
    periodTo: interval ? parseSlashDate(interval[2]!) : null,
    generatedAt,
    openingBalanceMinor,
    closingBalanceMinor,
    transactions,
    integrity: summarize([checkBalanceChain(openingBalanceMinor, transactions)]),
    warnings,
  }
}
