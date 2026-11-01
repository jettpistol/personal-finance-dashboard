# Banco Galicia · Caja de Ahorro en pesos · extract (Excel)

- **Reader id:** `galicia-account-xlsx` · code: `server/src/lib/statements/galicia/account-xlsx.ts` (movement types in `account-movement.ts`)
- **Fixture:** built in code by `sampleAccountXlsx()` in `server/test/statements/helpers/galicia-xlsx.ts` · tests: `server/test/statements/account-xlsx.test.ts`, `server/test/statements-api.test.ts`
- **Sample:** [samples/galicia-account-xlsx.png](samples/galicia-account-xlsx.png)

## Where it comes from

Online Banking → the savings account's movements → download as Excel (.xlsx). Can cover several months in one file, so it's preferred over the monthly PDF.

## How it's recognised

An .xlsx whose first sheet has a row with `Fecha` in the first column and `Movimiento…` in the second.

## Layout

- Header lines above the table: `Banco Galicia - Caja Ahorro Pesos`, `Nro. de Cuenta: ...1234567`, `Fecha Actual: DD/MM/YYYY`, `Hora Actual`, `Intervalo de Consulta: del DD/MM/YYYY al DD/MM/YYYY`.
- Columns: **Fecha · Movimiento · Débito · Crédito · Saldo Parcial · Comentarios**.
- **Movimiento** is one cell with several lines: the bank's label first (`COMPRA DEBITO`, `TRANSFERENCIA A TERCEROS`, `ACREDITAMIENTO DE HABERES`…), then details (merchant, name, CUIL/CUIT, operation number, card number). `account-movement.ts` turns the label into a kind (purchase, transfer, salary, card payment, FX, refund…) and the details into merchant or counterparty.

## Quirks

- The workbook is unusual: `x:` namespace prefix, absolute part paths, no cell references, every cell typed text. `xlsx-reader.ts` reads it without a library.
- Débito/Crédito use `1.234,56`; **Saldo Parcial has no thousands separator** (`361552,35`).
- Rows are **newest first**; they're reversed so the balance chain reads forwards (same-day order is kept).
- Movements dated after `Fecha Actual` are warned about but read.
- Some rows give only `CU 20123456789` instead of a name.

## Checks

- The balance after each movement equals the previous balance plus the movement (`balance-chain`).

## Covered by the fixture

- Extract for 01/09/2026–26/10/2026: dollar sale, card payment, debit purchase, transfer to a third party, salary, promo refund.
