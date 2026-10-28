export type Currency = 'ARS' | 'USD'

/**
 * Sign convention (always from the household's point of view):
 * negative = money out / expense, positive = money in / refund / payment received.
 * Card statements print charges as positive numbers; the parsers flip them.
 */
export type TransactionKind =
  | 'purchase'
  | 'refund'
  | 'rebate' // bank promo cashback (and its reversal, which is negative)
  | 'salary'
  | 'transfer_in'
  | 'transfer_out'
  | 'own_transfer' // bank-declared transfer between the holder's own accounts
  | 'card_payment' // paying a credit card (account side) or the payment line (card side)
  | 'direct_debit'
  | 'cash_withdrawal'
  | 'fx'
  | 'interest'
  | 'tax'
  | 'fee'
  | 'debt_transfer' // card statement moving a USD balance into ARS
  | 'other'

export type Bank = 'galicia'
export type CardIssuer = 'visa' | 'amex'
export type Product = 'account' | CardIssuer

export interface SourceRef {
  bank: Bank
  product: Product
  /** Last digits of the account/card-account number. Never the full number. */
  accountRef: string
}

export interface Counterparty {
  name: string | null
  /** CUIL/CUIT, digits only (11). */
  taxId: string | null
}

export interface Installment {
  number: number
  total: number
}

export interface Transaction {
  /** Deterministic: re-importing the same statement yields the same ids. */
  id: string
  source: SourceRef
  /** ISO date (YYYY-MM-DD). For card installments this is the original purchase date. */
  date: string
  /** Card transactions only: close date of the statement that billed it (ISO). */
  statementCloseDate: string | null
  /** Integer minor units (cents). */
  amountMinor: number
  currency: Currency
  kind: TransactionKind
  /** Bank's own label, e.g. "COMPRA DEBITO" or the card statement reference. */
  description: string
  /** Where the money went / came from, when the bank tells us. Used for categorisation. */
  merchant: string | null
  counterparty: Counterparty | null
  installment: Installment | null
  /** Account only: balance after this movement. */
  balanceAfterMinor: number | null
  /** Card only: the raw marker printed before the merchant ("*", "K", "F"). Meaning unknown. */
  flag: string | null
  /** For kind='card_payment' on the account side: which card was paid. */
  cardIssuer: CardIssuer | 'other' | null
  /** Card only: last 4 digits of the physical card that made the purchase. */
  cardLast4: string | null
  /** Rate printed by the bank, stored as information only; amounts are never converted. */
  fx: { side: 'buy' | 'sell'; rate: number } | null
  /** Original text, for debugging and for future re-parsing. */
  raw: string
}

export interface IntegrityCheck {
  name: string
  ok: boolean
  expected?: number
  actual?: number
  detail?: string
}

export interface Integrity {
  ok: boolean
  checks: IntegrityCheck[]
}

export interface AccountStatement {
  kind: 'account'
  bank: Bank
  accountRef: string
  currency: Currency
  periodFrom: string | null
  periodTo: string | null
  generatedAt: string | null
  openingBalanceMinor: number
  closingBalanceMinor: number
  /** Chronological (oldest first). */
  transactions: Transaction[]
  integrity: Integrity
  warnings: string[]
}

export interface CurrencyPair {
  arsMinor: number
  usdMinor: number
}

export interface CardStatement {
  kind: 'card'
  bank: Bank
  issuer: CardIssuer
  statementId: string
  accountRef: string
  previousCloseDate: string | null
  previousDueDate: string | null
  closeDate: string
  dueDate: string
  nextCloseDate: string | null
  nextDueDate: string | null
  previousBalance: CurrencyPair
  /** "TOTAL A PAGAR". */
  totalDue: CurrencyPair
  minimumPaymentArsMinor: number | null
  limits: { purchaseArsMinor: number | null; financingArsMinor: number | null }
  /** Percentages as printed: nominal annual and effective monthly rate. */
  rates: { tnaArs: number | null; tnaUsd: number | null; temArs: number | null; temUsd: number | null }
  /** "Total Consumos" per physical card (the holder, plus additional cards if any). */
  cardTotals: Array<{ last4: string; holder: string; arsMinor: number; usdMinor: number }>
  transactions: Transaction[]
  /** "Cuotas a vencer": installments already committed for the coming months. */
  upcomingInstallments: Array<{ month: string; arsMinor: number }>
  integrity: Integrity
  warnings: string[]
}

export type Statement = AccountStatement | CardStatement
