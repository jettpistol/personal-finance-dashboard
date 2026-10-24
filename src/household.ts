import type { Transaction } from './domain/types'

export interface Member {
  id: string
  name: string
  /** CUIL/CUIT, digits only. Names are not reliable: the same person appears as
   *  "MARIA GOMEZ" in one export and "GOMEZ MARIA" in another. */
  taxId: string
}

export interface Household {
  members: Member[]
}

export type CounterpartyRole = 'self' | 'partner' | 'external' | 'unknown'

/**
 * Who is on the other side of a transfer, from the point of view of `holder`.
 * Own-account transfers (bank-declared) are always 'self', even without a tax id.
 */
export function counterpartyRole(tx: Transaction, household: Household, holderId: string): CounterpartyRole {
  if (tx.kind === 'own_transfer') return 'self'
  const taxId = tx.counterparty?.taxId
  if (!taxId) return 'unknown'
  const member = household.members.find((m) => m.taxId === taxId)
  if (!member) return 'external'
  return member.id === holderId ? 'self' : 'partner'
}
