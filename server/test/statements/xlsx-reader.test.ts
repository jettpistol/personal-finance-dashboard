import { describe, expect, it } from 'vitest'
import { readFirstSheet } from '../../src/lib/statements/xlsx-reader.js'
import { galiciaStyleXlsx, standardXlsx } from './helpers/galicia-xlsx.js'

describe('readFirstSheet', () => {
  it('reads Galicia-style files (x: prefix, no cell refs, multi-line cells)', () => {
    const rows = readFirstSheet(galiciaStyleXlsx([['a', 'line1\nline2', ''], ['b', 'c', 'd']]))
    expect(rows).toEqual([['a', 'line1\nline2', ''], ['b', 'c', 'd']])
  })

  it('reads standard files (shared strings, inline strings, numbers, cell refs)', () => {
    expect(readFirstSheet(standardXlsx())).toEqual([
      ['hola', '', 'inline'],
      ['', '42', 'raro'],
    ])
  })
})
