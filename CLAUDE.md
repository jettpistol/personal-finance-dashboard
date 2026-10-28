# CLAUDE.md

Standing instructions for any agent working in this repo. They come from the owner's requests over many sessions: follow them without being told again. When the owner states a new standing preference, add it here in the same change.

## The project

**Finanzas** is a free, self-hosted finance dashboard for one couple in Argentina (demo users Iván and Milagros). Two logins; three dashboards (**Hogar**, **Mío**, the partner's); ARS and USD; inflation (INDEC CPI) built in. Read before changing things:

- [`PRODUCT.md`](PRODUCT.md): who it's for and the product principles.
- [`docs/design.md`](docs/design.md): the money model (scopes, privacy, splits, installments). Read it before touching money logic.
- [`web/DESIGN.md`](web/DESIGN.md): the visual design system (colors, type, components, do's and don'ts).
- [`docs/guide/`](docs/guide/README.md): the user guide, also shown in the app at `/ayuda`.
- [`docs/known-issues.md`](docs/known-issues.md): known bugs not fixed yet.

## Languages

- **App interface: Spanish (Argentina), with voseo** ("Elegí", "Ingresá"). Amounts in es-AR format (`$ 1.234,56` for pesos, `USD 1.234,56` for dollars; never `US$`).
- Formal, impersonal Spanish for instructions and help text inside the app (no chatty asides). Short labels and toasts can keep voseo.
- **The guide (`docs/guide/*.md`) and the patch notes are in English.** Screen names and buttons are quoted in Spanish, in bold, exactly as they appear.
- The owner writes in English; reply in English.
- When the owner names a feature in English (e.g. "Objectives"), use the Spanish word in the UI (e.g. **Objetivos**) and say so.

## Every change you push

1. **Bump the version** in the root `package.json` (patch for fixes and small tweaks, minor for a batch of features).
2. **Add a patch notes entry** in `web/public/patch-notes.html`:
   - English only, newest first, with a matching box in the index (the whole box is the link, not just the number);
   - one plain bullet per user-visible change, no marketing tone;
   - update "Latest version" in the menubar.
3. **Update the version mentioned in `README.md`** (`Finanzas vX.Y.Z · …`).
4. **Update the guide** for anything a user would notice. If the README table of sections changes, the wiki sidebar follows it. Retake screenshots that changed (see Verify).
5. **Verify** (below), then commit and push. Don't open a pull request unless the owner asks.
6. **Reply with a concise checklist** of every change, as `- [ ]` bullets (never the ✅ emoji), grouped by section of the app, plus any open question.
7. **Don't push a tiny text fix on its own** (a typo, one line in CLAUDE.md): hold it and include it in the next batch of changes.

## Design rules

- **Short eye travel.** Keep related things within one glance: a label next to its value or control, a tag next to what it labels, figures next to their title. Pages sit in a centered column sized to their content (`PAGE_WIDTH` in `Layout.tsx`; a new page picks narrow, medium or wide). A lone small card is centered, never a half-page box with one switch. Check new screens at 1920 px as well as 1366 px.
- **Declutter.** Show one short line and hide the details behind a click (expand, ⋯ menu, **Detalles**). Never pile dates, reasons and progress into one row. Apply this to every new screen.
- **Short labels.** Avoid long names for small functions. If no short one works, ask the owner first.
- **No fixed explanatory notes** that just restate a state (e.g. "Falta configurar…" under a badge). A badge or an empty state is enough.
- **Visible feedback after saving.** A saved value shows as text with a pencil to edit it, not as a field that looks unchanged.
- **Dark mode must be as readable as light mode.** Check both. Small toggle buttons (`.pfd-toggle`) keep their light look when off.
- **Modals open centered.** One action per line when two would be confusing side by side.
- **Charts:** axes shorten with k / M (`moneyShort`, `axisK` in `ReportBits`); tooltips keep the full figure.
- **Amounts** go through `money()` in `web/src/lib/format.ts` (it honours **Ajustes → Monedas → Ocultar centavos**). Server text uses `formatMoney()`. Never format money by hand.
- **Currency:** dollars are written `USD 1.234`, never `US$`. Amount boxes show only `$`; the currency is shown once, by its selector or account, never twice.
- **Typed dates** are strict and bounded app-wide (theme default `parseTypedDate`, 1900 to 2100): an impossible date is never taken; the field goes back to the last valid value or its placeholder. Give date fields a sensible `minDate`/`maxDate` when the context has one.
- **Dropdown ticks** go at the end of the option (Select/MultiSelect default `checkIconPosition: 'right'`, GroupedSelect the same), so names never shift when selected.
- **Dropdowns:** grouped lists use `GroupedSelect` (collapsible groups, no item counts). Every dropdown can be stretched from its corner (`lib/dropdown-resize.ts`).
- Serious, calm tone: no gamification, no emoji in the UI.

## Product decisions already made (don't undo them)

- **Recurrentes** = things that arrive on their own (bills, subscriptions, salary, card installments, purchases); you only confirm the real amount.
- **Pendientes** (formerly Pagos pendientes) = commitments you carry out yourself: monthly savings, personal debts, money owed to you. No product purchases.
  - Two separate lists, **Pagos** and **Cobros**, switched by a toggle in the header, each with its own counter; the sidebar counter is their sum. Done items go to **Completados** (green), never just disappear.
  - One **Registrar** button: it asks whether the movement is already loaded (pick it with `MovementPicker`) or new (Nuevo movimiento opens linked to the item, `pending` in `POST /transactions`). Short amounts always ask why before anything is saved.
  - Exact amounts only. A partial payment must include a written reason; the rest rolls over, and overpaying lowers the next month.
  - A USD target is paid only with USD. To pay with pesos, record an ARS → USD **Transf. propia** at a specific rate first.
  - A movement with exactly the amount links automatically (`autoLink`) on every write path: form, CSV and statement import.
  - Reminders go only to the person responsible, every day 8–18, and can't be turned off.
- **Deudores:** loans with a date or installments feed Pendientes → Cobros. Interest (none, fixed or tied to inflation), installments, their period (every N days, weeks or months; default 1 month), amount and dates are locked once saved. Inflation-tied installments follow `loanSchedule` (CPI from the loan month to the month before each due date; a month counts from the 15th of the next one; late months go to the next installment or a final adjustment). A partial return needs a reason. Forgiving is **Perdonar deuda**, red, with a confirmation.
- **Transf. propia between currencies:** the received amount is never typed. It is calculated from the amount and the **Tipo de cambio**, which starts at today's BNA quote.
- **Objetivos:** a goal linked to an account follows that account's balance. Only unlinked goals get **Registrar aporte**.
- **Notifications:** bell plus email (one shared Gmail with an app password, set in **Ajustes → Notificaciones**). Telegram stays optional and is not promoted; a future mobile app may carry notifications.
- **Mercado Pago:** each person connects their own account in **Ajustes → Mercado Pago**, and it fills exactly one account in Cuentas per data profile (`mp_links`): created as "Mercado Pago" if there's none, otherwise the person must pick among their existing Mercado Pago accounts (a prompt with no way out). A second Mercado Pago account per person is refused. History starts on 1 October 2026 unless set. The owner's guidelines are in [`docs/mercadopago/`](docs/mercadopago/); the note at the top of the agent brief says how this repo deviates from it, and `03-reports-reference.md` holds the confirmed report facts (it overrides the brief). Mercado Pago's developer sites can't be reached from cloud sessions: ask the owner to paste pages instead of guessing fields.
- **Data profiles:** a new install opens on the empty **Vacío** profile; demo data lives in **Prueba (demo)**.
- Changing the data profile or the account keeps you on the same page and refreshes it.

## Code map

- npm workspaces: `server/` (Fastify 5, better-sqlite3, zod 4, vitest) and `web/` (React 19, Mantine 8, react-query, react-router 7, Vite).
- **Money is integer cents** everywhere. Each movement is in its account's currency; cross-currency transfers store `amount` and `to_amount`.
- **Databases:** the core DB (users, sessions, profiles, mail settings) is reached with `coreDb()`. Each data profile has its own DB, reached with `db()` (AsyncLocalStorage picks the profile per request).
  - Migrations live in `server/src/db/migrations.ts`: **append only**, never edit an old one.
  - Simple household settings are keys in the `settings` table (`getSetting`/`setSetting`, defaults in `db/index.ts`, schema in `routes/core.ts`).
- **Business logic lives in `server/src/lib/`; routes stay thin.** Libs must not import from `routes/`.
- **Notifications:** `notify()` in `lib/notify.ts` sends to the bell, email and Telegram. Kinds: budget, recurring, review, pending, system.
- **Web:** pages in `web/src/pages`, shared pieces in `web/src/components`, helpers in `web/src/lib`. Global styles in `web/src/styles.css`, with `.pfd-*` class names. The wiki is in `web/src/wiki`.
- **Deshacer (undo):** every mutating `/api` route is journaled automatically (`lib/undo.ts`) as long as all its database writes happen before its first `await`. A route that writes after an await goes in `NOT_WRAPPED`, or wraps its synchronous write section in `undoable(req, () => …)`. Delete stored files with `removeStoredFile()` so an undo can restore them. New tables are journaled by default; add one to `JOURNAL_EXCLUDED` (`db/undo-journal.ts`) if it holds secrets or isn't household data. Every hard-to-reverse action in the UI ends with a short, specific `notifyOk(...)` (e.g. "Perdonados $ 70.000 a Juan."), which shows at the bottom with **Deshacer** by itself; trivial toggles don't need one.
- **Field errors:** throw `FieldError(message, [fields])` on the client or `HttpError` on the server, so the field is outlined in red.
- **Reusable pieces:** before building a list, picker or window, check [`docs/dev/components.md`](docs/dev/components.md). Picking existing movements is always `MovementPicker` (one component with options), never a new copy; document new options and new uses there.

## Verify before pushing

```bash
npm test                 # server tests (add tests for new server behavior); each test file gets its own temp DATA_DIR (test/setup.ts)
npm run typecheck
npm run build
npm run demo:reset       # reloads only the Prueba (demo) profile, keeps logins and connections; serves http://localhost:3000
```

- Log in as `ivan` / `demo-finanzas` and switch to the **Prueba (demo)** profile. Check the change in the browser, in light and dark mode, and at phone width (390 px) when the layout changed.
- In cloud sessions Playwright and Chromium are preinstalled: `require('playwright')`, `chromium.launch()`. Don't run `playwright install`.
- Guide screenshots live in `docs/guide/img/` at 1366×860, taken from the demo profile. A new wiki image only shows after a rebuild.

## Credentials that touch money (Mercado Pago and any future bank)

- Store them only through `encryptSecret` / `decryptSecret` (`lib/secrets.ts`): AES-256-GCM, bound to the user, key in `SECRET_KEY` or `DATA_DIR/secret.key`, never in a database.
- Never return them from the API, not even partly; never log them; validate them by hand (not with a schema that could echo the input). The browser keeps a typed token only in component state until it's saved.
- Each person's connection is theirs only: routes act on `req.userId`, never on another user.
- Mercado Pago reads go through `mpGet()` (GET only, path allowlist). The only writes the owner approved (2026-10-28) go through `mpWrite()`: save a report's settings (`POST`/`PUT /v1/account/{release,settlement}_report/config`) and ask for a report (`POST /v1/account/{release,settlement}_report`). Never add payment, refund, transfer or other money-moving endpoints; any other write (even report scheduling) needs the owner's explicit approval first.
- Tests use a local fake (`MP_API_URL`); never call the real API with a real token from code or tests.

## Never

- Delete a whole data folder (`data/`, `data-demo/`) from a script or npm command: it holds logins, connections and the encryption key. Reset one profile instead (`resetProfile` in `lib/profiles.ts`).

- Read, print or commit `.env`, `secret.key`, the Gmail app password, Mercado Pago tokens or other secrets. Never ask the owner to paste a token in chat. The API never returns the mail password.
- Commit data folders (`data/`, `data-demo/`) or uploaded files.
- Use the owner's email for anything but authorship.
- Open a pull request, or push to a branch other than the one you were given, without being asked.
