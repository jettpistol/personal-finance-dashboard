# Finanzas: user guide

How to use every part of the app, written for the two people who share it. The interface is in Spanish, so screen names and buttons are quoted as they appear, in bold.

It is kept up to date with the app; the footer shows which version you are running.

## Start here

1. [Logging in and the top bar](barra-superior.md): the parts of the screen that are always there, and what the **Hogar / Mío / partner** tabs and the **ARS / USD** switch do.
2. [Cuentas](cuentas.md): set up your bank accounts, cards, cash and wallets first. Every movement belongs to one.
3. [Movimientos](movimientos.md): record spending, income, transfers and purchases in installments.
4. [Inicio](inicio.md): the monthly report you land on.

## Every section

The order follows the sidebar.

| Section | What it's for |
| --- | --- |
| **General** | |
| [Inicio](inicio.md) | The month at a glance: spending, income, savings, spending by category, budgets and what you owe each other. |
| [Movimientos](movimientos.md) | The full list of movements, with filters, and the **Nuevo movimiento** form. |
| [Cuentas](cuentas.md) | Accounts and their balances, joint or personal, in ARS or USD. |
| [Gastos compartidos](gastos-compartidos.md) | Who owes whom from shared expenses and shared income, and settling up. |
| **Planificación** | |
| [Presupuestos](presupuestos.md) | Monthly limits per category, alerts at 80% and 100%, and indexing by inflation. |
| [Metas de ahorro](metas.md) | Savings goals and how much to put aside each month. |
| [Reportes](reportes.md) | Trends, yearly summary, net worth, spending per person, inflation. |
| [Cierre de mes](cierre-de-mes.md) | The monthly sit-down: review, notes and the downloadable .docx report. |
| **Automatización** | |
| [Importar](importar.md) | Load bank statements from CSV or Excel, with a saved setup per bank. |
| [Reglas](reglas.md) | "If the description contains X, set category Y" and similar automatic fixes. |
| [Recurrentes](recurrentes.md) | Rent, bills, subscriptions and salaries that repeat; you confirm each one with the real amount. |
| | |
| [Perfil de datos](perfil-de-datos.md) | Separate sets of data (for example test data vs your real data). |
| [Ajustes](ajustes.md) | Your profile and password, the household, categories, exchange rates and inflation, Telegram, export and backups. |

How every figure is calculated (currency conversion, inflation, what counts in each dashboard, how shared amounts are split) is collected in [How the numbers are worked out](como-se-calcula.md).

## Key ideas

### Three dashboards

The tabs at the top switch whose money you're looking at:

- **Hogar**: the household. Joint accounts, plus every shared expense at its full amount, wherever it was paid from.
- **Mío**: you. Your own accounts, plus your share of each shared expense.
- **Your partner's name**: their **Mío**, if they chose to share it (**Ajustes**).

A movement in a joint account that isn't marked as shared only counts in **Hogar**. Details: [what counts where](como-se-calcula.md).

### Two currencies

Each account is in ARS or USD, and its movements are in that currency. The **ARS / USD** switch converts everything for display at the Banco Nación (BNA) quote **of each movement's own day**, so a dollar spent in March is converted at March's rate. Buying dollars is a transfer between two accounts, not spending.

### Inflation

The app loads INDEC's monthly CPI (IPC). Wherever you see **Real (IPC)** or **Var. real**, amounts are adjusted for inflation, so you can tell spending more from prices going up. A small **(e)** means this month's CPI isn't published yet and the latest one is used as an estimate.

### Shared money

A movement marked **Gasto compartido** (or **Ingreso compartido**) is split between you: 50/50 by default, or by percentages or exact amounts. If one of you paid from a personal account, the other owes their part; [Gastos compartidos](gastos-compartidos.md) keeps the running balance. Anything paid from a joint account is shared without creating a debt.

### Pending movements

Recurring items don't become real spending by themselves. On each due date the app creates a **pending** movement, and it only counts once someone confirms it with the actual amount. When something is waiting, a yellow alert appears on **Inicio** and **Recurrentes**.

### Privacy

An account, or a single movement in a personal account, can be **Privado**: your partner doesn't see it. Shared expenses can't be private. You can also hide your whole **Mío** dashboard from your partner.

### Data profiles

The app can hold several independent sets of data, called profiles. The same two users log in to all of them. A new installation opens on the empty **Vacío** profile; the demo data is in **Prueba (demo)**. See [Perfil de datos](perfil-de-datos.md).

## Getting a new version

```bash
git pull
npm install
npm run demo:reset   # or: npm run build && npm start, for your real data
```

Then check the version number in the footer.
