import { describe, expect, it } from 'vitest'
import { readFirstSheet } from '../src/parsing/xlsx-reader'
import { galiciaStyleXlsx, standardXlsx } from './helpers/galicia-xlsx'

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
