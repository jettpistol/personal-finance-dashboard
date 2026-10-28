import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

/**
 * Minimal .xlsx reader returning the first sheet as rows of strings.
 *
 * Galicia's "Extracto" export is not a standard Excel file: it uses an `x:` namespace prefix,
 * has no cell references (`r="B7"`), no shared strings, and every cell is `t="str"`.
 * ExcelJS refuses to open it, so this reader copes with that and with the usual layouts
 * (shared strings, inline strings, numbers, cell references).
 */
export function readFirstSheet(data: Uint8Array): string[][] {
  const files = unzipSync(data)
  const sheetPath = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p))
    .sort()[0]
  if (!sheetPath) throw new Error('No worksheet found in the .xlsx file')

  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false, // keep "0,00" and "26/10/2026" as text
    trimValues: false, // keep the line breaks of multi-line cells
    isArray: (name) => ['row', 'c', 'si', 'r'].includes(name),
  })

  const sharedPath = 'xl/sharedStrings.xml'
  const shared: string[] = files[sharedPath]
    ? (parser.parse(strFromU8(files[sharedPath])).sst?.si ?? []).map((si: unknown) => richText(si))
    : []

  const sheet = parser.parse(strFromU8(files[sheetPath]!))
  const rows: Array<{ r: number; cells: string[] }> = []
  for (const row of sheet.worksheet?.sheetData?.row ?? []) {
    const cells: string[] = []
    let position = 0
    for (const c of row.c ?? []) {
      const ref = /^([A-Z]+)\d+$/.exec(c['@_r'] ?? '')
      const col = ref ? columnIndex(ref[1]!) : position
      cells[col] = cellValue(c, shared)
      position = col + 1
    }
    rows.push({ r: Number(row['@_r'] ?? rows.length + 1), cells: Array.from(cells, (v) => v ?? '') })
  }
  return rows.sort((a, b) => a.r - b.r).map((r) => r.cells)
}

function cellValue(c: Record<string, unknown>, shared: string[]): string {
  const type = c['@_t']
  if (type === 'inlineStr') return richText(c.is)
  const v = c.v
  const text = typeof v === 'string' ? v : v == null ? '' : String((v as { '#text'?: string })['#text'] ?? '')
  return type === 's' ? (shared[Number(text)] ?? '') : text
}

/** Text of an <is>/<si> element: either <t> or several <r><t> runs. */
function richText(node: unknown): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  const n = node as { t?: unknown; r?: Array<{ t?: unknown }> }
  if (n.r?.length) return n.r.map((run) => richText(run.t)).join('')
  if (typeof n.t === 'object' && n.t) return String((n.t as { '#text'?: string })['#text'] ?? '')
  return typeof n.t === 'string' ? n.t : ''
}

function columnIndex(letters: string): number {
  return [...letters].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1
}
