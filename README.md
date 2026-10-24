# personal-finance-dashboard

A self-hosted finance dashboard for a couple. Free, one Docker container, SQLite. UI in Spanish (Argentina), ARS and USD.

**User guide:** [`docs/guide/`](docs/guide/README.md) explains every section of the app.

Scope was decided with [`docs/feature-questionnaire.md`](docs/feature-questionnaire.md); the resulting design is in [`docs/design.md`](docs/design.md).

## Features

- **Two logins, three dashboards**: *Hogar* (joint money and shared expenses), *Mío* (your own accounts and your share of shared expenses), and your partner's, if they choose to share it. Accounts and single transactions can be **private**.
- **Accounts**: bank, cash, credit cards, savings, investments, digital wallets (Mercado Pago…), in ARS or USD. Transfers between your own accounts never count as income or spending, and buying dollars is a transfer with two amounts.
- **ARS ⇄ USD toggle**: every amount is converted at the **BNA quote of that transaction's day** (sell, buy or average; configurable).
- **Inflation (INDEC CPI)**: "constant pesos" view in reports, real vs nominal change per category (vs last month and vs a year ago), your spending growth against CPI, and one click (or automatic) **budget indexing by the latest CPI**.
- **Splitwise-style shared expenses**: 50/50 by default, configurable default ratio, per-expense equal / % / exact amounts, who owes whom, and "settle up". Expenses paid from the joint account are shared without creating debt.
- **Installments (cuotas)**: one purchase becomes N monthly expenses; future months show as committed spending.
- **Recurring bills**: generated as *pending* so you confirm the real amount.
- **CSV / XLSX import** with **presets per bank** (column mapping, date format, decimal separator, split debit/credit columns, rows to skip, encoding), rule-based categorisation, duplicate detection, and undo.
- **Rules**: "description contains X" sets the category, merchant, shared flag, tags, or turns the row into a transfer.
- **Budgets** per category and month (household or personal) with in-app and **Telegram** alerts at 80% and 100%.
- **Savings goals** linked to an account or with manual contributions, showing how much to save per month.
- **Reports**: trends per category, yearly summary, savings rate, net worth over time, spending per person, top merchants, inflation.
- **Monthly review**: a "Cierre de mes" page with notes, plus a **.docx** report. It can be downloaded, and it is sent automatically by Telegram in the first days of each month.
- Notes, tags, and **receipt photos** (compressed in the browser to about 200 KB).
- **Export** to CSV and Excel. **Daily backups** of the database with rotation.
- Login lockout: after **3 failed attempts** the username waits 30 s, then 1, 5, 15 and 60 minutes.

## Run locally

Requires Node 22+.

```bash
npm install
npm run build            # builds web/ and server/
npm start                # http://localhost:3000  (data in server/data/)
```

On first visit you create your user. Then add your partner in **Ajustes → Hogar**.

### Try it with demo data

```bash
npm run demo
```

This builds the app, loads demo data into `server/data-demo` (only the first time) and starts it on http://localhost:3000. Users `ivan` / `milagros`, password `demo-finanzas`.

Demo exchange rates and CPI are synthetic. Use **Ajustes → Cotizaciones e inflación → Actualizar** to load real ones.

The demo data lives in the **Prueba (demo)** profile; the app opens on the empty **Vacío** profile until you pick another one (top bar or **Perfil de datos**).

### Getting a new version

```bash
git pull
npm install          # new versions may add dependencies
npm run demo:reset   # rebuilds and reloads the demo data
```

The footer shows the version you're running (`Finanzas v0.3.2 · …`); it's bumped in the root `package.json` with every change.

### Development

```bash
npm run dev --workspace server   # API on :3000 with reload
npm run dev --workspace web      # UI on :5173 (proxies /api to :3000)
npm test                         # server tests
npm run typecheck
```

## Run with Docker

```bash
cp .env.example .env             # optional settings
docker compose up -d --build     # http://localhost:3000, data in ./data
```

All state lives in `./data`: the SQLite database, receipts and `backups/`. Copying that folder is a full backup.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Database, receipts, backups |
| `PORT` | `3000` | HTTP port |
| `TELEGRAM_BOT_TOKEN` | – | Enables Telegram alerts and the monthly .docx (create a bot with @BotFather) |
| `PUBLIC_URL` | – | Used for links in Telegram messages |
| `SECURE_COOKIES` | `false` | Set `true` when served over HTTPS |
| `TZ_APP` | `America/Argentina/Buenos_Aires` | Household timezone |
| `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_MONTHLY` | `14` / `12` | Backup rotation |
| `FX_LATEST_URL`, `FX_HISTORY_URL`, `CPI_URL` | dolarapi.com / argentinadatos.com | Data sources for BNA quotes and CPI |

### Telegram

1. Talk to **@BotFather** in Telegram, run `/newbot`, and copy the token into `TELEGRAM_BOT_TOKEN`.
2. Each person opens **Ajustes → Notificaciones**, generates a code, sends `/start <code>` to the bot, and clicks "Ya lo envié".

## Hosting later (Oracle Cloud free VM)

The same `docker compose` setup runs on a free Oracle Cloud Arm VM:

- **Private (recommended)**: install Tailscale on the VM and on your devices. Keep `APP_BIND=127.0.0.1` and run `tailscale serve 3000`.
- **Public with HTTPS**: point a domain at the VM, set `DOMAIN` and `SECURE_COOKIES=true`, then run `docker compose --profile https up -d --build`. Caddy obtains the certificate automatically.

Copy `data/` off the VM regularly, for example with a cron job running `rclone` to Google Drive. Backups inside the VM don't help if the VM is lost.

## Project layout

```
server/   Fastify + better-sqlite3 API (TypeScript). Domain logic in src/lib, routes in src/routes.
web/      React + Mantine single-page app (TypeScript, Vite).
deploy/   Caddyfile for the HTTPS profile.
docs/     Questionnaire and design notes.
```
