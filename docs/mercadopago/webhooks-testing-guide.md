# Mercado Pago webhooks: end-to-end testing guide

This guide covers the first piece of the Mercado Pago integration for the personal finance dashboard. It connects one Mercado Pago account, receives payment notifications in real time, keeps a local ledger in sync and exports it. The code lives in [`server/`](../../server) and every claim below points either to the official documentation or to the official SDK source it was checked against.

> **Professional statement.** This guide and code are based on the official Mercado Pago documentation and SDKs available on 2026-10-24. They do not guarantee a perfect integration. Every output must be manually validated and tested before a production rollout, and the final responsibility for testing, QA and deployment lies with the project's technical team.

---

## 0. Assumptions, sources and known gaps

### Assumptions (correct any that are wrong)

| # | Assumption | Why it matters |
|---|---|---|
| A1 | **Stack is Node.js 22 + Express 5 + TypeScript**, storage is SQLite via the built-in `node:sqlite`. The repo had no code yet, so this was a free choice. | All code samples target it. |
| A2 | **One Mercado Pago account** is connected using that account's own application credentials (no OAuth). The README says the dashboard is for a couple, so a second account will need either a second set of credentials or the OAuth flow later. | Determines how the access token is obtained. |
| A3 | **Country is Argentina (MLA)**, given the earlier Spanish-language conversation and the mention of Fondo Común de Inversión. Webhooks and signature validation are the same across countries; currency, payment methods and report column names differ. | Affects report contents and labels, not the webhook code. |
| A4 | `<NOTIFICATION URL>` = `https://<your-public-host>/webhooks/mercadopago`. Locally that means a tunnel (ngrok, cloudflared) in front of `http://localhost:3001`. | You must supply the real public host. |
| A5 | `<TOPICS>` = **`payment`** (shown as "Payments" in the panel). Nothing else is needed for a read-only finance ledger. | Other topics (orders, chargebacks, Point, subscriptions) are stored for audit but ignored. |
| A6 | SDK version **`mercadopago@3.6.1`** (latest on npm on 2026-10-24), Express **5.1.0**, Node **>= 22.13**. | Pinned exactly in `server/package.json`. |

### How each claim was verified

The developer portal (`mercadopago.com.*/developers`) was blocked by this build environment's network policy, so pages could not be fetched directly. Every statement in this guide carries one of these labels:

- **[SDK]** checked line by line in the published `mercadopago@3.6.1` package, its source and its tests on GitHub ([mercadopago/sdk-nodejs](https://github.com/mercadopago/sdk-nodejs)). This is the strongest evidence here.
- **[Docs]** taken from the official documentation as indexed by search, without reading the full page. Re-read the linked page before relying on exact numbers.
- **[Gap]** the official material is silent, ambiguous or contradictory. The nearest verifiable alternative is given.

Primary references:

- Webhooks: <https://www.mercadopago.com/developers/en/docs/your-integrations/notifications/webhooks>
- Payments search / get: <https://www.mercadopago.com/developers/en/reference> (Payments section)
- Releases report API: <https://www.mercadopago.com.ar/developers/en/docs/reports/released-money/api>
- Account money (settlement) report API: <https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/additional-content/reports/account-money/api>
- Node SDK webhook guide: <https://github.com/mercadopago/sdk-nodejs/blob/master/docs/webhooks.md>

---

## 1. Webhook requirements and security

### 1.1 What Mercado Pago sends

For the `payment` topic, Mercado Pago sends a `POST` to your notification URL with the resource id and type appended to the query string **[Docs]**:

```
POST https://<your-public-host>/webhooks/mercadopago?data.id=123456789&type=payment
content-type: application/json
x-signature: ts=1742505638683,v1=6f1b...c9e2
x-request-id: 2066ca19-c6f1-498a-be75-1923005edd06
```

```json
{
  "id": 12345,
  "live_mode": true,
  "type": "payment",
  "date_created": "2026-10-20T10:04:58.396-04:00",
  "user_id": 44444,
  "api_version": "v1",
  "action": "payment.created",
  "data": { "id": "123456789" }
}
```

The body is a change signal and nothing more. It carries no amount or status, so the receiver always has to call `GET /v1/payments/{data.id}` to learn what actually happened. The Node SDK's own guide says the same: "Treat the payload as a change signal and the API lookup as the current source of truth" **[SDK]**.

`action` is usually `payment.created` or `payment.updated` **[Docs]**. The receiver never branches on it. It always re-reads the payment, which keeps the logic correct even if new actions appear.

### 1.2 Signature validation

Each notification is signed with the **secret signature** that the panel generates when you save the webhook configuration (Your integrations, then your application, then Webhooks) **[Docs]**. The algorithm, as implemented by the SDK's `WebhookSignatureValidator` **[SDK]**:

1. Parse `x-signature` as comma-separated `key=value` pairs and take `ts` and `v1`.
2. Build the **manifest** `id:{data.id};request-id:{x-request-id};ts:{ts};`, where `data.id` comes from the **query string** and not the body. A pair whose value is missing is dropped from the manifest.
3. Compute `HMAC-SHA256(secret, manifest)` as lowercase hex.
4. Compare it with `v1` in constant time. Any mismatch means the request did not come from Mercado Pago, so answer `401`.

Two details matter in practice:

- **`data.id` casing.** The docs ask you to lowercase alphanumeric ids, but the SDK passes the value through unchanged and its tests sign an upper-case id as-is **[SDK]**. Payment ids are numeric, so this does not affect the `payment` topic. Revisit it if you subscribe to `order` notifications, whose ids are alphanumeric.
- **QR code notifications are not signed** **[SDK]**, and the validator always rejects them. They are out of scope here (the `payment` topic only).

**[Gap] Timestamp unit.** The docs describe `ts` as milliseconds, and the SDK's main test fixture uses a 13-digit value (`1742505638683`). Yet the SDK's optional `toleranceSeconds` check multiplies `ts` by 1000 and its tolerance tests use a 10-digit value. If you pass `toleranceSeconds` to the SDK and Mercado Pago really sends milliseconds, every genuine notification fails with `TimestampOutOfTolerance`. The receiver here lets the SDK verify the HMAC and enforces the replay window itself, accepting either unit (13+ digits means milliseconds). See [`server/src/webhooks/verify.ts`](../../server/src/webhooks/verify.ts).

### 1.3 Transport

- **HTTPS, publicly reachable.** Mercado Pago must be able to reach the URL from the internet **[Docs]**, so `localhost` will not work without a tunnel. Use a valid public certificate. Nothing in the docs supports self-signed certificates **[Gap]**, so don't rely on them.
- **Raw body.** The signature does not cover the body **[SDK]**, so raw-body handling is not needed for verification. The receiver still reads the body with `express.raw()` before any JSON parser, keeping the exact bytes for auditing and as a last-resort idempotency key.
- **Respond fast with `200`/`201`.** Mercado Pago treats anything else, or a slow response, as a failure and retries **[Docs]**. The docs give a response timeout (22 seconds in the current Webhooks page) and a retry schedule (every 15 minutes, then wider intervals after the third failed attempt). Re-check both numbers on the Webhooks page, because they have changed over the years. The receiver acknowledges in single-digit milliseconds and processes afterwards, so the exact figure doesn't matter much.

### 1.4 Retries, duplicates and ordering

Delivery is at-least-once and order is not guaranteed **[SDK]**: "delivery may repeat or arrive out of order". The receiver handles this in three layers:

1. **Event idempotency.** Each accepted notification gets a `dedupe_key`: the notification's body `id` if present, else `x-request-id`, else a hash of the raw body. A re-delivery bumps `deliveries` on the existing row instead of creating work. **[Gap]** The docs don't say whether `x-request-id` is reused on retries, which is why the body `id` comes first.
2. **Resource idempotency.** Payments are upserted by id, and an update is applied only when the fetched `date_last_updated` is not older than the stored one. A late `pending` can't overwrite a newer `approved`.
3. **A safety net for lost notifications.** A background reconcile runs `GET /v1/payments/search` filtered on `date_last_updated` every 15 minutes (configurable). This also covers activity that never triggers a webhook at all (see 1.6).

### 1.5 Test vs production

| | Test | Production |
|---|---|---|
| Access token | `TEST-...` (test credentials) or a **test user's** production credentials | `APP_USR-...` of the real account |
| Webhook URL | "Test mode" URL field in the panel | "Production mode" URL field |
| Secret signature | Shown for the test configuration | Shown for the production configuration; never reuse the test one |
| `live_mode` in body | `false` | `true` |
| What the API returns | Only test-user data; **reports for test accounts come back empty** **[Docs]** | Your real payments, balance and reports |

The last row has a direct consequence for this project. **Test credentials can never show your real balance or history.** Use test mode to prove the webhook pipeline works, then switch to production credentials to see real data. The production token can read and move money on the account, so keep it server-side only, out of git and out of logs.

### 1.6 What the `payment` topic will and won't give you

**[Gap]** The docs describe webhooks for payments related to your application. They don't say whether wallet activity created *outside* the application (a QR payment you make in the app, a transfer into your CVU, a card purchase with the Mercado Pago card, money market yield) fires a notification to your application's URL, or whether it appears in `/v1/payments/search` at all. Card spending and Fondo Común de Inversión yields in particular are usually account movements rather than payments.

The nearest verifiable alternative is the **Account money report** (`settlement_report`). The docs describe it as covering all operations that affected the account balance. Use it as the complete ledger and the payments API as the real-time layer. Section 4.4 includes a check that measures the difference on the real account.

---

## 2. Notification receiver implementation

> **Example code, not production-ready.** It is complete and tested, but it is a reference starting point. Review it, load-test it and adapt it before production use.

### 2.1 Layout

```
server/
  src/
    config.ts               env loading (all <REPLACE> values in .env.example)
    db.ts                   SQLite schema: mp_payments, mp_webhook_events, kv
    mp/api.ts               SDK + fetch wrapper (payments, user, balance, reports)
    mp/payments.ts          normalise, order-safe upsert, search-based sync
    webhooks/verify.ts      signature + replay-window check
    webhooks/router.ts      POST /webhooks/mercadopago
    webhooks/processor.ts   async processing with retry/backoff
    routes/api.ts           dashboard API (bearer-token protected) incl. CSV/JSON export
    app.ts, index.ts
  scripts/
    simulate-webhook.ts     LOCAL signed-notification sender (test tool)
    sync.ts                 one-off backfill
  test/                     vitest + supertest, fake Mercado Pago API
```

Versions: `mercadopago@3.6.1`, `express@5.1.0`, Node `>=22.13`. Dev tools: `typescript@5.8.3`, `tsx@4.19.4`, `vitest@3.2.4`, `supertest@7.1.1`.

### 2.2 Request flow

```
Mercado Pago ──POST──▶ /webhooks/mercadopago
                         1. verify x-signature (HMAC over query data.id, x-request-id, ts)   ── fail → 401
                         2. replay window on ts (±300 s by default)                          ── fail → 401
                         3. parse JSON; body data.id must equal signed query data.id         ── fail → 400
                         4. INSERT event (dedupe_key) or bump deliveries on duplicate
                         5. respond 200 {"received":true}
                         6. setImmediate → drainPending()
                                 GET /v1/payments/{id}  →  upsert if not older  →  status=processed
                                 404                    →  status=ignored (e.g. panel simulation)
                                 other error            →  status=pending, backoff 30s·2^n, max 5 → failed
```

### 2.3 Signature check (excerpt)

From [`server/src/webhooks/verify.ts`](../../server/src/webhooks/verify.ts):

```ts
// Docs: https://www.mercadopago.com/developers/en/docs/your-integrations/notifications/webhooks
// SDK:  WebhookSignatureValidator (mercadopago@3.6.1, src/utils/webhook)
import { InvalidWebhookSignatureError, SignatureFailureReason, WebhookSignatureValidator } from 'mercadopago';

export function verifyWebhookSignature(input: VerifyInput): { ts: string } {
  WebhookSignatureValidator.validate({            // HMAC only; no toleranceSeconds (see the gap in 1.2)
    xSignature: input.xSignature,
    xRequestId: input.xRequestId,
    dataId: input.dataId,                          // from the QUERY STRING
    secret: input.secret,                          // <REPLACE> MP_WEBHOOK_SECRET
  });

  const header = Array.isArray(input.xSignature) ? input.xSignature[0]! : input.xSignature!;
  const ts = /(?:^|,)\s*ts=(\d+)/.exec(header)![1]!;

  if (input.toleranceSeconds > 0) {
    const tsMs = ts.length >= 13 ? Number(ts) : Number(ts) * 1000;   // accept ms or s
    const now = (input.now ?? Date.now)();
    if (Math.abs(now - tsMs) / 1000 > input.toleranceSeconds) {
      const requestId = Array.isArray(input.xRequestId) ? input.xRequestId[0] : input.xRequestId;
      throw new InvalidWebhookSignatureError(SignatureFailureReason.TimestampOutOfTolerance, requestId, ts);
    }
  }
  return { ts };
}
```

### 2.4 Receiver (excerpt)

From [`server/src/webhooks/router.ts`](../../server/src/webhooks/router.ts). Mount it **before** any global `express.json()`:

```ts
router.post('/mercadopago', express.raw({ type: '*/*', limit: '256kb' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const xSignature = req.get('x-signature');
  const xRequestId = req.get('x-request-id');
  const queryDataId = first(req.query['data.id']);   // Express 5 "simple" parser keeps the literal key

  try {
    verifyWebhookSignature({ xSignature, xRequestId, dataId: queryDataId,
                             secret: deps.secret, toleranceSeconds: deps.toleranceSeconds });
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) {
      log.warn('mp.webhook.invalid_signature', { reason: err.reason, requestId: err.requestId, ts: err.timestamp });
      return res.status(401).json({ error: 'invalid signature' });   // never log the secret or full signature
    }
    return res.status(500).end();
  }

  // ...parse JSON, reject body/query data.id mismatch (400), then:
  db.prepare(`INSERT INTO mp_webhook_events (...) VALUES (..., 'pending', ...)
              ON CONFLICT(dedupe_key) DO UPDATE SET deliveries = deliveries + 1`).run(/* ... */);

  res.status(200).json({ received: true });   // acknowledge first
  deps.onAccepted();                           // process out of band
});
```

### 2.5 Processing and persistence

[`server/src/webhooks/processor.ts`](../../server/src/webhooks/processor.ts) fetches the payment with the SDK (`new Payment(config).get({ id })`) and calls `upsertPayment` from [`server/src/mp/payments.ts`](../../server/src/mp/payments.ts). That function stores a flat row plus the full `raw_json`. It derives `direction` by comparing `collector_id` and `payer.id` with the account's own user id from `GET /users/me`, and sums `fee_details[].amount` into `fee_amount`.

A drain loop runs once per database, so concurrent triggers fold into a single loop. Failed events back off exponentially (30 s, 60 s, 120 s, 240 s) and become `failed` after five attempts. A 30-second ticker in `index.ts` picks up anything due.

### 2.6 Logging and error handling

Logs are JSON lines. Every webhook log carries `requestId` (the `x-request-id`), which matches what the Mercado Pago panel shows for a delivery. Signature failures log the SDK's `reason` (`MissingSignatureHeader`, `MalformedSignatureHeader`, `MissingTimestamp`, `MissingHash`, `SignatureMismatch`, `TimestampOutOfTolerance`) **[SDK]** and never the secret or the full signature. Dashboard API errors return `502` with Mercado Pago's status code, so a `401` (bad token) or `403` (missing permission) upstream is visible without leaking internals.

### 2.7 Values to replace

All live in `server/.env` (template: [`server/.env.example`](../../server/.env.example)):

| Variable | Where it comes from |
|---|---|
| `MP_ACCESS_TOKEN` | Your integrations, then your application, then Credentials. `TEST-...` for test, `APP_USR-...` for real data. |
| `MP_WEBHOOK_SECRET` | Your integrations, then your application, then Webhooks, after saving the configuration. Test and production modes have separate secrets. |
| `DASHBOARD_API_TOKEN` | Generate locally; the frontend sends it as `Authorization: Bearer ...`. |
| `MP_WEBHOOK_TOLERANCE_SECONDS` | Default 300. Set `0` while debugging clock issues, never in production. |
| Public host in the notification URL | Your deployment domain or tunnel URL. |

### 2.8 Run it

```sh
cd server
cp .env.example .env            # fill in the <REPLACE> values
npm ci
npm test                        # 18 tests: signature, idempotency, ordering, retries, auth, CSV
npm run dev                     # http://localhost:3001
npx cloudflared tunnel --url http://localhost:3001     # or: ngrok http 3001
```

---

## 3. Webhook configuration in Mercado Pago

**Inputs used** (assumptions A4 and A5):

- `<NOTIFICATION URL>` = `https://<your-public-host>/webhooks/mercadopago`
- `<TOPICS>` = `payment`

### 3.1 Via the Mercado Pago MCP Server

**[Gap] Not executed.** The official Mercado Pago MCP Server was not connected to the session that produced this guide, and it isn't listed in the connector directory available here. To run this step, add the server as a custom connector, authenticated with the application's access token, then run the calls below. Mercado Pago publishes the server URL and tool list in the "MCP Server" section of the developer docs. The tool names below are the ones Mercado Pago published for webhook configuration and simulation at the time of writing, so confirm them against the server's own tool list before use.

Call `save_webhook` with these inputs. The exact parameter names come from the tool's schema, which isn't reproduced here because it couldn't be checked:

- the notification URL for **test mode**: `https://<your-public-host>/webhooks/mercadopago`
- the topics: **`payment`** only
- later, the production URL in a separate call once 4.4 starts

Check the result. The tool output (or the panel) should show the URL saved for test mode with only "Payments" selected.

### 3.2 Via the panel (equivalent, always available)

1. Go to **Your integrations** and open the application whose credentials are in `.env`.
2. Open **Webhooks**, then **Configure notifications**.
3. In **Test mode**, enter `https://<your-public-host>/webhooks/mercadopago`.
4. Under events, tick **Payments** only.
5. Save, then copy the **secret signature** into `MP_WEBHOOK_SECRET` and restart the server.

Don't use the per-payment `notification_url` field for this project. It only applies to payments your application creates (Checkout Pro preferences, for example), and the dashboard mostly reads payments it didn't create.

---

## 4. Payment event simulation and validation

Run these in order. Each one isolates a different layer, so a failure points straight at the cause.

### 4.1 Local, signed simulation (no Mercado Pago involved)

`scripts/simulate-webhook.ts` is a local test tool, not a Mercado Pago feature. It signs a notification exactly as described in 1.2 using your `MP_WEBHOOK_SECRET`.

```sh
npm run simulate:webhook -- --data-id 123456789 --notification-id 42            # expect 200
npm run simulate:webhook -- --data-id 123456789 --bad-signature                 # expect 401 SignatureMismatch
npm run simulate:webhook -- --data-id 123456789 --stale                         # expect 401 TimestampOutOfTolerance
npm run simulate:webhook -- --data-id 123456789 --notification-id 42 --repeat 2 # expect 200 x2, deliveries=3
```

Output observed when this was run against the server on 2026-10-24:

```text
== valid             #1 200 {"received":true}
== bad signature     #1 401 {"error":"invalid signature"}
== stale ts          #1 401 {"error":"invalid signature"}
== duplicate x2      #1 200 {"received":true}   #2 200 {"received":true}
events: [{ "dedupe_key": "n:42", "type": "payment", "data_id": "123456789", "deliveries": 3, "status": "pending", ... }]
log:    mp.webhook.invalid_signature reason=SignatureMismatch
        mp.webhook.invalid_signature reason=TimestampOutOfTolerance
        mp.webhook.accepted duplicate=true (x2)
```

The event stayed `pending` because that build environment could not reach `api.mercadopago.com`. About six seconds later, after the SDK's own retries, it moved to `attempts: 1, last_error: "fetch failed"` (`MPConnectionError`) and was scheduled for a backed-off retry. That is the intended behaviour when the API is down.

### 4.2 Simulation from Mercado Pago (MCP or panel)

This proves that Mercado Pago can reach your URL and that your secret matches.

- **MCP [Gap: not executed here]:** call `simulate_webhook` with the URL mode `test`, topic `payment` and any `data.id`. Then call `notifications_history` to see the delivery and the status code your server returned.
- **Panel:** Your integrations, then Webhooks, then **Simulate notification**. Pick the test URL and the Payments event, enter a `data.id`, and send. The panel shows the HTTP status your server answered.

Expected result for a made-up `data.id`:

- HTTP **200** shown in the panel or MCP output.
- `GET /api/mp/webhook-events` shows a new row whose `status` moves to **`ignored`** with `last_error: "payment not found (404)"`. That is correct, because the simulated id isn't a real payment on this account.
- If the panel shows **401**, the secret in `.env` doesn't match the mode you simulated from. Check test against production, and restart after editing `.env`.

### 4.3 A real test payment

Create a payment with test users (seller is the account in `.env`, buyer is a second test user), for example through a Checkout Pro preference paid with a test card. Then check:

- A notification arrives: `mp.webhook.accepted` with `action: payment.created`, and often a later `payment.updated`.
- `GET /api/mp/payments` contains the payment with `direction: "in"`, the right `status`, `transaction_amount` and `fee_amount`, and `source: "webhook"`.
- `GET /api/mp/webhook-events` shows the events as `processed`.

### 4.4 Real account (production credentials)

Run this once the pipeline is proven, because it's the only way to see your own data:

1. Put the production access token and the **production** secret in `.env`, and configure the production URL in the panel.
2. Backfill with `npm run sync -- --since 2026-01-01`.
3. Make a small real transfer or QR payment, then check whether a webhook arrives and whether it appears in `/api/mp/payments`. This settles gap 1.6 for your account.
4. Generate an Account money report for the same week (section 5) and compare its rows with `/api/mp/payments`. Anything in the report but not in the API, such as card spend or fund yields, has to come from reports.

### 4.5 Post-conditions checklist

| Check | How | Expected |
|---|---|---|
| Event stored once per notification | `GET /api/mp/webhook-events` | One row per `dedupe_key`; `deliveries` > 1 on retries |
| Payment state current | `GET /api/mp/payments` | Status equals `GET /v1/payments/{id}` |
| No rollback from late events | Unit test *applies a newer status and ignores an out-of-order older one* | Passes |
| Invalid signature rejected | Simulator `--bad-signature` | 401, nothing stored |
| Replay rejected | Simulator `--stale` | 401 |
| Transient failure retried | Unit test *keeps a transiently failing event pending for retry* | `pending` then `processed` after backoff |
| Missed webhook recovered | Stop the server, make a payment, restart, wait one reconcile interval (or `POST /api/mp/sync`) | Payment appears with `source: "sync"` |
| Retries from Mercado Pago | Return a non-2xx on purpose (wrong secret), fix it, wait | Panel shows failed then successful delivery, and `deliveries` grows |

---

## 5. Data access beyond webhooks

These endpoints are what the dashboard UI will call. All require `Authorization: Bearer <DASHBOARD_API_TOKEN>`.

| Route | Mercado Pago call | Status |
|---|---|---|
| `GET /api/mp/me` | `GET /users/me` via SDK `User.get()` | **[SDK]** |
| `POST /api/mp/sync` `{since?, until?}` | `GET /v1/payments/search` via SDK `Payment.searchAll()`, once as collector and once filtered by `payer.id` | **[SDK]** for search; **[Gap]** coverage, see 1.6 |
| `GET /api/mp/payments?from&to&status&direction` | local DB | |
| `GET /api/mp/export/payments.csv` / `.json` | local DB (CSV is UTF-8 with BOM, formula-injection safe) | |
| `GET /api/mp/balance` | `GET /users/{user_id}/mercadopago_account/balance` | **[Gap]** The endpoint responds on `api.mercadopago.com` but has no page in the public reference, so the raw JSON is returned untouched. The documented route to balances is the Account money report. |
| `GET/POST/PUT /api/mp/reports/:kind/config` | `/v1/account/{release_report\|settlement_report}/config` | **[Docs]** |
| `POST /api/mp/reports/:kind` `{begin_date, end_date}` | `POST /v1/account/{kind}` | **[Docs]** |
| `GET /api/mp/reports/:kind` | `GET /v1/account/{kind}/list` | **[Docs]** |
| `GET /api/mp/reports/:kind/files/:fileName` | `GET /v1/account/{kind}/{file_name}` | **[Docs]** |

`release_report` is the **Releases report**: money released to the account, with fees and holds. `settlement_report` is the **Account money report**: every movement that changed the balance. Reports are generated asynchronously, so create one, poll the list until the file appears, then download it. A report config has to exist before the first report can be created. For test accounts the files come back empty **[Docs]**.

---

## 6. Failure modes and mitigations

| Failure | Symptom | Mitigation in this code |
|---|---|---|
| Wrong or rotated secret | Every delivery gets 401 with `SignatureMismatch` | Copy the secret for the right mode; logs show the reason and `requestId` to match against the panel |
| Clock drift | 401 with `TimestampOutOfTolerance` | Run NTP; raise `MP_WEBHOOK_TOLERANCE_SECONDS` temporarily, never to 0 in production |
| `ts` unit change by Mercado Pago or SDK | Every delivery rejected as out of tolerance | Unit-agnostic window (1.2); the unit tests cover both forms |
| Mercado Pago moves to `v2` signatures | 401 with `MissingHash` | Upgrade the SDK; the SDK's `supportedVersions` option is ready for it **[SDK]** |
| Duplicate deliveries | Same notification twice | `dedupe_key` plus the `deliveries` counter |
| Out-of-order deliveries | Older state after newer | `date_last_updated` guard in `upsertPayment` |
| Mercado Pago API down during processing | `MPConnectionError` / 5xx | Event stays `pending`, backoff, `failed` after 5 attempts; reconcile catches up |
| Webhook never delivered | Missing payment | 15-minute reconcile via payments search |
| Simulated or foreign `data.id` | 404 on fetch | Marked `ignored`, still answers 200 so Mercado Pago stops retrying |
| Body tampered with but signature replayed | Body `data.id` differs from signed query value | 400 |
| Leaked dashboard API | Financial data exposed | Bearer token with constant-time compare; webhook route is the only unauthenticated path |
| CSV opened in Excel runs a formula from a payment description | Formula injection | Cells starting with `= + - @` are prefixed with `'` |

---

## 7. Checklist

**Implement**

- [ ] `cd server && npm ci && npm test` passes all 18 tests.
- [ ] `.env` created from `.env.example` with **test** credentials.
- [ ] Server running and reachable over HTTPS through a tunnel or deployment.

**Configure**

- [ ] Webhook saved for **test mode**: URL `https://<host>/webhooks/mercadopago`, topic **Payments** only (MCP `save_webhook` or panel).
- [ ] Test-mode **secret signature** copied to `MP_WEBHOOK_SECRET` and the server restarted.

**Validate (test)**

- [ ] Local simulator gives 200, 401, 401 and a duplicate (4.1).
- [ ] Mercado Pago simulation (MCP `simulate_webhook` or panel) gets **200**, and the event ends `ignored` (4.2).
- [ ] A test-user payment ends `processed`, with the payment row correct (4.3).
- [ ] A missed webhook is recovered by `POST /api/mp/sync` (4.5).

**Go live (production, separate step)**

- [ ] Production token and **production** secret configured, plus the production URL in the panel.
- [ ] Backfill run with `npm run sync -- --since <date>`.
- [ ] Gap 1.6 measured on the real account against the Account money report.
- [ ] Logs checked for secrets (none), and `MP_WEBHOOK_TOLERANCE_SECONDS` > 0.
