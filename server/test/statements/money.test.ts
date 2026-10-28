import { describe, expect, it } from 'vitest'
import { parseDashDate, parseDashMonthDate, parseMonthYear, parseSlashDate } from '../../src/lib/statements/dates.js'
import { parseArAmount } from '../../src/lib/statements/money.js'

describe('parseArAmount', () => {
  it.each([
    ['1.053.249,45', 105324945],
    ['-4.000,00', -400000],
    ['361552,35', 36155235], // balance column of the xlsx has no thousands separator
    ['2431.042,25', 243104225], // odd format printed in "SU PAGO EN PESOS" lines
    ['0,00', 0],
    ['$ 494.050,00', 49405000],
    ['7', 700],
    ['1,5', 150],
  ])('%s -> %i', (text, minor) => {
    expect(parseArAmount(text)).toBe(minor)
  })

  it('rejects garbage', () => {
    expect(() => parseArAmount('TC1520,000')).toThrow()
  })
})

describe('dates', () => {
  it('parses the formats used by the bank', () => {
    expect(parseSlashDate('26/10/2026')).toBe('2026-10-26')
    expect(parseSlashDate('29/09/25')).toBe('2025-09-29')
    expect(parseDashDate('17-01-26')).toBe('2026-01-17')
    expect(parseDashMonthDate('27-Ago-26')).toBe('2026-08-27')
    expect(parseMonthYear('Setiembre/26')).toBe('2026-09')
  })
})
