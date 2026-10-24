import type { Transaction } from './domain/types'

/**
 * Month ("YYYY-MM") a transaction is reported in: card transactions belong to the month of
 * the statement's close date ("por resumen"); account movements to their own calendar month.
 *
 * Note: a statement closing on 1 Oct holds mostly September spending but is reported in October.
 */
export function reportingMonth(tx: Transaction): string {
  return (tx.statementCloseDate ?? tx.date).slice(0, 7)
}
