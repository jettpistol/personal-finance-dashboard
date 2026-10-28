import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseGaliciaCardText } from '../../src/lib/statements/galicia/card-text.js'

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('Visa statement', () => {
  const s = parseGaliciaCardText(read('visa.layout.txt'))
  const find = (re: RegExp, currency = 'ARS') => s.transactions.find((t) => re.test(t.description) && t.currency === currency)!

  it('reads the statement header', () => {
    expect(s).toMatchObject({
      issuer: 'visa',
      accountRef: '0001',
      previousCloseDate: '2026-08-27',
      closeDate: '2026-10-01',
      dueDate: '2026-10-09',
      nextCloseDate: '2026-10-29',
      nextDueDate: '2026-11-11',
      minimumPaymentArsMinor: 2000000,
      limits: { purchaseArsMinor: 500000000, financingArsMinor: 450000000 },
      rates: { tnaArs: 80.28, tnaUsd: 20, temArs: 6.598, temUsd: 1.644 },
      previousBalance: { arsMinor: 10000000, usdMinor: 1000 },
      totalDue: { arsMinor: 17100050, usdMinor: 419 },
    })
  })

  it('reconciles with the printed total in both currencies', () => {
    expect(s.integrity.checks.map((c) => [c.name, c.ok])).toEqual([
      ['total-due-ARS', true],
      ['card-totals-ARS', true],
      ['total-due-USD', true],
      ['card-totals-USD', true],
    ])
    expect(s.integrity.ok).toBe(true)
  })

  it('flips signs: charges are negative, refunds and payments positive', () => {
    expect(find(/UBER/).amountMinor).toBe(-2000000)
    expect(find(/MC2025/)).toMatchObject({ kind: 'refund', amountMinor: 900000 })
    expect(find(/SU PAGO/)).toMatchObject({ kind: 'card_payment', amountMinor: 6000000 })
  })

  it('keeps USD charges in USD, untouched', () => {
    expect(find(/Google One/, 'USD')).toMatchObject({ amountMinor: -299, currency: 'USD', merchant: 'GOOGLE *Google One USD 2,99' })
    expect(find(/LinkedIn/, 'USD')).toMatchObject({ amountMinor: -120, flag: 'F' })
    expect(s.transactions.filter((t) => /Google One|LinkedIn/.test(t.description)).every((t) => t.currency === 'USD')).toBe(true)
  })

  it('reads installments as "cuota X de Y" and keeps the purchase date', () => {
    expect(find(/MERCADOLIBRE/)).toMatchObject({ installment: { number: 9, total: 9 }, date: '2026-01-17', amountMinor: -800000 })
    expect(find(/LEDBASRL/).installment).toEqual({ number: 2, total: 3 })
    expect(find(/UBER/).installment).toBeNull()
  })

  it('stores the marker before the merchant as an opaque flag', () => {
    expect(find(/MERCADOLIBRE/).flag).toBe('*')
    expect(find(/UBER/).flag).toBe('K')
    expect(find(/LinkedIn/, 'USD').flag).toBe('F')
    expect(find(/Google One/, 'USD').flag).toBeNull()
  })

  it('attributes purchases to the physical card (couple with an additional card)', () => {
    expect(s.cardTotals).toEqual([
      { last4: '1111', holder: 'JUAN PEREZ', arsMinor: 7878050, usdMinor: 419 },
      { last4: '2222', holder: 'MARIA GOMEZ', arsMinor: 1200000, usdMinor: 0 },
    ])
    expect(find(/UBER/).cardLast4).toBe('1111')
    expect(find(/FARMACITY/).cardLast4).toBe('2222')
    expect(find(/CINE HOYTS/).cardLast4).toBe('2222')
  })

  it('names charges without the base they are computed on', () => {
    const names = s.transactions.filter((t) => t.date === '2026-10-01').map((t) => t.description)
    expect(names).toEqual(['IMPUESTO DE SELLOS', 'INTERESES FINANCIACION', 'DB IVA 21%', 'IIBB PERCEP-BSAS 2,00%( 1000,00)'])
  })

  it('separates interest, taxes and fees', () => {
    const charges = s.transactions.filter((t) => t.date === '2026-10-01')
    expect(charges.map((t) => [t.kind, t.amountMinor])).toEqual([
      ['tax', -100000],
      ['interest', -2000000],
      ['tax', -420000],
      ['tax', -2000],
    ])
  })

  it('turns the USD debt transfer into two offsetting lines', () => {
    const transfer = s.transactions.filter((t) => t.kind === 'debt_transfer')
    expect(transfer.map((t) => [t.currency, t.amountMinor])).toEqual([['ARS', -1500000], ['USD', 1000]])
  })

  it('reads the committed future installments', () => {
    expect(s.upcomingInstallments).toEqual([
      { month: '2026-10', arsMinor: 1000000 },
      { month: '2026-11', arsMinor: 500000 },
      { month: '2026-12', arsMinor: 0 },
      { month: '2027-01', arsMinor: 0 },
      { month: '2027-02', arsMinor: 0 },
      { month: '2027-03', arsMinor: 0 },
    ])
  })

  it('records the close date of the statement that billed each purchase', () => {
    expect(find(/UBER/).statementCloseDate).toBe('2026-10-01')
  })

  it('has unique, deterministic ids', () => {
    const again = parseGaliciaCardText(read('visa.layout.txt'))
    expect(again.transactions.map((t) => t.id)).toEqual(s.transactions.map((t) => t.id))
    expect(new Set(s.transactions.map((t) => t.id)).size).toBe(s.transactions.length)
  })

  it('never exposes the full account number', () => {
    expect(JSON.stringify(s)).not.toContain('9999990001')
  })
})

describe('American Express statement', () => {
  const s = parseGaliciaCardText(read('amex.layout.txt'))

  it('is detected and reconciles', () => {
    expect(s.issuer).toBe('amex')
    expect(s.minimumPaymentArsMinor).toBe(0)
    expect(s.integrity.ok).toBe(true)
    expect(s.totalDue).toEqual({ arsMinor: 11160632, usdMinor: 699 })
  })

  it('handles credits in the consolidated block and a payment covering both currencies', () => {
    const payments = s.transactions.filter((t) => t.kind === 'card_payment')
    expect(payments.map((t) => [t.currency, t.amountMinor])).toEqual([['ARS', 5000000], ['USD', 699]])
    expect(s.transactions.find((t) => /COTO/.test(t.description) && t.kind === 'refund')?.amountMinor).toBe(100000)
  })

  it('reads old installment plans and lines without a marker', () => {
    expect(s.transactions.find((t) => /SOLO DEPORTES/.test(t.description))).toMatchObject({
      installment: { number: 18, total: 18 },
      date: '2025-03-15',
    })
    expect(s.transactions.find((t) => /APPLE/.test(t.description))).toMatchObject({ currency: 'USD', flag: null })
  })

  it('reads "Setiembre" in the upcoming installments', () => {
    expect(s.upcomingInstallments[0]).toEqual({ month: '2026-09', arsMinor: 1381933 })
  })
})

describe('integrity', () => {
  it('fails loudly when the statement does not add up', () => {
    const tampered = read('visa.layout.txt').replace(/(TOTAL A PAGAR\s+)171\.000,50/, '$1171.999,50')
    expect(parseGaliciaCardText(tampered).integrity.ok).toBe(false)
  })
})
