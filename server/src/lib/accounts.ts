import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { fetchTxs, loadAccounts, txVisibility } from './domain.js';
import { HttpError } from './http.js';
import { assertWritable } from './transactions.js';
import { removeStoredFile } from './undo.js';

/** Movements that touch an account (either side of a transfer). */
export function accountMovementCount(id: number): number {
  return (db().prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? OR to_account_id = ?').get(id, id) as { n: number }).n;
}

/**
 * Deletes an account with everything that depends on it: its movements (transfers to and from
 * it included, with their splits and Pendientes links), its recurring items and their pending
 * occurrences, and installment plans left empty. Import history stays, without the account.
 * Rules, objectives and commitments that pointed at it follow their foreign keys. Receipts go to
 * the trash, so Deshacer brings them back. Returns how many movements were deleted.
 */
export function deleteAccountWithMovements(id: number, viewer: number): number {
  const accounts = loadAccounts();
  const txs = fetchTxs().filter((t) => t.account_id === id || t.to_account_id === id);
  // A transfer into the partner's private account is theirs too: that one has to be deleted by hand.
  for (const t of txs) {
    if (txVisibility(t, viewer, accounts) !== 'full') throw new HttpError(409, 'La cuenta tiene movimientos con una cuenta privada de tu pareja. Archivala en lugar de borrarla.');
    for (const side of [t.account_id, t.to_account_id]) if (side != null && side !== id) assertWritable(accounts.get(side)!, viewer);
  }
  const d = db();
  d.transaction(() => {
    const plans = [...new Set(txs.map((t) => t.installment_plan_id).filter((p): p is number => p != null))];
    d.prepare('DELETE FROM transactions WHERE account_id = ? OR to_account_id = ?').run(id, id);
    // Their pending occurrences were in this account, so they're gone already.
    d.prepare('DELETE FROM recurring WHERE account_id = ?').run(id);
    d.prepare('UPDATE import_batches SET account_id = NULL WHERE account_id = ?').run(id);
    const emptyPlan = d.prepare('DELETE FROM installment_plans WHERE id = ? AND NOT EXISTS (SELECT 1 FROM transactions WHERE installment_plan_id = ?)');
    for (const p of plans) emptyPlan.run(p, p);
    d.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  })();
  for (const t of txs) if (t.receipt_file) removeStoredFile(path.join(config.receiptsDir, path.basename(t.receipt_file)));
  return txs.length;
}
