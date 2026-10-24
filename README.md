# personal-finance-dashboard
Personal finance dashboard for a couple

## Structure

- [`server/`](server) is the backend. It connects a Mercado Pago account, receives payment webhooks, keeps a local SQLite ledger and exports it as CSV or JSON.
- [`docs/mercadopago/webhooks-testing-guide.md`](docs/mercadopago/webhooks-testing-guide.md) is the end-to-end guide to configuring, simulating and validating Mercado Pago webhooks, including the known gaps in the official docs.

## Quick start (backend)

```sh
cd server
cp .env.example .env   # fill in the <REPLACE> values
npm ci
npm test
npm run dev            # http://localhost:3001
```
