import { describe, expect, it } from 'vitest'
import { parseGaliciaAccountXlsx } from '../../src/lib/statements/galicia/account-xlsx.js'
import { galiciaStyleXlsx, sampleAccountXlsx } from './helpers/galicia-xlsx.js'

describe('parseGaliciaAccountXlsx', () => {
  const s = parseGaliciaAccountXlsx(sampleAccountXlsx())

  it('reads the header', () => {
    expect(s.accountRef).toBe('1234567')
    expect(s.periodFrom).toBe('2026-09-01')
    expect(s.periodTo).toBe('2026-10-26')
    expect(s.generatedAt).toBe('2026-10-24')
  })

  it('returns movements oldest first with a consistent balance chain', () => {
    expect(s.transactions.map((t) => t.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-14', '2026-10-14', '2026-10-20', '2026-10-26'])
    expect(s.openingBalanceMinor).toBe(-100100000)
    expect(s.closingBalanceMinor).toBe(40000000)
    expect(s.integrity.ok).toBe(true)
  })

  it('keeps same-day order from the balance chain', () => {
    const sameDay = s.transactions.filter((t) => t.date === '2026-10-14')
    expect(sameDay.map((t) => t.kind)).toEqual(['transfer_out', 'purchase'])
  })

  it('classifies movements and extracts fields', () => {
    const byKind = Object.fromEntries(s.transactions.map((t) => [t.kind, t]))
    expect(byKind.salary).toMatchObject({ amountMinor: 118875000, counterparty: { name: 'ACME SA', taxId: '30711111111' } })
    expect(byKind.purchase).toMatchObject({ merchant: 'MERPAGO*OLLIEFOOD', amountMinor: -875000, currency: 'ARS' })
    expect(byKind.transfer_out).toMatchObject({ counterparty: { name: 'MARIA GOMEZ', taxId: '27222222223' } })
    expect(byKind.card_payment).toMatchObject({ cardIssuer: 'visa', amountMinor: -5000000 })
    expect(byKind.rebate).toMatchObject({ merchant: 'Uber', amountMinor: 100000 })
    expect(byKind.fx).toMatchObject({ fx: { side: 'sell', rate: 1495 }, amountMinor: 30000000 })
  })

  it('never stores the card number', () => {
    expect(JSON.stringify(s)).not.toMatch(/4517\d{6,}/)
  })

  it('warns about movements dated after the export date', () => {
    expect(s.warnings.join(' ')).toContain('2026-10-26')
  })

  it('has unique, deterministic ids', () => {
    const again = parseGaliciaAccountXlsx(sampleAccountXlsx())
    expect(again.transactions.map((t) => t.id)).toEqual(s.transactions.map((t) => t.id))
    expect(new Set(s.transactions.map((t) => t.id)).size).toBe(s.transactions.length)
  })

  it('flags a broken balance chain', () => {
    const rows = [
      ['Fecha', 'Movimiento', 'Débito', 'Crédito', 'Saldo Parcial', 'Comentarios'],
      ['02/10/2026', ' COMPRA DEBITO\n X\n', '-10,00', '0,00', '90,00', ''],
      ['01/10/2026', ' COMPRA DEBITO\n Y\n', '-10,00', '0,00', '100,00', ''],
    ]
    const broken = parseGaliciaAccountXlsx(galiciaStyleXlsx(rows))
    expect(broken.integrity.ok).toBe(true) // 100 -> 90 is consistent
    rows[1]![4] = '95,00'
    expect(parseGaliciaAccountXlsx(galiciaStyleXlsx(rows)).integrity.ok).toBe(false)
  })

  it('rejects files without the expected header', () => {
    expect(() => parseGaliciaAccountXlsx(galiciaStyleXlsx([['nope']]))).toThrow(/header/)
  })
})
