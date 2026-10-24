import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../src/categorization/categories'
import { categorize, categorizeMerchant } from '../src/categorization/categorizer'
import { merchantKey, normalizeText } from '../src/categorization/merchant'
import { DEFAULT_RULES } from '../src/categorization/rules'
import type { Transaction } from '../src/domain/types'

const cat = (merchant: string) => categorizeMerchant(merchant).category

describe('default rules', () => {
  it.each([
    // delivery
    ['RAPPI', 'delivery'],
    ['PROPINA*RAPPI', 'delivery'],
    ['DLO*RAPPI', 'delivery'],
    ['PEDIDOSYA', 'delivery'],
    ['MERPAGO*PEDIDOSYA', 'delivery'],
    ['Pedidos Ya', 'delivery'],
    ['UBER EATS', 'delivery'], // must win over plain UBER
    // transport
    ['PAYU*AR*UBER', 'transport'],
    ['PAYU-UBER 828987', 'transport'],
    ['UBER TRIP', 'transport'],
    ['Uber', 'transport'],
    ['CABIFY', 'transport'],
    ['PAYU*AR*DIDI', 'transport'],
    ['SUBE Viajes - BUSES', 'transport'],
    ['AUTOPISTAS DEL SOL', 'transport'],
    // subscriptions
    ['help hbomax com', 'subscriptions'],
    ['GOOGLE *YouTube P1o05Rk7 USD 0,67', 'subscriptions'],
    ['GOOGLE *YouTubeP P1ocIl9g USD 6,90', 'subscriptions'], // processor glues a letter to the name
    ['GOOGLE *Google One USD 2,99', 'subscriptions'],
    ['MERPAGO*SPOTIFY 173742396090', 'subscriptions'],
    ['DLO*PRIMEVIDEO', 'subscriptions'],
    ['APPLE.COM/BILL MVGMKMUSD 6,99', 'subscriptions'],
    ['EBN*CRUNCHYRO', 'subscriptions'],
    ['PAYPAL *PATREON MEMBERSH USD 1,00', 'subscriptions'],
    ['LinkedIn P308159 LinkedIn USD 1,20', 'subscriptions'],
    // food shopping
    ['COTO SUC 219 DIGITAL', 'groceries'],
    ['PVS*SUPER CORONEL FRANCIS', 'groceries'],
    ['MERPAGO*VERDULERIA', 'groceries'],
    ['LA FRUTA MADRE', 'groceries'],
    ['GRANJA TRES POLLITOS', 'groceries'],
    ['CARREFOUR', 'groceries'],
    // misc
    ['MERPAGO*FARMACITY', 'health'],
    ['GALICIA SEGUROS 0926173751', 'insurance'],
    ['CP*RECARGA CLARO', 'telecom'],
    ['CINE HOYTS UNICENTER PREM', 'entertainment'],
    ['TUENTRADA GRA', 'entertainment'],
    ['MERPAGO*SPORTCLU', 'fitness'],
    ['MERPAGO*BURGERKING', 'dining'],
    ['MERPAGO*CENCOSUDEASY', 'home'],
    ['MERPAGO*PETSHOPLEON', 'pets'],
    ['SOLO DEPORTES', 'clothing'],
    ['MERPAGO*MERCADOLIBRE', 'shopping'],
    ['MERPAGO*MELI', 'shopping'],
    ['YPF', 'fuel'],
    ['EDENOR S.A.', 'utilities'],
  ])('%s -> %s', (merchant, expected) => {
    expect(cat(merchant)).toBe(expected)
  })

  it('leaves what it does not know unclassified', () => {
    for (const m of [
      'MERPAGO*TIENDAXYZ', 'MERPAGO*ABCD', 'GARCIA HNOS', 'ACME SA', 'CAFFE', 'EL RINCON DE PEPE', 'CL LA ESQUINA',
      'MERPAGO*MOTORES20269A', 'MERPAGO*FIDELIDADEA', '9 DE JULIO S.A.', 'MERPAGO*MC20250101000000',
    ]) {
      expect(cat(m), m).toBeNull()
    }
  })

  it('matches whole words only', () => {
    expect(cat('SUPERBERTA')).toBeNull()
    expect(cat('UBERLANDIA')).toBeNull()
    expect(cat('DISCOTECA')).toBeNull()
  })

  it('only uses known categories and has no duplicate ids', () => {
    const ids = CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of DEFAULT_RULES) expect(ids).toContain(r.category)
  })
})

describe('overrides', () => {
  it('beat rules and apply to every spelling of the merchant', () => {
    const overrides = { 'UBER': 'delivery', 'COTO SUC 219 DIGITAL': 'home' } as const
    expect(categorizeMerchant('PAYU*AR*UBER', { overrides })).toEqual({ category: 'delivery', source: 'override' })
    expect(categorizeMerchant('PAYU-UBER 828987', { overrides })).toEqual({ category: 'delivery', source: 'override' })
    expect(categorizeMerchant('COTO SUC 219 DIGITAL', { overrides }).category).toBe('home')
  })

  it('can classify merchants the rules do not know', () => {
    expect(categorizeMerchant('MERPAGO*TIENDAXYZ', { overrides: { TIENDAXYZ: 'groceries' } }).category).toBe('groceries')
  })
})

describe('merchant helpers', () => {
  it('normalises text', () => {
    expect(normalizeText('Pagó*Ñandú  S.A.')).toBe('PAGO NANDU S A')
  })
  it('builds a key without processor prefixes or reference numbers', () => {
    expect(merchantKey('PAYU*AR*UBER')).toBe('UBER')
    expect(merchantKey('PAYU-UBER 828987')).toBe('UBER')
    expect(merchantKey('PROPINA*RAPPI')).toBe('RAPPI')
    expect(merchantKey('MERPAGO*TIENDAXYZ')).toBe('TIENDAXYZ')
  })
})

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'x', source: { bank: 'galicia', product: 'account', accountRef: '1' }, date: '2026-10-01', statementCloseDate: null,
  amountMinor: -100, currency: 'ARS', kind: 'purchase', description: '', merchant: null, counterparty: null, installment: null,
  balanceAfterMinor: null, flag: null, cardIssuer: null, cardLast4: null, fx: null, raw: '', ...over,
})

describe('categorize(transaction)', () => {
  it('classifies purchases, and refunds/rebates land with the purchase they cancel', () => {
    expect(categorize(tx({ merchant: 'Uber' })).category).toBe('transport')
    expect(categorize(tx({ kind: 'rebate', merchant: 'Uber', amountMinor: 100 })).category).toBe('transport')
    expect(categorize(tx({ kind: 'refund', merchant: 'RAPPI', amountMinor: 100 })).category).toBe('delivery')
  })

  it('does not classify money that is not spending', () => {
    for (const kind of ['transfer_out', 'transfer_in', 'own_transfer', 'salary', 'card_payment', 'fx', 'direct_debit', 'debt_transfer'] as const) {
      expect(categorize(tx({ kind, merchant: 'UBER' })).category, kind).toBeNull()
    }
  })

  it('assigns cash and bank costs by kind', () => {
    expect(categorize(tx({ kind: 'cash_withdrawal' })).category).toBe('cash')
    expect(categorize(tx({ kind: 'tax' })).category).toBe('financial_costs')
    expect(categorize(tx({ kind: 'interest', amountMinor: -5000 })).category).toBe('financial_costs')
    expect(categorize(tx({ kind: 'interest', amountMinor: 257 })).category).toBeNull() // interest earned
  })
})
