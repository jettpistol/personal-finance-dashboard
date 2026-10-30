import type { CardStatement, Statement, Transaction, TransactionKind } from './types.js';

/** A statement line, shaped for the app's import review. */
export interface StatementRow {
  line: number;
  date: string;
  description: string;
  /** Signed cents: negative = money out. */
  amount: number;
  currency: 'ARS' | 'USD';
  merchant: string | null;
  notes: string | null;
  type: 'expense' | 'income' | 'transfer';
  /** A category fixed by the kind of movement ("Main > Sub", as in the rule catalog). */
  categoryPath: string | null;
  /** Rows that are probably already recorded elsewhere start unticked. */
  include: boolean;
  hint: { label: string; text: string } | null;
}

const SALARY = 'Sueldo';
const REFUNDS = 'Reintegros';
const CARD_INTEREST = 'Impuestos y comisiones > Intereses de tarjeta';
const TAXES = 'Impuestos y comisiones > Impuestos';
const FEES = 'Impuestos y comisiones > Comisiones bancarias';
const SAVINGS_INTEREST = 'Inversiones > Intereses';

const TRANSFER_KINDS: TransactionKind[] = ['own_transfer', 'card_payment', 'fx', 'debt_transfer'];
const INCOME_KINDS: TransactionKind[] = ['refund', 'rebate', 'salary', 'transfer_in'];

function typeOf(tx: Transaction): StatementRow['type'] {
  if (TRANSFER_KINDS.includes(tx.kind)) return 'transfer';
  if (INCOME_KINDS.includes(tx.kind)) return 'income';
  if (tx.kind === 'interest') return tx.amountMinor > 0 ? 'income' : 'expense';
  return 'expense';
}

function categoryPathOf(tx: Transaction): string | null {
  switch (tx.kind) {
    case 'salary':
      return SALARY;
    case 'rebate':
    case 'refund':
      return REFUNDS;
    case 'interest':
      return tx.amountMinor > 0 ? SAVINGS_INTEREST : CARD_INTEREST;
    case 'tax':
      return TAXES;
    case 'fee':
      return FEES;
    default:
      return null;
  }
}

const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function describe(tx: Transaction): string {
  if (tx.source.product !== 'account') {
    const cuota = tx.installment ? ` (cuota ${tx.installment.number}/${tx.installment.total})` : '';
    return `${tx.description}${cuota}`;
  }
  const detail = tx.merchant ?? tx.counterparty?.name;
  return detail ? `${tx.description} - ${detail}` : tx.description;
}

function notesOf(tx: Transaction): string | null {
  const parts: string[] = [];
  if (tx.cardName) parts.push(`Tarjeta ${tx.cardName}`);
  if (tx.installment) parts.push(`Cuota ${tx.installment.number} de ${tx.installment.total}, compra del ${shortDate(tx.date)}`);
  if (tx.fx) parts.push(`Cotización ${tx.fx.rate.toLocaleString('es-AR')}`);
  return parts.length ? parts.join('. ') : null;
}

function hintOf(tx: Transaction): StatementRow['hint'] {
  if (tx.source.product !== 'account' && tx.kind === 'card_payment') {
    return { label: 'Pago de la tarjeta', text: 'Este pago ya se registra desde el extracto de la cuenta bancaria. Importarlo acá lo duplicaría.' };
  }
  if (tx.kind === 'debt_transfer') {
    return { label: 'Deuda en dólares', text: 'El banco pasó una deuda en dólares a pesos. No es un gasto nuevo.' };
  }
  return null;
}

/**
 * Turns a statement into rows for the import review.
 * Card installments are dated on the statement's close date (the purchase date is in the
 * notes), so they land in the month they are billed rather than in the month of the purchase.
 */
export function statementRows(statement: Statement): StatementRow[] {
  return statement.transactions.map((tx, i) => {
    const hint = hintOf(tx);
    const cuota = tx.installment && statement.kind === 'card';
    return {
      line: i + 1,
      date: cuota ? (tx.statementCloseDate ?? tx.date) : tx.date,
      description: describe(tx),
      amount: tx.amountMinor,
      currency: tx.currency,
      merchant: tx.kind === 'purchase' || tx.kind === 'refund' || tx.kind === 'rebate' ? tx.merchant : null,
      notes: notesOf(tx),
      type: typeOf(tx),
      categoryPath: categoryPathOf(tx),
      include: hint === null,
      hint,
    };
  });
}

export type StatementSummary =
  | {
      kind: 'account';
      accountRef: string;
      periodFrom: string | null;
      periodTo: string | null;
      count: number;
      openingBalance: number;
      closingBalance: number;
    }
  | {
      kind: 'card';
      issuer: CardStatement['issuer'];
      accountRef: string;
      count: number;
      closeDate: string;
      dueDate: string;
      totalDue: { ars: number; usd: number };
      minimumPayment: number | null;
      upcomingInstallments: Array<{ month: string; amount: number }>;
      cards: Array<{ last4: string; holder: string }>;
    };

export function summarizeStatement(s: Statement): StatementSummary {
  if (s.kind === 'account') {
    return {
      kind: 'account',
      accountRef: s.accountRef,
      periodFrom: s.periodFrom,
      periodTo: s.periodTo,
      count: s.transactions.length,
      openingBalance: s.openingBalanceMinor,
      closingBalance: s.closingBalanceMinor,
    };
  }
  return {
    kind: 'card',
    issuer: s.issuer,
    accountRef: s.accountRef,
    count: s.transactions.length,
    closeDate: s.closeDate,
    dueDate: s.dueDate,
    totalDue: { ars: s.totalDue.arsMinor, usd: s.totalDue.usdMinor },
    minimumPayment: s.minimumPaymentArsMinor,
    upcomingInstallments: s.upcomingInstallments.filter((u) => u.arsMinor > 0).map((u) => ({ month: u.month, amount: u.arsMinor })),
    cards: s.cardTotals.map((c) => ({ last4: c.last4, holder: c.holder })),
  };
}
