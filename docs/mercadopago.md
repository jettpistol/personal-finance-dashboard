# Mercado Pago

Each person connects their own Mercado Pago account in **Ajustes → Mercado Pago**. From then on, payments, the account money report and the live balance flow into that person's Mercado Pago account in the app. This page covers how it works, how to set it up (locally, then on Oracle Cloud), how to test webhooks, and what is still unverified.

> These notes and the code follow the official Mercado Pago documentation and the official Node SDK as of 2026-10-24. Test against your own accounts before relying on the numbers, and treat anything marked **[Gap]** as unconfirmed.

---

## How it works

| Source | How it arrives | What it becomes |
|---|---|---|
| **Payments** (money in and out) | Polling `GET /v1/payments/search` every 15 minutes, plus webhooks for instant updates | Approved payments become **confirmed** income or expenses, with Rules applied. Fees become a separate expense in *Comisiones bancarias*. |
| **Payments made with a card through Mercado Pago** | Same as above | **Pending** expense with a note. The money came from the card, not the wallet, so you move it to the card account and confirm. |
| **Account money report** (`settlement_report`) | Requested daily, imported when Mercado Pago finishes it | Lines that match a payment are linked; the rest (fund yields, withdrawals, card spend) become **pending** transactions for you to confirm. |
| **Balance** | `GET /users/{id}/mercadopago_account/balance` on every sync | Shown next to the app's computed balance, with the difference flagged. Nothing is written. |

The rules that keep the ledger honest:

- **No duplicates.** A payment that is already in the app (entered by hand or from a CSV import, same account, date and amount) is linked instead of added again.
- **Refunds and cancellations undo themselves.** If Mercado Pago later marks a payment `refunded`, `cancelled`, `charged_back` or `rejected`, the transaction it created is deleted. Transactions you entered yourself are never touched.
- **Order-safe.** A late or repeated notification with an older `date_last_updated` is ignored, so a payment can't slide back from approved to pending.
- **Undo works.** Everything Mercado Pago adds is grouped per day in **Importar**, and *Deshacer* removes it. What you undo is not re-added on the next sync.
- **Start date.** Only movements from the date you pick when connecting are added. Older ones are stored but skipped.
- **Disconnecting** deletes the token and the raw movements, and keeps every transaction already created.

Code: `server/src/lib/mercadopago/` (client, ingest, sync, report, signature, secrets) and `server/src/routes/mercadopago.ts`. UI: `web/src/components/MercadoPagoSettings.tsx`. Tests: `server/test/mercadopago.test.ts`.

---

## Connecting (each person)

1. Sign in at [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app) with your own Mercado Pago account and create an application. The name doesn't matter.
2. Open **Credenciales de producción** and copy the **Access token** (`APP_USR-...`).
3. In the app, open **Ajustes → Mercado Pago**, paste it, choose the account (your existing wallet account is preselected) and the start date, then **Conectar**.

The server checks the token against `GET /users/me` before saving it. A `TEST-...` token works but only ever sees test-user data, never your real account.

Tokens and webhook secrets are encrypted with AES-256-GCM. The key comes from `MP_TOKEN_KEY` or, if that is empty, from `data/mp-token.key`, created on first use. Anyone with the database **and** that key can use the tokens, so if you copy `data/` off the server for backups, set `MP_TOKEN_KEY` in `.env` instead and keep it out of the backup.

**Pick a sensible start date.** The app only adds movements from that date, so set the account's opening balance to what Mercado Pago showed on that day. Otherwise the balance check will show a difference from day one.

---

## Hosting: what you need and when

Polling needs nothing but the app running. On your laptop, the scheduler syncs every 15 minutes while it's open.

**Webhooks** need a public HTTPS address that Mercado Pago can reach at any time, which means a server. The README already recommends keeping the app private on Tailscale. Tailscale Funnel can publish just the webhook path, but Funnel works per port, so it must use a different port from the private app or the whole app becomes public.

On the Oracle VM, after following the README's Docker and Tailscale steps:

```bash
# Private app for your devices (as in the README)
tailscale serve --bg 3000

# Public, webhook path only, on its own port (Funnel allows 443, 8443 and 10000)
tailscale funnel --bg --https=8443 --set-path /api/mp/webhook http://127.0.0.1:3000/api/mp/webhook

# .env
MP_WEBHOOK_BASE_URL=https://<your-machine>.<your-tailnet>.ts.net:8443
```

Restart the app, then check the routing from a machine **outside** your tailnet:

```bash
curl -i -X POST "https://<your-machine>.<your-tailnet>.ts.net:8443/api/mp/webhook/not-a-real-key" -d '{}' -H 'content-type: application/json'
# Expect: HTTP 404 {"error":"not found"}   (reached the app; the key is just wrong)
curl -i "https://<your-machine>.<your-tailnet>.ts.net:8443/api/accounts"
# Expect: no response or 404 from Tailscale, never the app. Only the webhook path is public.
```

**[Gap]** How `--set-path` rewrites the forwarded path depends on the Tailscale version. If the first `curl` returns the app's 404 page for a different path, adjust the target to `http://127.0.0.1:3000` and retest.

If you'd rather expose the whole app with a domain, the README's Caddy profile works too: set `MP_WEBHOOK_BASE_URL` to that domain.

---

## Webhooks

### Configure (each person, in their own Mercado Pago application)

1. In the app, **Ajustes → Mercado Pago** shows your personal notification URL: `{MP_WEBHOOK_BASE_URL}/api/mp/webhook/<random key>`. The random key routes the notification to the right person; it is not the security (the signature is).
2. In your Mercado Pago application, open **Webhooks → Configurar notificaciones**, paste the URL in **modo productivo**, tick **Pagos** only, and save.
3. Copy the **clave secreta** Mercado Pago shows and save it in the app. Until it's saved, notifications are refused with 401 and polling carries on as normal.

### What the receiver checks

Per the [Webhooks docs](https://www.mercadopago.com/developers/en/docs/your-integrations/notifications/webhooks) and the SDK's `WebhookSignatureValidator` (checked in `mercadopago@3.6.1`):

- The `x-signature` header (`ts=...,v1=...`) must equal HMAC-SHA256, hex-encoded, of `id:{data.id};request-id:{x-request-id};ts:{ts};` keyed with your secret. `data.id` comes from the URL's query string, and the body's `data.id` must match it.
- `ts` must be within `MP_WEBHOOK_TOLERANCE_SECONDS` (300 by default) of the server clock. **[Gap]** The docs describe `ts` in milliseconds while the SDK's own tolerance option treats it as seconds; the app accepts either.
- Then it stores the event, answers 200 straight away, and fetches `GET /v1/payments/{id}` to learn the payment's current state. The notification body is only a signal.
- Mercado Pago retries until it gets a 2xx. Re-deliveries of the same notification (same body `id`) are counted once. Processing failures retry with backoff (30 s, 1, 2, 4 minutes), then stop. Polling catches anything missed.
- A notification for a payment the account can't see (for example, one simulated from the panel) answers 200 and is marked *ignored*.

### Testing with the Mercado Pago MCP (from Claude Code)

The Mercado Pago plugin's MCP server (`https://mcp.mercadopago.com/mcp`) can save the webhook configuration and simulate notifications. A cloud Claude Code session can only reach it if the environment's network policy allows `mcp.mercadopago.com`. Its sign-in redirects to `localhost`, so if that fails in a cloud session, run `/mp-connect` in Claude Code on your own computer instead.

1. `/mp-connect` and sign in with the Mercado Pago account whose application you're configuring.
2. Use the plugin's webhook tools to save the notification URL with the **payment** topic, then simulate a payment notification to it.
3. Check the delivery in the tool's notification history: it should show **200**.
4. In the app's database, `mp_webhook_events` gets a row with status `ignored` (a simulated id isn't a real payment) or `processed` (a real one).

The same checks work from the Mercado Pago panel: **Webhooks → Simular notificación**.

### Expected results

| Check | Result |
|---|---|
| Simulated notification, secret saved | 200; event `ignored` |
| Wrong or missing secret in the app | 401; panel shows the failure, Mercado Pago retries |
| Real payment | 200; event `processed`; movement appears in **Últimos movimientos**, transaction in Movimientos |
| Same notification delivered twice | One event, `deliveries = 2` |
| App down when Mercado Pago sends | Mercado Pago retries; the next poll picks the payment up anyway |

---

## Gaps and limits

- **[Gap] Coverage of payments search.** The docs don't say whether every wallet movement (transfers to your CVU, QR payments, bill payments) appears in `/v1/payments/search` or fires a webhook. The account money report is the backstop: anything it has that payments didn't is added as pending.
- **[Gap] Report columns.** The report's column names (`TRANSACTION_DATE`, `SOURCE_ID`, `TRANSACTION_TYPE`, `SETTLEMENT_NET_AMOUNT`, ...) and the config body sent when an account has none follow the docs but could not be checked against a real file. If a file can't be read, the app says which columns it found under **Ajustes → Mercado Pago**, and nothing is imported from it. That's also why report-only lines are pending rather than confirmed.
- **[Gap] Balance endpoint.** `/users/{id}/mercadopago_account/balance` answers but isn't in the public reference. The app reads `available_balance`, `unavailable_balance` and `total_amount` if present and shows nothing otherwise.
- **Partial refunds** are flagged on the movement ("ajustá el monto a mano") but not applied automatically.
- **USD.** Movements in a currency other than the linked account's are skipped with a note.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MP_TOKEN_KEY` | file `data/mp-token.key` | 32-byte key (64 hex chars or base64) encrypting tokens and webhook secrets |
| `MP_WEBHOOK_BASE_URL` | `PUBLIC_URL` | Public HTTPS base for webhook URLs |
| `MP_WEBHOOK_TOLERANCE_SECONDS` | `300` | Replay window for signed notifications; `0` disables it (debugging only) |
| `MP_API_BASE` | `https://api.mercadopago.com` | Base for the balance and report calls |
