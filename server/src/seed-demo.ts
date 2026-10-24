// Fills an EMPTY database with two demo users and ~5 months of realistic data.
// Usage: DATA_DIR=./data-demo npm run seed:demo
// Exchange rates and CPI are synthetic (source "demo"); refresh them from Ajustes once online.
import { config } from './config.js';
import { db, openDb, setDb } from './db/index.js';
import { hashPassword } from './lib/auth.js';
import { addDays, addMonths, addMonthsToMonth, currentMonth, monthEnd, today } from './lib/dates.js';
import { createInstallmentPlan, createTx, type TxInput } from './lib/transactions.js';
import { upsertRate } from './lib/fx.js';

setDb(openDb(config.dbPath));
if ((db().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0) {
  console.error(`La base ${config.dbPath} ya tiene usuarios. Usá un DATA_DIR vacío para la demo.`);
  process.exit(1);
}

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));

const PASSWORD = 'demo-finanzas';
const insertUser = db().prepare('INSERT INTO users (username, display_name, password_hash, color) VALUES (?, ?, ?, ?)');
const ana = Number(insertUser.run('ana', 'Ana', await hashPassword(PASSWORD), 'pink').lastInsertRowid);
const beto = Number(insertUser.run('beto', 'Beto', await hashPassword(PASSWORD), 'blue').lastInsertRowid);

const cat = Object.fromEntries((db().prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]).map((c) => [c.name, c.id]));
const acc = (name: string, type: string, currency: string, owner: number | null, opening: number, priv = 0) =>
  Number(
    db().prepare('INSERT INTO accounts (name, type, currency, owner_id, is_private, opening_balance) VALUES (?, ?, ?, ?, ?, ?)').run(name, type, currency, owner, priv, opening * 100)
      .lastInsertRowid,
  );

const joint = acc('Cuenta común Galicia', 'bank', 'ARS', null, 350_000);
const jointCash = acc('Efectivo casa', 'cash', 'ARS', null, 40_000);
const anaBank = acc('Santander Ana', 'bank', 'ARS', ana, 600_000);
const anaMp = acc('Mercado Pago Ana', 'wallet', 'ARS', ana, 80_000);
const anaCard = acc('Visa Ana', 'credit_card', 'ARS', ana, 0);
const anaUsd = acc('Dólares Ana', 'savings', 'USD', ana, 1_500);
const anaPrivate = acc('Ahorro personal Ana', 'savings', 'ARS', ana, 250_000, 1);
const betoBank = acc('BBVA Beto', 'bank', 'ARS', beto, 420_000);
const betoMp = acc('Mercado Pago Beto', 'wallet', 'ARS', beto, 60_000);
const betoInv = acc('Inversiones Beto (FCI)', 'investment', 'ARS', beto, 900_000);
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

  tx(ana, { type: 'income', date: d(1), amount: $(1_450_000 * inflation), account_id: anaBank, category_id: cat['Sueldo'], description: 'Sueldo Ana' });
  tx(beto, { type: 'income', date: d(2), amount: $(1_100_000 * inflation), account_id: betoBank, category_id: cat['Sueldo'], description: 'Sueldo Beto' });
  if (rnd() > 0.4) tx(beto, { type: 'income', date: d(18), amount: $(between(150_000, 400_000)), account_id: betoMp, category_id: cat['Freelance'], description: 'Proyecto freelance' });

  // Contributions to the joint pot.
  tx(ana, { type: 'transfer', date: d(3), amount: $(700_000 * inflation), account_id: anaBank, to_account_id: joint, description: 'Aporte a la cuenta común' });
  tx(beto, { type: 'transfer', date: d(3), amount: $(550_000 * inflation), account_id: betoBank, to_account_id: joint, description: 'Aporte a la cuenta común' });

  tx(ana, { type: 'expense', date: d(5), amount: $(620_000 * inflation), account_id: joint, category_id: cat['Alquiler'], description: 'Alquiler depto' });
  tx(ana, { type: 'expense', date: d(8), amount: $(95_000 * inflation), account_id: joint, category_id: cat['Expensas'], description: 'Expensas' });
  tx(beto, { type: 'expense', date: d(12), amount: $(between(28_000, 42_000)), account_id: joint, category_id: cat['Luz'], description: 'Edenor' });
  tx(beto, { type: 'expense', date: d(14), amount: $(between(18_000, 30_000)), account_id: joint, category_id: cat['Gas'], description: 'Metrogas' });
  tx(ana, { type: 'expense', date: d(10), amount: $(32_000), account_id: joint, category_id: cat['Internet'], description: 'Fibertel' });
  tx(ana, { type: 'expense', date: d(4), amount: $(12_999), account_id: anaCard, category_id: cat['Streaming'], description: 'Netflix', is_shared: true });
  tx(beto, { type: 'expense', date: d(6), amount: $(8_500), account_id: betoMp, category_id: cat['Streaming'], description: 'Spotify familiar', is_shared: true });
  tx(ana, { type: 'expense', date: d(9), amount: $(45_000), account_id: anaBank, category_id: cat['Gimnasio'], description: 'Gimnasio' });

  tx(ana, { type: 'transfer', date: d(4), amount: $(70_000), account_id: joint, to_account_id: jointCash, description: 'Extracción cajero' });
  for (let w = 0; w < 4; w++) {
    tx(w % 2 ? beto : ana, { type: 'expense', date: d(3 + w * 7), amount: $(between(55_000, 95_000)), account_id: joint, category_id: cat['Almacén'], description: ['Coto', 'Carrefour', 'Día', 'Jumbo'][w], merchant: ['Coto', 'Carrefour', 'Día', 'Jumbo'][w] });
    tx(w % 2 ? ana : beto, { type: 'expense', date: d(5 + w * 7), amount: $(between(9_000, 18_000)), account_id: jointCash, category_id: cat['Verdulería'], description: 'Verdulería del barrio' });
    tx(ana, { type: 'expense', date: d(6 + w * 7), amount: $(between(3_000, 9_000)), account_id: anaMp, category_id: cat['Transporte público'], description: 'Carga SUBE' });
  }
  tx(beto, { type: 'expense', date: d(11), amount: $(between(40_000, 70_000)), account_id: betoMp, category_id: cat['Restaurantes'], description: 'Cena afuera', is_shared: true });
  tx(ana, { type: 'expense', date: d(19), amount: $(between(20_000, 35_000)), account_id: anaMp, category_id: cat['Delivery'], description: 'PedidosYa', merchant: 'PedidosYa', is_shared: true });
  tx(beto, { type: 'expense', date: d(23), amount: $(between(25_000, 60_000)), account_id: betoBank, category_id: cat['Cine y eventos'], description: 'Recital', is_shared: true, split: { method: 'percent', values: [{ user_id: ana, value: 40 }, { user_id: beto, value: 60 }] } });
  tx(ana, { type: 'expense', date: d(15), amount: $(between(15_000, 40_000)), account_id: anaCard, category_id: cat['Ropa'], description: 'Zara' });
  tx(beto, { type: 'expense', date: d(16), amount: $(between(8_000, 25_000)), account_id: betoMp, category_id: cat['Farmacia'], description: 'Farmacity' });
  tx(ana, { type: 'expense', date: d(20), amount: $(between(10_000, 30_000)), account_id: anaPrivate, category_id: cat['Regalos'], description: 'Regalo sorpresa para Beto' });
  // Pay the card from the bank (a transfer, not spending).
  tx(ana, { type: 'transfer', date: d(25), amount: $(between(30_000, 60_000)), account_id: anaBank, to_account_id: anaCard, description: 'Pago tarjeta Visa' });
  // Buy dollars for the trip.
  tx(ana, { type: 'transfer', date: d(21), amount: $(150_000), account_id: joint, to_account_id: jointUsd, to_amount: $(Math.round(150_000 / rate)), description: 'Compra de dólares para el viaje' });
  if (m !== currentMonth()) {
    tx(beto, { type: 'adjustment', date: monthEnd(m), amount: $(between(15_000, 45_000)), account_id: betoInv, description: 'Rendimiento FCI' });
    tx(beto, { type: 'transfer', date: d(27), amount: $(between(20_000, 60_000)), account_id: betoMp, to_account_id: anaMp, description: 'Le paso lo que le debo', is_settlement: true });
  }
}

// Installments: a fridge in 6 cuotas, shared.
createInstallmentPlan(
  { amount: $(1_200_000), count: 6, purchase_date: addMonths(today(), -2), first_date: addMonths(today(), -1), account_id: anaCard, category_id: cat['Hogar'], description: 'Heladera', tags: ['hogar'], is_shared: true, is_private: false },
  ana,
);

// Budgets (household + personal).
const budget = db().prepare('INSERT INTO budgets (category_id, scope, amount, currency) VALUES (?, ?, ?, ?)');
for (const [name, amount] of [['Supermercado', 420_000], ['Salidas', 120_000], ['Servicios', 110_000], ['Vivienda', 760_000], ['Suscripciones', 30_000], ['Compras', 150_000]] as const) {
  budget.run(cat[name], 'household', $(amount), 'ARS');
}
budget.run(cat['Transporte'], `user:${ana}`, $(30_000), 'ARS');
budget.run(cat['Compras'], `user:${ana}`, $(60_000), 'ARS');

// Goals.
db().prepare('INSERT INTO goals (name, target_amount, currency, deadline, account_id, scope, color) VALUES (?, ?, ?, ?, ?, ?, ?)').run('Viaje a Brasil', $(3_000), 'USD', addMonths(today(), 8), jointUsd, 'household', 'teal');
const fund = Number(
  db().prepare('INSERT INTO goals (name, target_amount, currency, deadline, account_id, scope, color) VALUES (?, ?, ?, ?, ?, ?, ?)').run('Fondo de emergencia', $(4_000_000), 'ARS', addMonths(today(), 12), null, 'household', 'orange')
    .lastInsertRowid,
);
for (let i = 4; i >= 0; i--) db().prepare('INSERT INTO goal_contributions (goal_id, date, amount, note, created_by) VALUES (?, ?, ?, ?, ?)').run(fund, addMonths(today(), -i), $(250_000), 'Aporte mensual', ana);

// Recurring bill that is due (creates a pending transaction on first run).
db()
  .prepare(`INSERT INTO recurring (description, type, amount, account_id, category_id, frequency, interval, next_date, day_of_month, created_by) VALUES (?, 'expense', ?, ?, ?, 'monthly', 1, ?, ?, ?)`)
  .run('Prepaga OSDE', $(185_000), joint, cat['Prepaga'], addDays(today(), -1), Number(addDays(today(), -1).slice(8)), ana);

// Rules and a CSV preset example.
db().prepare(`INSERT INTO rules (name, priority, match_type, pattern, set_category_id, set_merchant) VALUES (?, 10, 'contains', ?, ?, ?)`).run('Supermercados Coto', 'coto', cat['Almacén'], 'Coto');
db().prepare(`INSERT INTO rules (name, priority, match_type, pattern, set_category_id, set_merchant, set_shared) VALUES (?, 5, 'contains', ?, ?, ?, 1)`).run('PedidosYa compartido', 'pedidosya', cat['Delivery'], 'PedidosYa');
db()
  .prepare('INSERT INTO csv_presets (name, config) VALUES (?, ?)')
  .run(
    'Galicia - cuenta (ejemplo)',
    JSON.stringify({ delimiter: ';', encoding: 'windows-1252', sheet: 0, skipRows: 0, hasHeader: true, columns: { date: 0, description: [1], debit: 2, credit: 3 }, amountMode: 'split', invertSign: false, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',', skipIfContains: ['SALDO ANTERIOR'] }),
  );

console.log(`Demo lista en ${config.dbPath}. Usuarios: ana / beto, contraseña: ${PASSWORD}`);
