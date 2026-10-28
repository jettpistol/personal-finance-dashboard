import { createHash } from 'node:crypto'

/**
 * Parses an Argentine-formatted amount into integer minor units.
 * Accepts "1.234,56", "-4.000,00", "361552,35" (no thousands separator) and "2431.042,25".
 */
export function parseArAmount(text: string): number {
  const s = text.replace(/[$\s]/g, '')
  const m = /^(-)?(\d+(?:\.\d{3})*)(?:,(\d{1,2}))?$/.exec(s)
  if (!m) throw new Error(`Invalid amount: "${text}"`)
  const [, sign, int, frac] = m
  const minor = Number(int!.replace(/\./g, '')) * 100 + Number((frac ?? '').padEnd(2, '0'))
  return sign ? -minor : minor
}

export function stableId(...parts: Array<string | number | null | undefined>): string {
  return createHash('sha1')
    .update(parts.map((p) => String(p ?? '')).join('|'))
    .digest('hex')
    .slice(0, 16)
}
