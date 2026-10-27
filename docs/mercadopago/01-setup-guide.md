# Mercado Pago API Setup Guide (Personal Account)

This guide connects **your personal Mercado Pago account** to the personal finance dashboard so it can read your balance and transactions.

> **Who this is for:** the account owner (you, and your partner if you both want your accounts on the dashboard). Each person repeats these steps with their own Mercado Pago login.
>
> **Assumed country:** Argentina (`mercadopago.com.ar`). For another country, swap the domain (`.com.br`, `.com.mx`, `.cl`, `.com.co`, `.com.uy`, `.com.pe`). The API host is always `https://api.mercadopago.com`.

---

## 0. What the API can and cannot give you

Mercado Pago's public API is built for **merchants** (people who *receive* payments). A personal account can use it, but the data coverage is uneven. Set expectations before you start:

| Data you want | Available? | How |
|---|---|---|
| Your user profile / user ID | Yes | `GET /users/me` |
| Payments you **received** (transfers in, QR, link, sales) | Yes, real time | `GET /v1/payments/search` |
| Full history of **every movement of money in the account** (in and out: transfers sent, payments you made, withdrawals, refunds, fees) | Yes, as a CSV/XLSX report generated on demand | Reports API: *Released money* (`release_report`) and *Account money / all transactions* (`settlement_report`) |
| Current balance | Partially | Derived from the reports (each row has a running balance). A legacy balance endpoint exists but may be disabled for your account; the dashboard agent will test it. |
| Payments you **made** with the MP wallet (card/QR/in-store) | Only via the reports | Not returned by `payments/search` as a reliable list |
| Mercado Pago credit card (Tarjeta Mercado Pago), Mercado Crédito loans, investments/"rendimientos" detail, crypto | No public API | Manual export from the app (see section 7) |

**Bottom line:** the API plus the reports give you a complete ledger of your MP *account money* and a running balance. Anything that's a separate MP product (credit card, loans, crypto) has to be added manually.

---

## 1. Prerequisites

- A Mercado Pago account with **verified identity** (DNI and selfie done in the app). Production credentials won't activate without it.
- A computer with a browser (the developer panel works badly on mobile).
- About 15 minutes.

---

## 2. Create an application in the Developers panel

1. Go to **https://www.mercadopago.com.ar/developers/panel/app** and log in with your **personal** Mercado Pago account.
2. Click **Crear aplicación** (Create application).
3. Fill in the form:
   - **Nombre de la aplicación:** `Personal Finance Dashboard` (any name works).
   - **¿Qué tipo de solución vas a integrar?** Choose **Pagos online**. The option doesn't restrict read access; it only picks which docs they show you.
   - **¿Estás usando una plataforma de e-commerce?** **No**.
   - **¿Qué producto estás integrando?** **Checkout API** (any option is fine; you won't take payments).
   - Accept the terms and complete the captcha.
4. Click **Crear aplicación**. You land on the application's detail page.

---

## 3. Activate production credentials

Test credentials only see fake test users, so you need **production** credentials to see your real money.

1. In the app's left menu, open **Producción → Credenciales de producción**.
2. If prompted to activate them, fill in:
   - **Industria:** pick the closest (e.g. *Servicios* / *Otros*).
   - **Sitio web:** any URL you control. If you don't have one, use the dashboard's future URL or your GitHub profile URL. It isn't verified for read-only use.
3. Accept and click **Activar credenciales de producción**.
4. You'll now see:
   - **Public Key**: `APP_USR-xxxxxxxx-...` (not needed for the dashboard)
   - **Access Token**: `APP_USR-1234567890123456-102716-abcdef...-123456789` ← **this is the one you need**
   - Client ID / Client Secret (not needed unless the agent asks for OAuth later)

> The last number block of the Access Token (after the final `-`) is your **user ID**.

---

## 4. Understand what the Access Token can do (read this)

- The production Access Token is **full power** over your account through the API. It can read everything, and it can also create payment links, issue refunds, etc. There is **no read-only scope** for your own credentials.
- It **doesn't expire** on its own. It stays valid until you renew it in the panel.
- Treat it like your home banking password:
  - Never paste it in chats, emails, screenshots, GitHub issues, or code.
  - Never commit it to the repository.
  - Store it only as a **secret / environment variable** in the hosting platform the agent sets up (e.g. Vercel / Netlify / Railway / Supabase secrets), or in a local `.env` file that's in `.gitignore`.
  - The website must use it **only on the server side**. It must never reach the browser.
- If it leaks: go to **Credenciales de producción → Renovar** (Renew). The old token stops working immediately.

---

## 5. Quick self-test (optional, 2 minutes)

On your own computer, in a terminal (replace the token; don't paste it anywhere else):

```bash
export MP_ACCESS_TOKEN='APP_USR-your-token-here'
```

```bash
curl -s https://api.mercadopago.com/users/me -H "Authorization: Bearer $MP_ACCESS_TOKEN"
```

You should see JSON with your `id`, `nickname`, `email`, and `site_id: "MLA"`.

```bash
curl -s "https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=5" -H "Authorization: Bearer $MP_ACCESS_TOKEN"
```

You should see your last 5 received payments (it may be empty if you rarely receive money).

If you get `401 unauthorized`, the token is wrong or you copied the test token. Re-copy it from **Credenciales de producción**.

---

## 6. (Recommended) Set up automatic reports

The reports are what give the dashboard the **complete** money history (outgoing transfers, payments you made, withdrawals). They can be generated by API, so the agent can do this. You only need to confirm it's OK and give them an email for notifications.

You can also check them by hand in the web: **Tu negocio → Reportes** (or **Actividad → Reportes** depending on the account type):

- **Dinero liberado** (Released money / `release_report`): money that became available, including withdrawals if enabled.
- **Todas las transacciones / Dinero en cuenta** (Account money / `settlement_report`): every operation that affected your account balance.

If the Reportes section doesn't appear in your web account, tell the agent. They'll fall back to section 7.

---

## 7. Fallback for data the API doesn't cover

For the Mercado Pago credit card, loans, investments or if reports are unavailable:

1. Open **mercadopago.com.ar** on a computer → **Actividad**.
2. Use the filters (date range), then **Descargar** (download) → **Excel/CSV**.
3. Card statements: **Tarjeta de crédito → Resúmenes → Descargar PDF**.
4. Give these files to the dashboard (the agent will build an upload/import screen).

---

## 8. Checklist: what to hand over

See [`02-agent-handoff.md`](./02-agent-handoff.md) for the full brief for the website agent. Short version of what **you** provide:

- [ ] Production **Access Token** for each account, entered **directly as a secret** in the hosting platform or local `.env`. Don't paste it into a chat with the agent.
- [ ] Each account's **user ID** (last number in the token, or `id` from `/users/me`). This one is safe to share.
- [ ] **Country / site** (e.g. Argentina, `MLA`) and **currency** (`ARS`).
- [ ] **How far back** you want history (e.g. since 2024-01-01).
- [ ] Email address for report-ready notifications (optional).
- [ ] Whether the reports section works in your account (yes/no).
- [ ] A label per account (e.g. "Taiel", "Partner") so the dashboard can show each person and the combined total.

---

## 9. Maintenance

- **Rotating the token:** renew it in the panel, then update the secret in the hosting platform. Nothing else changes.
- **Revoking access entirely:** delete the application in the Developers panel.
- **Two people:** each person creates their **own** application under their **own** login and provides their own token. Don't share logins.
