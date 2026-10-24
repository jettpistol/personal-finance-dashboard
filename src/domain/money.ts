import { createHash } from 'node:crypto'
import type { Currency } from './types'

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

export function formatMinor(minor: number, currency: Currency = 'ARS'): string {
  const abs = Math.abs(minor)
  const int = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const frac = String(abs % 100).padStart(2, '0')
  const symbol = currency === 'USD' ? 'US$' : '$'
  return `${minor < 0 ? '-' : ''}${symbol}${int},${frac}`
}

export function stableId(...parts: Array<string | number | null | undefined>): string {
  return createHash('sha1')
    .update(parts.map((p) => String(p ?? '')).join('|'))
    .digest('hex')
    .slice(0, 16)
}
