import { describe, expect, it } from 'vitest'
import { counterpartyRole, type Household } from '../src/household'
import type { Transaction } from '../src/domain/types'

const household: Household = {
  members: [
    { id: 'juan', name: 'Juan Perez', taxId: '20111111112' },
    { id: 'maria', name: 'Maria Gomez', taxId: '27222222223' },
  ],
}

const tx = (over: Partial<Transaction>) => ({ kind: 'transfer_out', counterparty: null, ...over }) as Transaction

describe('counterpartyRole', () => {
  it('identifies people by tax id, not by name', () => {
    expect(counterpartyRole(tx({ counterparty: { name: 'GOMEZ MARIA', taxId: '27222222223' } }), household, 'juan')).toBe('partner')
    expect(counterpartyRole(tx({ counterparty: { name: 'MARIA GOMEZ', taxId: '27222222223' } }), household, 'maria')).toBe('self')
  })
  it('treats bank-declared own transfers as self', () => {
    expect(counterpartyRole(tx({ kind: 'own_transfer' }), household, 'juan')).toBe('self')
  })
  it('separates external and unknown counterparties', () => {
    expect(counterpartyRole(tx({ counterparty: { name: 'X', taxId: '20999999990' } }), household, 'juan')).toBe('external')
    expect(counterpartyRole(tx({ counterparty: { name: null, taxId: null } }), household, 'juan')).toBe('unknown')
  })
})
