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

- **App interface: Spanish (Argentina), with voseo** ("Elegí", "Ingresá"). Amounts in es-AR format (`$ 1.234,56`, `US$`).
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
6. **Reply with a concise checklist** of every change (✅ per item), grouped by section of the app, plus any open question.

## Design rules

- **Declutter.** Show one short line and hide the details behind a click (expand, ⋯ menu, **Detalles**). Never pile dates, reasons and progress into one row. Apply this to every new screen.
- **Short labels.** Avoid long names for small functions. If no short one works, ask the owner first.
- **No fixed explanatory notes** that just restate a state (e.g. "Falta configurar…" under a badge). A badge or an empty state is enough.
- **Visible feedback after saving.** A saved value shows as text with a pencil to edit it, not as a field that looks unchanged.
- **Dark mode must be as readable as light mode.** Check both. Small toggle buttons (`.pfd-toggle`) keep their light look when off.
- **Modals open centered.** One action per line when two would be confusing side by side.
- **Charts:** axes shorten with k / M (`moneyShort`, `axisK` in `ReportBits`); tooltips keep the full figure.
- **Amounts** go through `money()` in `web/src/lib/format.ts` (it honours **Ajustes → Monedas → Ocultar centavos**). Server text uses `formatMoney()`. Never format money by hand.
- **Dropdowns:** grouped lists use `GroupedSelect` (collapsible groups, no item counts). Every dropdown can be stretched from its corner (`lib/dropdown-resize.ts`).
- Serious, calm tone: no gamification, no emoji in the UI.

## Product decisions already made (don't undo them)

- **Recurrentes** = things that arrive on their own (bills, subscriptions, salary, card installments, purchases); you only confirm the real amount.
- **Pagos pendientes** = commitments you carry out yourself: monthly savings, personal debts, money owed to you. No product purchases.
  - Exact amounts only. A partial payment must include a written reason; the rest rolls over, and overpaying lowers the next month.
  - A USD target is paid only with USD. To pay with pesos, record an ARS → USD **Transf. propia** at a specific rate first.
  - A movement with exactly the amount links automatically (`autoLink`) on every write path: form, CSV and statement import.
  - Reminders go only to the person responsible, every day 8–18, and can't be turned off.
- **Deudores:** loans with a date or installments feed Pagos pendientes. Interest, installments, amount and dates are locked once saved. A partial return needs a reason.
- **Transf. propia between currencies:** the received amount is never typed. It is calculated from the amount and the **Tipo de cambio**, which starts at today's BNA quote.
- **Objetivos:** a goal linked to an account follows that account's balance. Only unlinked goals get **Registrar aporte**.
- **Notifications:** bell plus email (one shared Gmail with an app password, set in **Ajustes → Notificaciones**). Telegram stays optional and is not promoted; a future mobile app may carry notifications.
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
- **Field errors:** throw `FieldError(message, [fields])` on the client or `HttpError` on the server, so the field is outlined in red.

## Verify before pushing

```bash
npm test                 # server tests (add tests for new server behavior)
npm run typecheck
npm run build
npm run demo:reset       # rebuilds and reloads demo data on http://localhost:3000
```

- Log in as `ivan` / `demo-finanzas` and switch to the **Prueba (demo)** profile. Check the change in the browser, in light and dark mode, and at phone width (390 px) when the layout changed.
- In cloud sessions Playwright and Chromium are preinstalled: `require('playwright')`, `chromium.launch()`. Don't run `playwright install`.
- Guide screenshots live in `docs/guide/img/` at 1366×860, taken from the demo profile. A new wiki image only shows after a rebuild.

## Never

- Read, print or commit `.env`, the Gmail app password or other secrets. The API never returns the mail password.
- Commit data folders (`data/`, `data-demo/`) or uploaded files.
- Use the owner's email for anything but authorship.
- Open a pull request, or push to a branch other than the one you were given, without being asked.
