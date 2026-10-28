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
| [Deudores](deudores.md) | Money and things you lent to other people: what's still out, partial returns, reminders. |
| [Pagos pendientes](pagos-pendientes.md) | What you have to do yourself each month (savings, paying someone back) and loans to collect; it chases you until it's done. |
| **Planificación** | |
| [Presupuestos](presupuestos.md) | Monthly limits per category, alerts at 80% and 100%, and indexing by inflation. |
| [Objetivos](metas.md) | Savings objectives (with picture, link, notes and priority) and how much to put aside each month. |
| [Reportes](reportes.md) | Trends, yearly summary, net worth, spending per person, inflation. |
| [Cierre de mes](cierre-de-mes.md) | The monthly sit-down: review, notes and the downloadable .docx report. |
| **Automatización** | |
| [Importar](importar.md) | Load bank statements from CSV or Excel, with a saved setup per bank. |
| [Resúmenes](resumenes.md) | Load a bank or card statement (PDF or Excel) as the bank gives it: the app recognises the format and checks the numbers. |
| [Reglas](reglas.md) | "If the description contains X, set category Y" and similar automatic fixes. |
| [Recurrentes](recurrentes.md) | Rent, bills, subscriptions and salaries that repeat; you confirm each one with the real amount. |
| | |
| [Perfil de datos](perfil-de-datos.md) | Separate sets of data (for example test data vs your real data). |
| [Ajustes](ajustes.md) | Your profile and password, email alerts, the household, categories, exchange rates and inflation, export and backups. |
| [Connect Mercado Pago](mercado-pago.md) | Getting your Mercado Pago access token and connecting your account in **Ajustes → Mercado Pago**, and how the token is kept safe. |
| [Set up email notifications](configurar-correo.md) | Connecting a Gmail account with an app password so the app can send alerts, and choosing which ones you get. |

How every figure is calculated (currency conversion, inflation, what counts in each dashboard, how shared amounts are split) is collected in [How the numbers are worked out](como-se-calcula.md).

## Key ideas

### Three dashboards

The tabs at the top switch whose money you're looking at:

- **Hogar**: the household. Joint accounts, plus every shared expense (or shared income) at its full amount, wherever it was paid from.
- **Mío**: you. Your own accounts, plus your share of each shared expense or income.
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
npm run update
npm run demo:reset   # or: npm run build && npm start, for your real data
```

If `git pull` ever says *Your local changes to the following files would be overwritten by merge: package-lock.json*, the update didn't happen: `npm run update` avoids that.

Then check the version number in the footer.

### Still seeing an old version?

The footer is the test: no version number at all means the page is older than 0.3.0.

- From 0.4.2 on, a yellow bar says *Esta pantalla es de la versión X, pero la app ya está en la Y* when the page is older than the server. Click **Recargar**.
- Close every other terminal running the app. If one is still open, a new start now says *El puerto 3000 ya está en uso…*. `lsof -i :3000` shows what holds the port.
- `docker ps`: an old container from `docker compose up` also serves on port 3000. Stop it with `docker compose down`.
- Open **http://localhost:3000** (the built app). **http://localhost:5173** is only for development.
- Force a reload with **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R**.
