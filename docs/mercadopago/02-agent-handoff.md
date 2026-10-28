# Agent Brief: Mercado Pago Integration for the Personal Finance Dashboard

> **How this repo applies this brief (read first).** This brief was written for a generic hosted site. In Finanzas:
> - Each person connects their own account in **Ajustes → Mercado Pago**. Tokens are **not** env vars: the server verifies the token with `GET /users/me`, then stores it encrypted (AES-256-GCM, key in `SECRET_KEY` or `DATA_DIR/secret.key`, never in the database) in the core table `mp_connections`. The API never returns it. Code: `server/src/lib/secrets.ts`, `server/src/lib/mercadopago.ts`, `server/src/routes/mercadopago.ts`.
> - Reads go through `mpGet()` (GET only, path allowlist). The only writes, approved by the owner on 2026-10-28, go through `mpWrite()`: `POST`/`PUT {base}/config` and `POST {base}` (generate a report) for the two reports. `schedule` and everything else stays blocked; anything new needs the owner's approval.
> - Report settings, columns, response codes and the balance trick are confirmed in [`03-reports-reference.md`](03-reports-reference.md), which overrides section 3.3 below.
> - Storage is the app's SQLite and its own `transactions` table (integer cents), not the data model in section 4. Hosting is self-hosted (Docker), so the scheduler is the app's own (`lib/scheduler.ts`).


**Audience:** the coding agent building the website.
**Goal:** show balance, transactions, and spending/income insights for one or two **personal** Mercado Pago accounts (a couple), individually and combined.

Read [`01-setup-guide.md`](./01-setup-guide.md) first for context on what the account owner sets up.

> ⚠️ Endpoint paths and field names below come from Mercado Pago's public docs as of late 2026 and were **not live-tested** while writing this brief. Before building on any of them, verify each one with a real token (step "Verification" below) and check the current docs at `https://www.mercadopago.com.ar/developers/en/reference`.

---

## 1. What you'll get from the owner

| Item | Format | Where it lives | Sensitive? |
|---|---|---|---|
| Production Access Token, one per account | `APP_USR-<digits>-<date>-<hex>-<user_id>` | Env var / hosting secret only | **Yes.** Never log, commit, return to the client, or ask for it in chat. |
| User ID per account | integer (e.g. `123456789`) | Config / DB | No |
| Account label | string (e.g. `"Taiel"`, `"Partner"`) | Config / DB | No |
| Site ID & currency | `MLA` / `ARS` (Argentina assumed) | Config | No |
| History start date | ISO date | Config | No |
| Report notification email (optional) | email | Report config | Low |
| Whether "Reportes" is available in their web account | yes/no | n/a | No |

**Env var convention (please follow it):**

```
MP_ACCOUNTS=taiel,partner
MP_ACCESS_TOKEN_TAIEL=APP_USR-...
MP_ACCESS_TOKEN_PARTNER=APP_USR-...
MP_SITE_ID=MLA
MP_CURRENCY=ARS
MP_HISTORY_START=2024-01-01
```

Ship a `.env.example` with placeholders, and make sure `.env` is in `.gitignore`.

**How to ask the owner for the token:** tell them which secret name to create and where (e.g. "In Vercel → Project → Settings → Environment Variables, add `MP_ACCESS_TOKEN_TAIEL`"). Don't ask them to paste it into the conversation.

---

## 2. Hard rules

1. **Server-side only.** All Mercado Pago calls go through your backend (API routes / serverless functions / a cron worker). The token never reaches the browser bundle, client logs, or error messages.
2. **Read-only behavior.** The token has write power (payments, refunds). Only issue `GET` requests, plus the report-generation `POST`/`PUT` calls listed in section 3. Never call payment-creation, refund, or cancellation endpoints.
3. **Protect the dashboard itself.** This is private financial data. Put authentication in front of every page and API route (e.g. auth limited to the two owners' emails). No public routes that return financial data.
4. **Cache and store locally.** Sync into your own DB (Postgres/SQLite/Supabase) and serve the UI from it. Don't hit MP on each page load. Respect rate limits: back off on `429`, and keep it under ~1 request/second per token for bulk sync.
5. **Redact.** Strip tokens from logs; mask payer emails/IDs in any debug output.

---

## 3. API surface to use

Base URL: `https://api.mercadopago.com`
Header on every call: `Authorization: Bearer <ACCESS_TOKEN>`

### 3.1 Identity — `GET /users/me`
Use it for the startup health check and to confirm the user ID matches config. Fields: `id`, `nickname`, `email`, `site_id`, `country_id`.

### 3.2 Received payments (near real time) — `GET /v1/payments/search`
Returns payments where the account is the **collector** (money received: transfers in, QR, links).

Useful params:
```
sort=date_created&criteria=desc
range=date_created&begin_date=2024-01-01T00:00:00.000-03:00&end_date=NOW
status=approved            # optional
limit=100&offset=0         # paginate; offset caps around 10,000 so chunk by date range
```
Response: `results[]` + `paging {total, limit, offset}`.
Key fields per payment: `id`, `date_created`, `date_approved`, `status`, `status_detail`, `operation_type` (`regular_payment`, `money_transfer`, `account_fund`, …), `payment_method_id`, `payment_type_id`, `transaction_amount`, `transaction_details.net_received_amount`, `fee_details[]`, `currency_id`, `description`, `payer {id, email, first_name, last_name}`, `external_reference`.

Detail: `GET /v1/payments/{id}`.

⚠️ This does **not** reliably list money the owner **spent** or **sent**. Use the reports for that.

### 3.3 Full ledger: Reports API (primary source of truth)
Two report families share the same shape. Implement both and keep whichever works for each account (availability varies by account type/country).

| Report | Base path | Content |
|---|---|---|
| Released money | `/v1/account/release_report` | Money that became available, with running balance; withdrawals if `include_withdrawal: true` |
| Account money (all transactions) | `/v1/account/settlement_report` | Every operation affecting the account balance (in/out, refunds, chargebacks, fees) |

Endpoints (same for both, swap the base path):
```
GET  {base}/config             # current config
POST {base}/config             # create config (first time)
PUT  {base}/config             # update config
POST {base}                    # generate a report: {"begin_date": "...Z", "end_date": "...Z"}
GET  {base}/list               # list generated reports (file_name, status, dates)
GET  {base}/{file_name}        # download the CSV
POST {base}/schedule           # enable automatic generation
DELETE {base}/schedule         # disable automatic generation
```

Suggested config body (check the current docs for exact field names):
```json
{
  "file_name_prefix": "pfd",
  "include_withdrawal": true,
  "display_timezone": "GMT-03",
  "report_translation": "en",
  "separator": ",",
  "notification_email_list": ["<owner email, optional>"],
  "frequency": { "type": "daily", "value": 1, "hour": 6 },
  "columns": [ { "key": "DATE" }, { "key": "SOURCE_ID" }, { "key": "EXTERNAL_REFERENCE" },
               { "key": "RECORD_TYPE" }, { "key": "DESCRIPTION" },
               { "key": "NET_CREDIT_AMOUNT" }, { "key": "NET_DEBIT_AMOUNT" },
               { "key": "GROSS_AMOUNT" }, { "key": "FEE_AMOUNT" },
               { "key": "BALANCE_AMOUNT" }, { "key": "PAYMENT_METHOD" },
               { "key": "TRANSACTION_TYPE" } ]
}
```
Use `GET {base}/config` first to see which column keys the account actually supports. The column list above is a guess for the release report; the settlement report's columns are confirmed below.

Generation is **async**. `POST` returns right away; poll `/list` until the file appears (seconds to minutes), then download. Report windows have a max span (typically ~60 days for settlement, longer for release), so backfill in chunks.

#### Report download (confirmed for both reports from Mercado Pago's API reference)

```
GET https://api.mercadopago.com/v1/account/settlement_report/{file_name}
GET https://api.mercadopago.com/v1/account/release_report/{file_name}
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

- `file_name` comes from the matching `/list` endpoint (`/v1/account/settlement_report/list` or `/v1/account/release_report/list`).

#### Report list response (documented for `release_report/list`)

`GET {base}/list` returns a JSON **array** (the docs wrongly say "no response body"):

```json
[
  {
    "id": 99336983670,
    "account_id": 167345291,
    "user_id": 123456789,
    "report_id": 17012160,
    "begin_date": "2022-08-01T03:00:00Z",
    "end_date": "2022-08-08T02:59:59Z",
    "generation_date": "2024-02-16T15:55:22.258-04:00",
    "last_modified": "2024-02-16T15:55:22.261-04:00",
    "created_from": "manual",
    "status": "processed",
    "sub_type": "release",
    "currency_id": "ARS",
    "format": "CSV",
    "is_reserve": false,
    "is_test": false,
    "retries": 0
  }
]
```

How to use it:
- **Ready check:** a report can be downloaded once `status == "processed"`. Treat any other status as "still generating" and poll again with backoff (e.g. 10s, 20s, 40s, up to ~10 min), then give up and log it in `sync_runs`.
- **Matching:** find the report you just requested by its `begin_date` and `end_date` (UTC; `T03:00:00Z` is local midnight in Argentina, GMT-3). Prefer the newest `generation_date` if there are duplicates.
- **Filter:** skip entries with `is_test: true`. `created_from` tells manual reports from scheduled ones.
- **⚠️ `file_name` isn't in the documented example**, but the download endpoint needs it. Real responses have historically included a `file_name` field. Check this first with a real token. If it's missing, check whether `GET {base}/{id}` works, and if it doesn't, report back to the owner before building the sync around it.
- `200` returns the raw file (`.csv` or `.xlsx`, depending on config) with **no JSON body**, so handle it as text/binary, not JSON.
- `401` means the token is invalid; `404 not_found` means the file name is wrong or the file isn't ready yet (keep polling `/list`).

Columns as documented (the CSV header). Mercado Pago's docs show this **same** header for both reports, though the release report page says its fields vary with the parameters you set:

```
DATE, SOURCE_ID, EXTERNAL_REFERENCE, RECORD_TYPE, DESCRIPTION,
NET_CREDIT_AMOUNT, NET_DEBIT_AMOUNT, GROSS_AMOUNT, SELLER_AMOUNT,
MP_FEE_AMOUNT, FINANCING_FEE_AMOUNT, SHIPPING_FEE_AMOUNT, TAXES_AMOUNT,
COUPON_AMOUNT, INSTALLMENTS, PAYMENT_METHOD, TAX_DETAIL, TAX_AMOUNT_TELCO,
TRANSACTION_APPROVAL_DATE, POS_ID, POS_NAME, EXTERNAL_POS_ID, STORE_ID,
STORE_NAME, EXTERNAL_STORE_ID, TAXES_DISAGGREGATED, METADATA, REFUND_ID
```

How these map onto the `transactions` table (section 4):

| Report column | Use |
|---|---|
| `SOURCE_ID` | `source_id`; it's the payment ID, so dedupe against `payments/search` on it |
| `DATE` | `occurred_at` |
| `NET_CREDIT_AMOUNT` / `NET_DEBIT_AMOUNT` | credit > 0 → `direction='in'`; debit > 0 → `direction='out'`; `amount` = the non-zero one |
| `MP_FEE_AMOUNT` + `FINANCING_FEE_AMOUNT` + `SHIPPING_FEE_AMOUNT` + `TAXES_AMOUNT` | `fee` (keep each one in `raw`) |
| `RECORD_TYPE`, `DESCRIPTION`, `PAYMENT_METHOD` | `type` / `description` / categorization input |
| `REFUND_ID` | if set, mark the row as a refund linked to the original `SOURCE_ID` |

Notes:
- Amounts can come with a locale decimal separator, depending on the config's `separator` and the country. Parse them explicitly, never with `parseFloat` on unchecked input.
- `RECORD_TYPE` includes summary rows (e.g. an initial or total line). Keep only the detail rows as transactions; log the summary rows' values to check them against the sum of the details.

**Balance:** neither documented header has a balance column. Get the balance in this order:
1. The legacy balance endpoint (3.4), if it returns 200.
2. The release report, **only if** its config accepts a balance column (e.g. `BALANCE_AMOUNT`). The docs don't confirm one exists. Check with `GET /v1/account/release_report/config`, try adding it with `PUT`, and if it's accepted use the last detail row's value.
3. As a last resort, ask the owner for their current balance once, as an opening value, and add up `NET_CREDIT_AMOUNT − NET_DEBIT_AMOUNT` from there. Label it as "estimated".

Always show "as of <report end time>".

### 3.4 Balance endpoint (legacy, try it, don't depend on it)
```
GET /users/{user_id}/mercadopago_account/balance
```
Historically returns `total_amount`, `available_balance`, `unavailable_balance`. It's often restricted or deprecated. If it returns 200, use it for a live balance tile. If it returns 401/403/404, fall back to the report-derived balance. Same for the legacy `GET /mercadopago_account/movements/search`.

### 3.5 Not available via API → manual import
Tarjeta Mercado Pago (credit card), Mercado Crédito, investment yield detail, crypto. Build a **CSV/XLSX upload** screen that parses the export from *mercadopago.com.ar → Actividad → Descargar*, and a manual-entry form. Tag those rows `source = "manual_import"`.

---

## 4. Suggested data model

```
accounts(id, label, mp_user_id, site_id, currency, created_at)

transactions(
  id PK,                    -- "<account_id>:<source>:<source_id>"
  account_id FK,
  source,                   -- 'payments_api' | 'release_report' | 'settlement_report' | 'manual_import'
  source_id,                -- MP payment id / SOURCE_ID
  occurred_at timestamptz,
  direction,                -- 'in' | 'out'
  amount numeric(14,2),     -- always positive; direction decides sign
  fee numeric(14,2),
  currency,
  type,                     -- transfer, payment, withdrawal, refund, fee, chargeback, yield...
  description,
  counterparty,             -- payer/payee name when available
  category,                 -- user-editable (groceries, rent...); start rule-based
  raw jsonb,                -- original payload/CSV row
  UNIQUE(account_id, source, source_id)
)

balances(account_id, as_of timestamptz, available numeric, unavailable numeric, source)

sync_runs(id, account_id, kind, started_at, finished_at, status, error, cursor)
```

**Dedup:** the same money movement can show up in both `payments_api` and a report. Treat the reports as authoritative and match on `SOURCE_ID == payment.id`. Keep the payments-API row only until the report row arrives.

---

## 5. Sync strategy

1. **Backfill (one-time per account):** generate reports in date chunks from `MP_HISTORY_START` to now, download, parse, upsert. Also page `payments/search` over the same range.
2. **Incremental (cron):**
   - Every 15–30 min: `payments/search` with `begin_date = last_sync - 1 day` (overlap, then dedupe).
   - Daily: rely on the scheduled report (or `POST` a report for the last 2 days), download, upsert, refresh the balance.
3. **Webhooks (optional, later):** MP notifications can push `payment` events to a public HTTPS endpoint (configured under the app's *Webhooks* section). You must validate the `x-signature` HMAC-SHA256 header with the app's webhook secret. This isn't needed for v1; cron polling is enough for a personal dashboard.

Use a scheduler your hosting supports (Vercel Cron, GitHub Actions schedule, Supabase pg_cron, etc.).

---

## 6. Verification (do this first, report back to the owner)

With each token, run and record the HTTP status:

1. `GET /users/me` → expect 200; confirm `id` matches config.
2. `GET /v1/payments/search?limit=5&sort=date_created&criteria=desc` → expect 200.
3. `GET /users/{id}/mercadopago_account/balance` → note 200 vs 4xx.
4. `GET /v1/account/release_report/config` and `GET /v1/account/settlement_report/config` → note which work (404 can just mean "not configured yet". Try `POST` config next).
5. Generate one small report (last 7 days) and confirm the CSV downloads and parses.

Then tell the owner, in plain language, which data sources work for their account and which items (if any) need manual import.

---

## 7. Dashboard features this enables

- Current balance per person + combined (with "as of" time).
- Income vs. spending by month; net cash flow.
- Transaction list with search, filters (account, direction, type, category, date), and CSV export.
- Category breakdown (rule-based auto-categorization from description/counterparty, user-overridable).
- Fees paid over time.
- Top counterparties (who you pay / who pays you).
- Data-freshness indicator and a "Sync now" button (server-side, rate-limited).

---

## 8. Open questions to ask the owner (only if not already answered)

- Country/site if not Argentina?
- One account or two? Labels?
- How much history?
- Hosting preference (affects where secrets live and which cron to use)?
- Do they also want to import other banks/cards later? If so, keep `source` generic.
