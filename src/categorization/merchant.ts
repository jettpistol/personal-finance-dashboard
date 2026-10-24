/** Upper-case, accent-free, punctuation turned into single spaces: "PAYU*AR*UBER" -> "PAYU AR UBER". */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

// Payment-processor prefixes that card/bank statements glue in front of the merchant.
const PROCESSOR_TOKENS = new Set(['MERPAGO', 'MERCADOPAGO', 'PAYU', 'AR', 'PVS', 'DLO', 'CP', 'EBN', 'PAYPAL', 'PROPINA'])

/**
 * Stable key for a merchant, used to store manual category overrides:
 * "PAYU*AR*UBER", "PAYU-UBER 828987" and "UBER TRIP" all map to "UBER" / "UBER TRIP" style keys
 * without processor prefixes or trailing reference numbers.
 */
export function merchantKey(merchant: string): string {
  const tokens = normalizeText(merchant).split(' ').filter(Boolean)
  while (tokens.length > 1 && PROCESSOR_TOKENS.has(tokens[0]!)) tokens.shift()
  while (tokens.length > 1 && /^\d{4,}$/.test(tokens[tokens.length - 1]!)) tokens.pop()
  return tokens.join(' ')
}
