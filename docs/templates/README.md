# Statement templates

Every bank, card or bill document the app can read on its own, without a preset. In the app the same list is **Resúmenes → Plantillas**, where each one has **Ejemplo** (its sample) and **Detalles**.

Templates are added **only in coding sessions, directly to this repo**: someone shares an original document, the session studies it, writes the reader and records here what it learned, so the next statement of that kind is read the same way every time. Nobody uploads a template from the app. (CSV and Excel files that no template knows can still be loaded with a preset in **Importar**; that is a separate, do-it-yourself tool.)

| Template | File | Currencies | Sample | Notes |
| --- | --- | --- | --- | --- |
| Banco Galicia · Caja de Ahorro en pesos · extract | Excel (.xlsx) | ARS | [image](samples/galicia-account-xlsx.png) | [galicia-account-xlsx.md](galicia-account-xlsx.md) |
| Banco Galicia · Caja de Ahorro en pesos · monthly statement | PDF | ARS | [image](samples/galicia-account-pdf.png) | [galicia-account-pdf.md](galicia-account-pdf.md) |
| Banco Galicia · Visa credit card statement | PDF | ARS, USD | [image](samples/galicia-card-visa.png) | [galicia-card-visa.md](galicia-card-visa.md) |
| Banco Galicia · American Express credit card statement | PDF | ARS, USD | [image](samples/galicia-card-amex.png) | [galicia-card-amex.md](galicia-card-amex.md) |
| Naranja X · credit cards (all cards of the account) · statement | PDF (also by email) | ARS, USD | [image](samples/naranjax-card.png) | [naranjax-card.md](naranjax-card.md) |

The samples are **not** real documents: the repo is public, so each one is the template's redacted test fixture (fake names, account numbers and amounts that still add up) drawn as the original looks. If the repo ever becomes private, real redacted screenshots could replace them.

## Adding or fixing a template (in a coding session)

1. **Get the original.** The owner shares the PDF or spreadsheet in the session. It stays in the session's scratchpad: never commit a real document, a real screenshot, or text with real names, addresses, account numbers or amounts.
2. **Study it.** For PDFs, read it the way the app does: `pdftotext -layout file.pdf -` (poppler). Note where each figure lives, which dates carry a year, how pages break, what the totals are, and which lines are not movements.
3. **Make the fixture.** Copy the extracted text (or the sheet rows) to `server/test/statements/fixtures/<name>`, replacing names, addresses, account and document numbers and amounts. Recompute the amounts so every total the document prints still adds up, and keep the columns aligned. Check the real file and the fixture with the reader before committing; only the fixture goes in.
4. **Write the reader** in `server/src/lib/statements/<institution>/` and add it to `READERS` in `server/src/lib/statements/registry.ts`, with the Spanish texts the app shows (`reads`, `howToGet`, `checks`, `limits`) and, if the document arrives by email, a `mailQuery` for the Gmail search. Every reader must check the figures it reads against the totals the document prints; a file that doesn't add up is never imported.
5. **Test it** in `server/test/statements/`, from the fixture: header data, every movement, signs, installments, the checks passing, and the checks failing when a figure is changed.
6. **Record it here**: a notes file `<reader id>.md` (copy the shape of an existing one), a row in the table above, and the sample image: add the fixture to `SOURCES` in `server/scripts/template-samples.ts` and run `npm run template-samples --workspace server -- <reader id>`. `server/test/statements/templates.test.ts` fails until the notes, the row and the sample exist.
7. Then the usual release routine in `CLAUDE.md` (version, patch notes, guide: the table in `docs/guide/resumenes.md`).

When a real statement of a known template fails to read or doesn't add up, treat it the same way: get the document, find what changed, add the new case to the fixture or a new fixture, fix the reader and write it down in the template's notes (**Seen so far** / **Covered by the fixture**).
