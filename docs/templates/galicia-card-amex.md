# Banco Galicia · American Express credit card · statement (PDF)

- **Reader id:** `galicia-card-amex` · code: `server/src/lib/statements/galicia/card-text.ts` (shared with Visa)
- **Fixture:** `server/test/statements/fixtures/amex.layout.txt` (redacted) · tests: `server/test/statements/card.test.ts`
- **Sample:** [samples/galicia-card-amex.png](samples/galicia-card-amex.png)

## Where it comes from

Online Banking → Tarjetas → the card's statement → PDF.

## How it's recognised

`Tarjeta Crédito AMERICAN EXPRESS` in the first 800 characters of the text.

## Layout, quirks and checks

Same layout as the Visa statement: see [galicia-card-visa.md](galicia-card-visa.md). Galicia prints both cards with one template, and one reader handles both.

## Covered by the fixture

- Statement closing 27/08/2026: one card, purchases in pesos and one in dollars.
