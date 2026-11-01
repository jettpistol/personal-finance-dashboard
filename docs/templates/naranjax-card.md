# Naranja X · credit cards · statement (PDF)

- **Reader id:** `naranjax-card` · code: `server/src/lib/statements/naranjax/card-text.ts`
- **Fixture:** `server/test/statements/fixtures/naranjax.layout.txt` (redacted) · tests: `server/test/statements/naranjax.test.ts`, `server/test/mail-statements.test.ts`
- **Sample:** [samples/naranjax-card.png](samples/naranjax-card.png)

## Where it comes from

One email a month with `ResumenDeCuenta_<due date>.pdf` attached (e.g. `ResumenDeCuenta_2026-11-10.pdf`), also downloadable from the Naranja X app. The Gmail search is `from:naranjax.com has:attachment filename:pdf` (`mailQuery`); the exact sender address hasn't been confirmed yet.

The PDF has an owner password (no editing) but no user password: `pdftotext` reads it without one. Three pages (A4).

## One statement, every card

It is the statement of the **account**, not of a card: every card of the account (physical Naranja X / Visa / Mastercard and the virtual one) is in it. The **TARJETA** column names the card (`NX Master`, `NX Virtual`, …); there are no card digits. All of it goes to one account in the app and the card name goes in each movement's note (`cardName` → "Tarjeta NX Master").

## How it's recognised

`TARJETA NARANJA S.A.U` (legal page) and `Tu total a pagar es` (first page) are both in the text.

## Layout

- **Page 1 (Hoja 1):** name and address; *Tu total a pagar es $X y vence el DD/MM/YY* (the **only date with its year**); total and minimum payment options.
- **Page 2 (Hoja 2):** *Detalle de consumos*, one block per holder: *Consumos tarjeta de crédito de <first name>*, the holder's subtotal (`$ 114.809,90`), `<FULL NAME>, Titular` (or `Adicional`), then the column header `FECHA  TARJETA  CUPON DETALLE  CUOTA/PLAN  $  U$S` and one line per movement (`DD/MM/YY`).
  - Lines starting with `*` and without a card are the account's own charges, with VAT: interest for late payment (*INTERES POR MORA…* → interest) and maintenance (*PLAN TURBO (REEMPLAZA COSTO DE MANTENIMIENTO)* → fee).
  - **CUOTA/PLAN:** `01` = one payment (no installment); `01/03` = installment 1 of 3. Any other plan code is warned about and read as one payment.
  - *Otros cargos:* `IVA Operaciones Identificadas con *` with its amount on the next line, next to `(Base Imponible $…)` (that base is **not** an amount to import), and `Impuesto de Sellos`. Dated on the close date.
  - `Total` then `$ X` on the next line: must equal page 1's total.
  - *Para que tengas en cuenta:* two columns side by side. Left: previous close and due date and amount (*Tu resumen anterior cerró el 27/09, venció el 10/10, por $X*), current close (*El resumen actual cerró el 27/10*), next close and due. Right: *Cuotas futuras* (`Diciembre/26 $9.000,00.` …) and limits (*Compra: $567.886.*, no cents).
- **Page 3 (Hoja 3):** *Pago del resumen anterior* (`FECHA  DETALLE  $  U$S`, e.g. `PAGO EN PESOS`), then the legal text: statement number (*RESUMEN Nº: …*), rates (*SALDO A FINANCIAR … TEM: x% TNA: y%*, dollar rates after *EN DOLARES*), minimum payment (*PAGO MINIMO: $X*).

## Quirks

- **Dates without year:** close, previous and next dates are `DD/MM`; the year is worked out from the due date (close is before it, next ones after).
- **Columns shift.** From one PDF to another the text can sit a character or two off its header (seen when the same text was re-rendered). The reader splits card / coupon / description / plan by content, with a tolerance on positions; amounts are split into pesos and dollars by whether they end before the `U$S` header.
- Amounts are positive for charges; a negative amount is a refund.
- The account number (`000.12345/6` style, under the address) gives `accountRef` (its last 4 digits).

## Checks

1. Previous balance − payments + purchases + other charges = total to pay (`total-due-ARS`).
2. Each holder's purchases add up to the subtotal printed above them (`card-totals-ARS`).
3. The detail page's `Total` equals page 1's total (`detail-total`).
4. Dollars: checked only if a dollar total is printed (`total-due-USD`, `card-totals-USD`); otherwise a warning.

## Seen so far

- **Statement closing 27/10/2026** (due 10/11/2026): two cards (NX Virtual, NX Master), one holder, one installment purchase, late-payment interest, Plan Turbo, IVA and Sellos, no dollars. Reconciled to the cent.

## Not seen yet

- Purchases in dollars (where the amount sits, whether a dollar total is printed).
- An additional holder (*Adicional*); a third card (*NX Visa*?); refunds; plan codes other than `01` and `X/Y` (*Plan Zeta*); an unpaid previous balance.
