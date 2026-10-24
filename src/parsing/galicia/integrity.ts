import type { Integrity, IntegrityCheck, Transaction } from '../../domain/types'

export function summarize(checks: IntegrityCheck[]): Integrity {
  return { ok: checks.every((c) => c.ok), checks }
}

/** Every movement must satisfy previous balance + amount = balance after it. */
export function checkBalanceChain(openingMinor: number, txs: Transaction[]): IntegrityCheck {
  let balance = openingMinor
  for (const tx of txs) {
    if (balance + tx.amountMinor !== tx.balanceAfterMinor) {
      return {
        name: 'balance-chain',
        ok: false,
        expected: balance + tx.amountMinor,
        actual: tx.balanceAfterMinor ?? undefined,
        detail: `Mismatch at ${tx.date} "${tx.description}"`,
      }
    }
    balance = tx.balanceAfterMinor
  }
  return { name: 'balance-chain', ok: true }
}
