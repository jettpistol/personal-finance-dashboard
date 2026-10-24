import type { Transaction } from '../domain/types'
import type { CategoryId } from './categories'
import { merchantKey, normalizeText } from './merchant'
import { DEFAULT_RULES, type Rule } from './rules'

export interface CategorizeOptions {
  rules?: Rule[]
  /** Manual choices, keyed by merchantKey(). They always win over rules. */
  overrides?: Record<string, CategoryId>
}

export interface CategoryResult {
  category: CategoryId | null
  source: 'override' | 'rule' | 'kind' | null
}

const NONE: CategoryResult = { category: null, source: null }

interface Prepared {
  category: CategoryId
  words: string[]
  contains: string[]
}

const preparedCache = new WeakMap<Rule[], Prepared[]>()

function prepare(rules: Rule[]): Prepared[] {
  let p = preparedCache.get(rules)
  if (!p) {
    p = rules.map((r) => ({
      category: r.category,
      words: (r.words ?? []).map((w) => ` ${normalizeText(w)} `),
      contains: (r.contains ?? []).map((c) => normalizeText(c).replace(/ /g, '')),
    }))
    preparedCache.set(rules, p)
  }
  return p
}

/** Category for a merchant string alone (no transaction context). */
export function categorizeMerchant(merchant: string, options: CategorizeOptions = {}): CategoryResult {
  const override = options.overrides?.[merchantKey(merchant)]
  if (override) return { category: override, source: 'override' }

  const text = normalizeText(merchant)
  const padded = ` ${text} `
  const squashed = text.replace(/ /g, '')
  for (const rule of prepare(options.rules ?? DEFAULT_RULES)) {
    if (rule.words.some((w) => padded.includes(w)) || rule.contains.some((c) => squashed.includes(c))) {
      return { category: rule.category, source: 'rule' }
    }
  }
  return NONE
}

/**
 * Spending category for a transaction.
 * - Purchases, refunds and promo rebates are classified by merchant, so a refund lands in
 *   the same category as the purchase it cancels.
 * - Transfers, salary, card payments, etc. are not spending: they stay null.
 * - Cash withdrawals and bank charges get a fixed category from their kind.
 */
export function categorize(tx: Transaction, options: CategorizeOptions = {}): CategoryResult {
  switch (tx.kind) {
    case 'purchase':
    case 'refund':
    case 'rebate':
      return tx.merchant ? categorizeMerchant(tx.merchant, options) : NONE
    case 'cash_withdrawal':
      return { category: 'cash', source: 'kind' }
    case 'tax':
    case 'fee':
      return { category: 'financial_costs', source: 'kind' }
    case 'interest':
      // Interest earned on the account is income; interest charged on a card is a cost.
      return tx.amountMinor < 0 ? { category: 'financial_costs', source: 'kind' } : NONE
    default:
      return NONE
  }
}
