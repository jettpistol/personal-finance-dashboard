import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseGaliciaAccountText } from '../../src/lib/statements/galicia/account-pdf.js'

const text = readFileSync(new URL('./fixtures/account.layout.txt', import.meta.url), 'utf8')

describe('parseGaliciaAccountText', () => {
  const s = parseGaliciaAccountText(text)

  it('parses every movement and reconciles with the printed totals', () => {
    expect(s.transactions).toHaveLength(9)
    expect(s.integrity.checks.map((c) => c.name)).toEqual(['balance-chain', 'total-credits', 'total-debits', 'closing-balance'])
    expect(s.integrity.ok).toBe(true)
    expect(s.openingBalanceMinor).toBe(10000000)
    expect(s.closingBalanceMinor).toBe(47543960)
    expect(s.accountRef).toBe('6781391')
    expect(s.periodFrom).toBe('2025-09-26')
    expect(s.periodTo).toBe('2025-10-31')
  })

  it('joins labels the PDF wraps over two lines', () => {
    const own = s.transactions.find((t) => t.description === 'TRANSFERENCIA DE CUENTA PROPIA')
    expect(own).toMatchObject({ kind: 'own_transfer', counterparty: { name: 'JUAN PEREZ', taxId: '20111111112' } })
    const reversal = s.transactions.find((t) => t.description === 'ANULACION REINTEGRO PROMO GALICIA')
    expect(reversal).toMatchObject({ kind: 'rebate', merchant: 'Uber', amountMinor: -100000 })
  })

  it('recognises card payments, including store cards paid with the debit card', () => {
    const payments = s.transactions.filter((t) => t.kind === 'card_payment')
    expect(payments.map((t) => t.cardIssuer)).toEqual(['visa', 'other'])
  })

  it('detects a statement that does not add up', () => {
    const tampered = text.replace('-$ 675.560,40', '-$ 675.560,41')
    expect(parseGaliciaAccountText(tampered).integrity.ok).toBe(false)
  })
})
