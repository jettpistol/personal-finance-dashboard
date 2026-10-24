import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { Statement } from '../../domain/types'
import { extractPdfText } from '../pdf-text'
import { parseGaliciaAccountText } from './account-pdf'
import { parseGaliciaAccountXlsx } from './account-xlsx'
import { parseGaliciaCardText } from './card-text'

/** Picks the right parser for the text of a Galicia PDF. */
export function parseGaliciaText(text: string): Statement {
  const head = text.slice(0, 800)
  if (/Resumen de Caja de Ahorro/i.test(head)) return parseGaliciaAccountText(text)
  if (/Tarjeta Cr[eé]dito/i.test(head)) return parseGaliciaCardText(text)
  throw new Error('Unrecognised Galicia statement (expected Caja de Ahorro or Tarjeta Crédito)')
}

/** Parses a Galicia .xlsx extract or .pdf statement from disk. */
export async function parseGaliciaFile(path: string): Promise<Statement> {
  const ext = extname(path).toLowerCase()
  if (ext === '.xlsx') return parseGaliciaAccountXlsx(new Uint8Array(await readFile(path)))
  if (ext === '.pdf') return parseGaliciaText(await extractPdfText(path))
  throw new Error(`Unsupported file type "${ext}" (expected .xlsx or .pdf)`)
}

export { parseGaliciaAccountText, parseGaliciaAccountXlsx, parseGaliciaCardText }
