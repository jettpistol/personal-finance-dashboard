# Banco Galicia · Visa credit card · statement (PDF)

- **Reader id:** `galicia-card-visa` · code: `server/src/lib/statements/galicia/card-text.ts` (shared with American Express)
- **Fixture:** `server/test/statements/fixtures/visa.layout.txt` (redacted) · tests: `server/test/statements/card.test.ts`, `server/test/statements-api.test.ts`
- **Sample:** [samples/galicia-card-visa.png](samples/galicia-card-visa.png)

## Where it comes from

Online Banking → Tarjetas → the card's statement → PDF.

## How it's recognised

`Tarjeta Crédito VISA` in the first 800 characters of the text.

## Layout

- Header: `Resumen N° …`, holder, `N° Cuenta:` (last 4 digits = `accountRef`), the total to pay in pesos and dollars, and one line with **six dates** `DD-Mmm-YY` (`27-Ago-26`): previous close, previous due, close, due, next close, next due.
- *PAGO MINIMO / LÍMITES*: minimum payment, purchase limit, financing limit. *TASAS*: nominal annual and effective monthly rates in pesos and dollars.
- *CONSOLIDADO* (columns PESOS / DÓLARES): previous balance, payments (`SU PAGO EN PESOS`), `TRANSFERENCIA DEUDA` (a dollar balance moved to pesos, with the rate `TC1500,000`).
- *DETALLE DEL CONSUMO* (FECHA · REFERENCIA · CUOTA · COMPROBANTE · PESOS · DÓLARES): purchases `DD-MM-YY`, a mark (`*`, `K`, `F`) before the merchant, installments `NN/NN`, a 6-digit voucher. After each card's purchases: `TARJETA 1111 Total Consumos de <NAME>` (pesos and dollars). An additional card's purchases follow.
- Charges at the end (no voucher): `IMPUESTO DE SELLOS`, `INTERESES FINANCIACION`, `DB IVA $ 21% <base>`, `IIBB PERCEP-…`. Then `TOTAL A PAGAR`, and *Cuotas a vencer* (a row of months over a row of amounts).

## Quirks

- Amounts are read only from the PESOS / DÓLARES columns; numbers inside the reference (`USD 2,99`, `TC1500,000`, the IVA base) are ignored.
- Dollar purchases stay in dollars; the `TRANSFERENCIA DEUDA` line is a transfer, not spending.
- Installments carry the original purchase date (can be months old).
- The marks `*`, `K`, `F` are kept but not interpreted.

## Checks

1. Previous balance + payments + purchases + charges = `TOTAL A PAGAR`, in pesos and in dollars separately (`total-due-ARS`, `total-due-USD`).
2. Each card's purchases add up to its `Total Consumos` (`card-totals-ARS`, `card-totals-USD`).

## Covered by the fixture

- Statement closing 01/10/2026: two cards (holder and additional), dollar purchases, a refund, installments, a dollar debt moved to pesos, Sellos, interest, IVA and IIBB.
