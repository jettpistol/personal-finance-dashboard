// Creates two demo users and a "Prueba (demo)" data profile with ~5 months of realistic data.
// The default "Vacío" profile stays empty.
// Usage: npm run demo (seeds the demo once into server/data, the app's only data folder, then starts the app)
//        npm run demo:reset (`--reset`: reloads only the "Prueba (demo)" profile. Logins, the other
//        profiles, the email setup, Mercado Pago connections and the encryption key are kept.)
// Exchange rates and CPI are synthetic (source "demo"); refresh them from Ajustes once online.
import { config } from './config.js';
import { coreDb, db, setDb } from './db/index.js';
import { createProfile, initProfiles, listProfiles, profileDb, resetProfile, syncUsers } from './lib/profiles.js';

const DEMO_PROFILE = 'Prueba (demo)';
import { hashPassword } from './lib/auth.js';
import { addDays, addMonths, addMonthsToMonth, currentMonth, monthEnd, today } from './lib/dates.js';
import { installmentAmounts } from './lib/loan-schedule.js';
import { createInstallmentPlan, createTx, type TxInput } from './lib/transactions.js';
import { upsertRate } from './lib/fx.js';

initProfiles();
const reset = process.argv.includes('--reset');
if (!reset && (coreDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0) {
  if (process.argv.includes('--if-empty')) {
    console.log(`Demo ya cargada en ${config.dataDir}.`);
    process.exit(0);
  }
  console.error(`${config.dataDir} ya tiene usuarios. Usá un DATA_DIR vacío para la demo.`);
  process.exit(1);
}

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));

const PASSWORD = 'demo-finanzas';
const insertUser = coreDb().prepare('INSERT INTO users (username, display_name, password_hash, color) VALUES (?, ?, ?, ?)');
// On a reset the existing users (and their passwords) stay; only missing ones are created.
const demoUser = async (username: string, name: string, color: string) => {
  const found = coreDb().prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  return found ? found.id : Number(insertUser.run(username, name, await hashPassword(PASSWORD), color).lastInsertRowid);
};
const ivan = await demoUser('ivan', 'Iván', 'blue');
const milagros = await demoUser('milagros', 'Milagros', 'pink');
// The demo data goes into its own profile; the default profile stays empty. A reset empties that
// profile's file and keeps its id, so a browser that had it selected stays on it.
const existing = reset ? listProfiles().find((p) => p.name === DEMO_PROFILE) : undefined;
const demoProfile = existing ? resetProfile(existing.id) : createProfile(DEMO_PROFILE);
syncUsers();
setDb(profileDb(demoProfile));

const cat = Object.fromEntries((db().prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]).map((c) => [c.name, c.id]));
const acc = (name: string, type: string, currency: string, owner: number | null, opening: number, priv = 0) =>
  Number(
    db().prepare('INSERT INTO accounts (name, type, currency, owner_id, is_private, opening_balance) VALUES (?, ?, ?, ?, ?, ?)').run(name, type, currency, owner, priv, opening * 100)
      .lastInsertRowid,
  );

const joint = acc('Cuenta común Galicia', 'bank', 'ARS', null, 350_000);
const jointCash = acc('Efectivo casa', 'cash', 'ARS', null, 40_000);
const ivanBank = acc('Santander Iván', 'bank', 'ARS', ivan, 600_000);
const ivanMp = acc('Mercado Pago Iván', 'wallet', 'ARS', ivan, 80_000);
const ivanCard = acc('Visa Iván', 'credit_card', 'ARS', ivan, 0);
const ivanUsd = acc('Dólares Iván', 'savings', 'USD', ivan, 1_500);
const ivanPrivate = acc('Ahorro personal Iván', 'savings', 'ARS', ivan, 250_000, 1);
const milagrosBank = acc('BBVA Milagros', 'bank', 'ARS', milagros, 420_000);
const milagrosMp = acc('Mercado Pago Milagros', 'wallet', 'ARS', milagros, 60_000);
const milagrosInv = acc('Inversiones Milagros (FCI)', 'investment', 'ARS', milagros, 900_000);
const jointUsd = acc('Dólares viaje', 'savings', 'USD', null, 800);

const start = addMonthsToMonth(currentMonth(), -5);
const end = today();

// Synthetic BNA quotes (business days) and monthly CPI.
let rate = 1180;
for (let d = `${start}-01`; d <= end; d = addDays(d, 1)) {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  rate *= 1 + (rnd() - 0.42) * 0.006;
  if (dow !== 0 && dow !== 6) upsertRate(d, Math.round(rate - 25), Math.round(rate + 25), 'demo');
}
for (let m = addMonthsToMonth(start, -12); m < currentMonth(); m = addMonthsToMonth(m, 1)) {
  db().prepare(`INSERT INTO cpi_monthly (month, pct, source) VALUES (?, ?, 'demo')`).run(m, Math.round((1.6 + rnd() * 1.6) * 10) / 10);
}

type DemoTx = Omit<TxInput, 'tags' | 'is_shared' | 'is_private' | 'description'> & Partial<TxInput>;
const tx = (who: number, t: DemoTx) => {
  if (t.date > end) return;
  createTx({ tags: [], is_shared: false, is_private: false, description: '', ...t } as TxInput, who);
};
const $ = (n: number) => Math.round(n * 100);

for (let m = start; m <= currentMonth(); m = addMonthsToMonth(m, 1)) {
  const d = (day: number) => `${m}-${String(Math.min(day, Number(monthEnd(m).slice(8)))).padStart(2, '0')}`;
  const inflation = 1 + 0.02 * (Number(m.slice(5)) % 12);

  tx(ivan, { type: 'income', date: d(1), amount: $(1_450_000 * inflation), account_id: ivanBank, category_id: cat['Sueldo'], description: 'Sueldo Iván' });
  tx(milagros, { type: 'income', date: d(2), amount: $(1_100_000 * inflation), account_id: milagrosBank, category_id: cat['Sueldo'], description: 'Sueldo Milagros' });
  if (rnd() > 0.4) tx(milagros, { type: 'income', date: d(18), amount: $(between(150_000, 400_000)), account_id: milagrosMp, category_id: cat['Freelance'], description: 'Proyecto freelance' });

  // Shared income: received in one person's account, half belongs to the other.
  tx(ivan, { type: 'income', date: d(7), amount: $(60_000 * inflation), account_id: ivanBank, category_id: cat['Otros ingresos'], description: 'Alquiler de la cochera', is_shared: true });
  if (rnd() > 0.5) tx(milagros, { type: 'income', date: d(13), amount: $(between(20_000, 45_000)), account_id: milagrosMp, category_id: cat['Reintegros'], description: 'Reintegro obra social', is_shared: true });
  tx(ivan, { type: 'income', date: d(28), amount: $(between(8_000, 15_000)), account_id: joint, category_id: cat['Intereses'], description: 'Intereses cuenta remunerada' });
  if (rnd() > 0.6) tx(ivan, { type: 'income', date: d(22), amount: $(between(30_000, 90_000)), account_id: ivanMp, category_id: cat['Ventas'], description: 'Venta en Mercado Libre' });

  // Contributions to the joint pot.
  tx(ivan, { type: 'transfer', date: d(3), amount: $(700_000 * inflation), account_id: ivanBank, to_account_id: joint, description: 'Aporte a la cuenta común' });
  tx(milagros, { type: 'transfer', date: d(3), amount: $(550_000 * inflation), account_id: milagrosBank, to_account_id: joint, description: 'Aporte a la cuenta común' });

  tx(ivan, { type: 'expense', date: d(5), amount: $(620_000 * inflation), account_id: joint, category_id: cat['Alquiler'], description: 'Alquiler depto' });
  tx(ivan, { type: 'expense', date: d(8), amount: $(95_000 * inflation), account_id: joint, category_id: cat['Expensas'], description: 'Expensas' });
  tx(milagros, { type: 'expense', date: d(12), amount: $(between(28_000, 42_000)), account_id: joint, category_id: cat['Luz'], description: 'Edenor' });
  tx(milagros, { type: 'expense', date: d(14), amount: $(between(18_000, 30_000)), account_id: joint, category_id: cat['Gas'], description: 'Metrogas' });
  tx(ivan, { type: 'expense', date: d(10), amount: $(32_000), account_id: joint, category_id: cat['Internet'], description: 'Fibertel' });
  tx(ivan, { type: 'expense', date: d(4), amount: $(12_999), account_id: ivanCard, category_id: cat['Streaming'], description: 'Netflix', is_shared: true });
  tx(milagros, { type: 'expense', date: d(6), amount: $(8_500), account_id: milagrosMp, category_id: cat['Streaming'], description: 'Spotify familiar', is_shared: true });
  tx(ivan, { type: 'expense', date: d(9), amount: $(45_000), account_id: ivanBank, category_id: cat['Gimnasio'], description: 'Gimnasio' });

  tx(ivan, { type: 'transfer', date: d(4), amount: $(70_000), account_id: joint, to_account_id: jointCash, description: 'Extracción cajero' });
  for (let w = 0; w < 4; w++) {
    tx(w % 2 ? milagros : ivan, { type: 'expense', date: d(3 + w * 7), amount: $(between(55_000, 95_000)), account_id: joint, category_id: cat['Almacén'], description: ['Coto', 'Carrefour', 'Día', 'Jumbo'][w], merchant: ['Coto', 'Carrefour', 'Día', 'Jumbo'][w] });
    tx(w % 2 ? ivan : milagros, { type: 'expense', date: d(5 + w * 7), amount: $(between(9_000, 18_000)), account_id: jointCash, category_id: cat['Verdulería'], description: 'Verdulería del barrio' });
    tx(ivan, { type: 'expense', date: d(6 + w * 7), amount: $(between(3_000, 9_000)), account_id: ivanMp, category_id: cat['Transporte público'], description: 'Carga SUBE' });
  }
  tx(milagros, { type: 'expense', date: d(11), amount: $(between(40_000, 70_000)), account_id: milagrosMp, category_id: cat['Restaurantes'], description: 'Cena afuera', is_shared: true });
  tx(ivan, { type: 'expense', date: d(19), amount: $(between(20_000, 35_000)), account_id: ivanMp, category_id: cat['Delivery'], description: 'PedidosYa', merchant: 'PedidosYa', is_shared: true });
  tx(milagros, { type: 'expense', date: d(23), amount: $(between(25_000, 60_000)), account_id: milagrosBank, category_id: cat['Cine y eventos'], description: 'Recital', is_shared: true, split: { method: 'percent', values: [{ user_id: ivan, value: 40 }, { user_id: milagros, value: 60 }] } });
  tx(ivan, { type: 'expense', date: d(15), amount: $(between(15_000, 40_000)), account_id: ivanCard, category_id: cat['Ropa'], description: 'Zara' });
  tx(milagros, { type: 'expense', date: d(16), amount: $(between(8_000, 25_000)), account_id: milagrosMp, category_id: cat['Farmacia'], description: 'Farmacity' });
  tx(ivan, { type: 'expense', date: d(20), amount: $(between(10_000, 30_000)), account_id: ivanPrivate, category_id: cat['Regalos'], description: 'Regalo sorpresa para Milagros' });
  // Pay the card from the bank (a transfer, not spending).
  tx(ivan, { type: 'transfer', date: d(25), amount: $(between(30_000, 60_000)), account_id: ivanBank, to_account_id: ivanCard, description: 'Pago tarjeta Visa' });
  // Buy dollars for the trip.
  tx(ivan, { type: 'transfer', date: d(21), amount: $(150_000), account_id: joint, to_account_id: jointUsd, to_amount: $(Math.round(150_000 / rate)), description: 'Compra de dólares para el viaje' });
  if (m !== currentMonth()) {
    tx(milagros, { type: 'adjustment', date: monthEnd(m), amount: $(between(15_000, 45_000)), account_id: milagrosInv, description: 'Rendimiento FCI' });
    tx(milagros, { type: 'transfer', date: d(27), amount: $(between(20_000, 60_000)), account_id: milagrosMp, to_account_id: ivanMp, description: 'Le paso lo que le debo', is_settlement: true });
  }
}

// Deudores: what Iván lent around (money and things), some partly returned.
{
  const loan = db().prepare('INSERT INTO loans (owner_id, person, kind, item, amount, currency, lent_on, due_on, notes, closed_on, closed_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const back = db().prepare('INSERT INTO loan_returns (loan_id, date, amount, note) VALUES (?, ?, ?, ?)');
  const id = (r: { lastInsertRowid: number | bigint }) => Number(r.lastInsertRowid);
  const juan = id(loan.run(ivan, 'Juan', 'money', 'Para el seguro del auto', $(120_000), 'ARS', addMonths(today(), -2), addMonths(today(), -1), null, null, null));
  back.run(juan, addMonths(today(), -1), $(50_000), 'Me pasó por transferencia');
  loan.run(ivan, 'Juan', 'item', 'Taladro Bosch', null, 'ARS', addMonths(today(), -4), null, 'Con la caja de mechas', null, null);
  loan.run(ivan, 'Sofi (hermana)', 'money', 'Pasajes a Córdoba', $(200), 'USD', addMonths(today(), -1), addMonths(today(), 2), null, null, null);
  loan.run(ivan, 'Martín', 'item', 'Libro «Sapiens»', null, 'ARS', addMonths(today(), -7), null, null, null, null);
  const lucas = id(loan.run(ivan, 'Lucas', 'money', 'Cena de cumpleaños', $(35_000), 'ARS', addMonths(today(), -3), null, null, addMonths(today(), -2), 'returned'));
  back.run(lucas, addMonths(today(), -2), $(35_000), null);
  loan.run(ivan, 'Caro', 'money', null, $(15_000), 'ARS', addMonths(today(), -5), null, 'Le dije que no hacía falta', addMonths(today(), -1), 'forgiven');
}

// Pendientes: a monthly dollar savings plan, a debt Iván is paying back, and a loan with interest.
{
  const thisMonth = currentMonth();
  const lastMonth = addMonthsToMonth(thisMonth, -1);
  const twoAgo = addMonthsToMonth(thisMonth, -2);
  const commitment = db().prepare('INSERT INTO commitments (owner_id, kind, title, person, amount, currency, account_id, day, start_month, months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const pay = db().prepare('INSERT INTO commitment_payments (commitment_id, month, amount, date, reason) VALUES (?, ?, ?, ?, ?)');
  const savings = Number(commitment.run(ivan, 'savings', 'Ahorro en dólares', null, $(200), 'USD', ivanUsd, 6, twoAgo, null).lastInsertRowid);
  pay.run(savings, twoAgo, $(200), `${twoAgo}-06`, null);
  pay.run(savings, lastMonth, $(200), `${lastMonth}-07`, null);
  const papa = Number(commitment.run(ivan, 'owe', 'Préstamo de papá', 'Papá', $(50_000), 'ARS', ivanBank, 10, lastMonth, 6).lastInsertRowid);
  pay.run(papa, lastMonth, $(30_000), `${lastMonth}-10`, 'Me atrasé con la tarjeta: el resto va el mes que viene');
  const plan = installmentAmounts($(300_000), 4, 4);
  db()
    .prepare('INSERT INTO loans (owner_id, person, kind, item, amount, currency, lent_on, due_on, interest_rate, installments, first_due, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ivan, 'Nico', 'money', 'Para la seña del depto', $(300_000), 'ARS', `${lastMonth}-15`, addMonths(`${thisMonth}-15`, 3), 4, 4, `${thisMonth}-15`, plan.reduce((x, y) => x + y, 0));
}

// Income in installments: the old bike, sold in 3 cuotas. The first one was already collected.
const bikePlan = createInstallmentPlan(
  { type: 'income', amount: $(450_000), count: 3, purchase_date: addMonths(today(), -1), first_date: addMonths(today(), -1), account_id: ivanBank, category_id: cat['Ventas'], description: 'Venta de la bici a Tomás', tags: [], is_shared: false, is_private: false },
  ivan,
);
db().prepare(`UPDATE transactions SET status = 'confirmed' WHERE installment_plan_id = ? AND installment_number = 1`).run(bikePlan);

// Installments: a fridge in 6 cuotas, shared.
createInstallmentPlan(
  { type: 'expense', amount: $(1_200_000), count: 6, purchase_date: addMonths(today(), -2), first_date: addMonths(today(), -1), account_id: ivanCard, category_id: cat['Hogar'], description: 'Heladera', tags: ['hogar'], is_shared: true, is_private: false },
  ivan,
);

// Budgets (household + personal).
const budget = db().prepare('INSERT INTO budgets (category_id, scope, amount, currency) VALUES (?, ?, ?, ?)');
for (const [name, amount] of [['Supermercado', 420_000], ['Salidas', 120_000], ['Servicios', 110_000], ['Vivienda', 760_000], ['Suscripciones', 30_000], ['Compras', 150_000]] as const) {
  budget.run(cat[name], 'household', $(amount), 'ARS');
}
budget.run(cat['Transporte'], `user:${ivan}`, $(30_000), 'ARS');
budget.run(cat['Compras'], `user:${ivan}`, $(60_000), 'ARS');
// Set three CPI months ago, so the inflation switch on Presupuestos has something to show.
db().prepare('UPDATE budgets SET base_month = (SELECT month FROM cpi_monthly ORDER BY month DESC LIMIT 1 OFFSET 3)').run();

// Goals.
db().prepare('INSERT INTO goals (name, target_amount, currency, deadline, account_id, scope, color) VALUES (?, ?, ?, ?, ?, ?, ?)').run('Viaje a Brasil', $(3_000), 'USD', addMonths(today(), 8), jointUsd, 'household', 'cyan');
const fund = Number(
  db().prepare('INSERT INTO goals (name, target_amount, currency, deadline, account_id, scope, color) VALUES (?, ?, ?, ?, ?, ?, ?)').run('Fondo de emergencia', $(4_000_000), 'ARS', addMonths(today(), 12), null, 'household', 'orange')
    .lastInsertRowid,
);
for (let i = 4; i >= 0; i--) db().prepare('INSERT INTO goal_contributions (goal_id, date, amount, note, created_by) VALUES (?, ?, ?, ?, ?)').run(fund, addMonths(today(), -i), $(250_000), 'Aporte mensual', ivan);

// Recurring bill that is due (creates a pending transaction on first run).
db()
  .prepare(`INSERT INTO recurring (description, type, amount, account_id, category_id, frequency, interval, next_date, day_of_month, created_by) VALUES (?, 'expense', ?, ?, ?, 'monthly', 1, ?, ?, ?)`)
  .run('Prepaga OSDE', $(185_000), joint, cat['Prepaga'], addDays(today(), -1), Number(addDays(today(), -1).slice(8)), ivan);

// Rules and a CSV preset example.
db().prepare(`INSERT INTO rules (name, priority, match_type, pattern, set_category_id, set_merchant) VALUES (?, 10, 'contains', ?, ?, ?)`).run('Supermercados Coto', 'coto', cat['Almacén'], 'Coto');
db().prepare(`INSERT INTO rules (name, priority, match_type, pattern, set_category_id, set_merchant, set_shared) VALUES (?, 5, 'contains', ?, ?, ?, 1)`).run('PedidosYa compartido', 'pedidosya', cat['Delivery'], 'PedidosYa');
db()
  .prepare('INSERT INTO csv_presets (name, config) VALUES (?, ?)')
  .run(
    'Galicia - cuenta (ejemplo)',
    JSON.stringify({ delimiter: ';', encoding: 'windows-1252', sheet: 0, skipRows: 0, hasHeader: true, columns: { date: 0, description: [1], debit: 2, credit: 3 }, amountMode: 'split', invertSign: false, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',', skipIfContains: ['SALDO ANTERIOR'] }),
  );

console.log(`Demo lista en ${config.dataDir}. Usuarios: ivan / milagros, contraseña: ${PASSWORD}. Elegí el perfil "${DEMO_PROFILE}" en Perfil de datos.`);
