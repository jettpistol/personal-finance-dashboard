import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseNaranjaXCardText } from '../../src/lib/statements/naranjax/card-text.js'
import { statementRows } from '../../src/lib/statements/rows.js'

const fixture = readFileSync(new URL('./fixtures/naranjax.layout.txt', import.meta.url), 'utf8')

describe('Naranja X statement', () => {
  const s = parseNaranjaXCardText(fixture)
  const find = (re: RegExp) => s.transactions.find((t) => re.test(t.description))!

  it('reads the header, placing dates without a year around the due date', () => {
    expect(s).toMatchObject({
      bank: 'naranjax',
      issuer: 'naranjax',
      statementId: '10000001',
      accountRef: '3456',
      previousCloseDate: '2026-09-27',
      previousDueDate: '2026-10-10',
      closeDate: '2026-10-27',
      dueDate: '2026-11-10',
      nextCloseDate: '2026-11-27',
      nextDueDate: '2026-12-10',
      previousBalance: { arsMinor: 5230000, usdMinor: 0 },
      totalDue: { arsMinor: 11874888, usdMinor: 0 },
      minimumPaymentArsMinor: 4160000,
      limits: { purchaseArsMinor: 56788600, financingArsMinor: 51109700 },
      rates: { tnaArs: 78.94, temArs: 6.57, tnaUsd: 20.4, temUsd: 1.7 },
      cardTotals: [{ last4: '', holder: 'MILAGROS PEREZ', arsMinor: 11480990, usdMinor: 0 }],
    })
    expect(s.warnings).toEqual([])
  })

  it('reconciles with its own totals', () => {
    expect(s.integrity.checks.map((c) => [c.name, c.ok])).toEqual([
      ['total-due-ARS', true],
      ['card-totals-ARS', true],
      ['detail-total', true],
    ])
  })

  it('reads every line: purchases, account charges, other charges and the payment', () => {
    expect(s.transactions.map((t) => [t.kind, t.amountMinor])).toEqual([
      ['purchase', -3812050],
      ['interest', -85040],
      ['purchase', -2130000],
      ['purchase', -900000],
      ['purchase', -150000],
      ['purchase', -2499900],
      ['purchase', -780000],
      ['fee', -1124000],
      ['tax', -253898],
      ['tax', -140000],
      ['card_payment', 5230000],
    ])
  })

  it('keeps which card made each purchase', () => {
    expect(find(/COTO/)).toMatchObject({ cardName: 'NX Virtual', merchant: 'COTO 92', date: '2026-10-25' })
    expect(find(/MC DONALDS/).cardName).toBe('NX Master')
    expect(find(/PLAN TURBO/)).toMatchObject({ cardName: null, flag: '*', merchant: null })
  })

  it('reads installments; "01" is a single payment', () => {
    expect(find(/FARMASELMA/).installment).toEqual({ number: 1, total: 3 })
    expect(find(/COTO/).installment).toBeNull()
    expect(s.upcomingInstallments.slice(0, 2)).toEqual([
      { month: '2026-12', arsMinor: 900000 },
      { month: '2027-01', arsMinor: 900000 },
    ])
  })

  it('takes the IVA amount, not its tax base', () => {
    expect(find(/^IVA/)).toMatchObject({ amountMinor: -253898, date: '2026-10-27' })
  })

  it('becomes review rows: card in the note, installment on the close date, payment unticked', () => {
    const rows = statementRows(s)
    const cuota = rows.find((r) => /FARMASELMA/.test(r.description))!
    expect(cuota).toMatchObject({ date: '2026-10-27', description: 'MERPAGO*FARMASELMA (cuota 1/3)' })
    expect(cuota.notes).toBe('Tarjeta NX Master. Cuota 1 de 3, compra del 18/10/2026')
    expect(rows.find((r) => /PAGO EN PESOS/.test(r.description))).toMatchObject({ include: false, type: 'transfer' })
    expect(rows.find((r) => /INTERES/.test(r.description))?.categoryPath).toBe('Impuestos y comisiones > Intereses de tarjeta')
  })

  it('gives the same ids when read twice', () => {
    expect(parseNaranjaXCardText(fixture).transactions.map((t) => t.id)).toEqual(s.transactions.map((t) => t.id))
  })
})

describe('Naranja X statement variants', () => {
  // Inserts a line right after the COTO purchase, keeping the column layout.
  const withLine = (line: string, text = fixture) => text.replace(/(.*COTO 92.*\n)/, `$1${line}\n`)
  const purchase = (detail: string, plan: string, amount: string, column: 'ARS' | 'USD' = 'ARS') => {
    const left = `             24/10/26 NX Visa       1234 ${detail}`.padEnd(100) + plan.padStart(5)
    return column === 'ARS' ? left + amount.padStart(17) : left + ' '.repeat(17) + amount.padStart(11)
  }
  const bump = (text: string, from: string, to: string) => text.split(from).join(to)

  it('keeps a dollar purchase in dollars and warns that there is no dollar total to check it', () => {
    const s = parseNaranjaXCardText(withLine(purchase('NETFLIX.COM', '01', '9,99', 'USD')))
    expect(s.transactions.find((t) => /NETFLIX/.test(t.description))).toMatchObject({ currency: 'USD', amountMinor: -999, cardName: 'NX Visa' })
    expect(s.integrity.ok).toBe(true)
    expect(s.totalDue.usdMinor).toBe(999)
    expect(s.warnings[0]).toMatch(/dólares/)
  })

  it('reads a negative line as a refund', () => {
    let text = withLine(purchase('DEVOLUCION COTO', '01', '-1.000,00'))
    text = bump(text, '114.809,90', '113.809,90')
    text = bump(text, '118.748,88', '117.748,88')
    const s = parseNaranjaXCardText(text)
    expect(s.transactions.find((t) => /DEVOLUCION/.test(t.description))).toMatchObject({ kind: 'refund', amountMinor: 100000 })
    expect(s.integrity.ok).toBe(true)
  })

  it('warns about a plan it does not know and imports it as a single payment', () => {
    let text = withLine(purchase('FRAVEGA', 'Z', '1.000,00'))
    text = bump(text, '114.809,90', '115.809,90')
    text = bump(text, '118.748,88', '119.748,88')
    const s = parseNaranjaXCardText(text)
    expect(s.transactions.find((t) => /FRAVEGA/.test(t.description))?.installment).toBeNull()
    expect(s.warnings).toEqual(['Plan «Z» en «FRAVEGA»: se importa como una compra en un pago.'])
  })

  it('checks each holder block on its own', () => {
    const extra = [
      '             Consumos tarjeta de crédito de Ivan',
      '             $ 2.000,00',
      '             IVAN PEREZ, Adicional',
      purchase('KIOSCO', '01', '2.000,00'),
    ].join('\n')
    let text = fixture.replace(/(\n\s*\n\s*Otros )/, `\n${extra}$1`)
    text = bump(text, '118.748,88', '120.748,88')
    const s = parseNaranjaXCardText(text)
    expect(s.cardTotals.map((c) => [c.holder, c.arsMinor])).toEqual([
      ['MILAGROS PEREZ', 11480990],
      ['IVAN PEREZ', 200000],
    ])
    expect(s.integrity.ok).toBe(true)
  })

  it('tolerates text sitting a column or two off its header', () => {
    for (const pad of ['  ', '   ']) {
      const s = parseNaranjaXCardText(fixture.replace(/^(\s+\d{2}\/\d{2}\/\d{2}) /gm, `$1${pad}`))
      expect(s.integrity.ok).toBe(true)
      expect(s.transactions.slice(0, 4).map((t) => [t.cardName, t.description, t.installment?.total ?? null])).toEqual([
        ['NX Virtual', 'COTO 92', null],
        [null, 'INTERES POR MORA CONSUMOS EN PESOS', null],
        ['NX Master', 'MC DONALDS MA2', null],
        ['NX Master', 'MERPAGO*FARMASELMA', 3],
      ])
    }
  })

  it('fails the checks when a line is misread', () => {
    const s = parseNaranjaXCardText(fixture.replace('38.120,50', '38.120,51'))
    expect(s.integrity.ok).toBe(false)
    expect(s.integrity.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['total-due-ARS', 'card-totals-ARS'])
  })

  it('rejects other documents', () => {
    expect(() => parseNaranjaXCardText('Resumen de Caja de Ahorro')).toThrow(/Not a Naranja X/)
  })
})
