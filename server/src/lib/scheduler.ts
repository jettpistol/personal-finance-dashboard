import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db/index.js';
import { addMonthsToMonth, currentMonth, monthLabel, today } from './dates.js';
import { generateDueRecurring } from './recurring.js';
import { refreshRates } from './fx.js';
import { loadCpi, refreshCpi } from './cpi.js';
import { runBackup } from './backup.js';
import { buildReviewDocx, reviewFileName } from './review.js';
import { notify } from './notify.js';
import { loadUsers, type Scope } from './domain.js';
import { indexBudgetsByCpi } from './budgets.js';
import { mercadoPagoTick } from './mercadopago/sync.js';

const TICK_MS = 15 * 60_000;
const FX_EVERY_MS = 3 * 3600_000;
const CPI_EVERY_MS = 24 * 3600_000;

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[scheduler] ${name} failed:`, (e as Error).message);
  }
}

function due(key: string, everyMs: number): boolean {
  const last = getSetting<number | undefined>(key) ?? 0;
  if (Date.now() - last < everyMs) return false;
  setSetting(key, Date.now());
  return true;
}

/** On the first days of a month, send last month's review once per scope. */
async function sendMonthlyReviews() {
  const month = addMonthsToMonth(currentMonth(), -1);
  const users = loadUsers();
  const scopes: Scope[] = ['household', ...users.map((u) => `user:${u.id}` as Scope)];
  for (const scope of scopes) {
    const row = db().prepare('SELECT sent_at FROM month_reviews WHERE month = ? AND scope = ?').get(month, scope) as { sent_at: string | null } | undefined;
    if (row?.sent_at) continue;
    const hasData = db().prepare(`SELECT 1 FROM transactions WHERE substr(date, 1, 7) = ? LIMIT 1`).get(month);
    if (!hasData) continue;
    const viewer = scope === 'household' ? users[0]?.id : Number(scope.slice(5));
    if (!viewer) continue;
    const data = await buildReviewDocx(month, scope, viewer);
    await notify({
      kind: 'review',
      users: scope === 'household' ? null : [viewer],
      title: `Cierre de ${monthLabel(month)}${scope === 'household' ? '' : ' (personal)'}`,
      body: 'Ya está el resumen del mes. Revísenlo juntos y agreguen notas en Cierre de mes.',
      link: '/cierre',
      document: { fileName: reviewFileName(month, scope), data },
    });
    db()
      .prepare(`INSERT INTO month_reviews (month, scope, sent_at) VALUES (?, ?, datetime('now')) ON CONFLICT(month, scope) DO UPDATE SET sent_at = datetime('now')`)
      .run(month, scope);
  }
}

export async function tick() {
  await step('recurring', () => generateDueRecurring());
  await step('mercado pago', () => mercadoPagoTick());
  if (due('fx_last_refresh', FX_EVERY_MS)) await step('fx', () => refreshRates());
  if (due('cpi_last_refresh', CPI_EVERY_MS)) await step('cpi', () => refreshCpi());
  await step('budget auto-index', async () => {
    if (!getSetting<boolean>('budget_auto_index')) return;
    const latest = loadCpi().latestMonth;
    const done = getSetting<string | undefined>('budget_indexed_cpi_month');
    if (!latest) return;
    if (!done) return setSetting('budget_indexed_cpi_month', latest); // start from the next publication
    if (latest > done) {
      const r = indexBudgetsByCpi(null);
      setSetting('budget_indexed_cpi_month', latest);
      await notify({ kind: 'system', users: null, title: 'Presupuestos actualizados por inflación', body: `Se aplicó el IPC de ${monthLabel(r.month)} (${r.pct}%) a ${r.updated} presupuestos.`, link: '/presupuestos' });
    }
  });
  await step('backup', async () => {
    if (!fs.existsSync(path.join(config.backupsDir, `finanzas-${today()}.sqlite`))) await runBackup();
  });
  await step('monthly review', async () => {
    if (Number(today().slice(8, 10)) <= 3 && loadUsers().length) await sendMonthlyReviews();
  });
}

export function startScheduler() {
  if (config.disableScheduler) return;
  setTimeout(() => void tick(), 5_000);
  setInterval(() => void tick(), TICK_MS).unref();
}
