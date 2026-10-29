# Reusable building blocks (web)

Pieces built once and used by several screens. Before writing a new list, picker or window for one of these jobs, use (or extend) the existing piece instead of copying it. Each one takes options so a screen turns on only the features it needs.

## MovementPicker: "which movement was it?"

`web/src/components/MovementPicker.tsx`

Lists existing movements and lets the person pick one (radios) or several (checkboxes). Rows show the date, description, account (and destination for transfers), and the amount; with a `target`, rows with exactly that amount are tagged **Exacto** and listed first.

Three ways to use it:

| Export | Use it when |
| --- | --- |
| `MovementPicker` | The list alone, inside your own form. Controlled: `value` (ids) and `onChange(ids, picked)`. |
| `MovementPickerBody` | The list with an intro line and extra fields underneath, inside your own window (as **Pendientes → Registrar** does, next to its "new movement" option). |
| `MovementPickerModal` | A complete window with Cancelar and a confirm button; `onConfirm(picked)` runs the action. |

Options (`MovementPickerProps`):

| Option | What it does |
| --- | --- |
| `queryKey` | Cache key for the list; include whatever changes it. |
| `load` | Where the movements come from. Either a screen's own endpoint (it decides what qualifies, e.g. `GET /pending/:source/:id/candidates`) or `transactionsLoader({ from, to, type, account_id, status, q })` over `GET /transactions`. |
| `multiple` | Several movements (checkboxes) instead of one. |
| `target` | `{ amount, currency }` being looked for: exact matches first and tagged, amounts shown in that currency. |
| `filter` | Extra condition on top of `load`. |
| `searchable` | A search box (description, merchant, account). |
| `empty` | Text when there's nothing to pick. |

A movement can carry `value`: what it counts for here when that isn't its amount (the dollars an ARS → USD conversion delivered, for example). Exact matching and the shown amount use it.

The window version leaves validation and errors to the caller: throw from `onConfirm` to keep it open. Extra fields go in `children`, a function of what's picked (e.g. a required "¿Por qué es parcial?" when the picked amount is short).

```tsx
<MovementPickerModal
  title="Elegir el pago"
  confirmLabel="Saldar"
  queryKey={['balances', 'settle-candidates']}
  load={transactionsLoader({ type: 'transfer', from: addDays(today(), -60) })}
  target={{ amount: owed, currency: 'ARS' }}
  searchable
  onConfirm={async ([tx]) => { await api.post('/settlements/link', { transaction_id: tx.id }); }}
  onClose={close}
/>
```

### Where it's used

- **Pendientes → Registrar → Elegir un movimiento cargado**: one movement, exact amount first, reason when partial.

### Where it fits next

- **Gastos compartidos → Saldar**: mark a transfer already made between you as the settlement, instead of creating a new one.
- **Deudores → Devolución**: pick the income that was the return, so it links to the movement (today it only records the amount).
- **Recurrentes**: confirm a pending item with a movement that came in by import, instead of a second, duplicate one.
- **Objetivos → Registrar aporte**: pick the transfer that was the contribution.
- **Importar**: resolve a "possible duplicate" by pointing at the movement it duplicates.
- **Movimientos**: the same rows with `multiple` for "Asignar categoría" or "Eliminar" on a hand-picked set across pages.

## Others already shared

| Piece | File | Notes |
| --- | --- | --- |
| `GroupedSelect` | `components/GroupedSelect.tsx` | Select with collapsible groups (accounts, categories). Tick at the end; no item counts. |
| `MoneyInput`, `AccountSelect`, `CategorySelect` | `components/inputs.tsx` | Amounts in units with es-AR separators and only a `$` prefix (the currency is shown next to it, never twice). |
| Dropdown resize corner | `lib/dropdown-resize.ts` | Every dropdown list can be stretched from its bottom-right corner. |
| `ImportReview` | `components/ImportReview.tsx` | The review table of any import (Importar, Resúmenes, Mercado Pago). Rows may carry `external_id`, `fees` and `merge_with`; the server saves them with `commitImportRows()` (`server/src/lib/import-commit.ts`). |
| `FeesEditor` | `components/FeesEditor.tsx` | Platform fees inside a movement's amount (`tx_fees`, `server/src/lib/fees.ts`), for any platform. Used in the movement form; a future broker or marketplace import fills the same `fees` array. |
| `money()`, `moneyShort()` | `lib/format.ts` | All amounts. `USD 1.234`, never `US$`; honours **Ajustes → Monedas → Ocultar centavos**. |
