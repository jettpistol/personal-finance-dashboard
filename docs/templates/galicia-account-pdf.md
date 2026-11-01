# Banco Galicia · Caja de Ahorro en pesos · monthly statement (PDF)

- **Reader id:** `galicia-account-pdf` · code: `server/src/lib/statements/galicia/account-pdf.ts` (movement types in `account-movement.ts`)
- **Fixture:** `server/test/statements/fixtures/account.layout.txt` (redacted) · tests: `server/test/statements/account-pdf.test.ts`
- **Sample:** [samples/galicia-account-pdf.png](samples/galicia-account-pdf.png)

## Where it comes from

Online Banking → the savings account → monthly statements → PDF. Fallback for when the Excel extract isn't available: both give the same movements, so import only one of them.

## How it's recognised

`Resumen de Caja de Ahorro` in the first 800 characters of the text.

## Layout

- Header: holder and CUIL; *Datos de la cuenta* with `N° 1234567-8 139-1` (account and branch); *Período de movimientos* (from / to dates, `DD/MM/YYYY`) and *Saldos* (opening and closing).
- *Movimientos*: **Fecha · Descripción · Origen · Crédito · Débito · Saldo**. One row per movement with date `DD/MM/YY`, the bank's label, an optional 4-digit origin, the signed amount and the balance; the detail lines (merchant, name, CUIL, numbers) follow below until a blank line.
- Footer: `Total` with total credits, total debits and closing balance.

## Quirks

- Long labels wrap onto a second line (`TRANSFERENCIA DE CUENTA` / `PROPIA`, `… GALICIA`); the reader joins them.
- Only one amount column is filled per row; debits are already negative.

## Checks

1. Balance chain, movement by movement (`balance-chain`).
2. Sum of credits, sum of debits and closing balance match the `Total` line (`total-credits`, `total-debits`, `closing-balance`).

## Covered by the fixture

- Statement for 26/09/2025–31/10/2025.
