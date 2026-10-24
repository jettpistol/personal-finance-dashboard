# Metas de ahorro

Track savings toward a target (an emergency fund, a trip, a future car) and see how much you need to put aside each month to get there on time.

![Metas de ahorro page with one card per goal](img/metas.png)

## What you see

One card per goal, ordered by deadline (soonest first, goals without a deadline last). Each card shows:

- the **name**, and small badges: **Hogar** or **Personal**, then either the linked account's name or **Aportes manuales**, and **Archivada** if it is archived;
- the amount **saved** in large type and *de* the **target** below it;
- **Para el** *date* and how many months are left, when the goal has a deadline;
- **Avance** with a percentage and a progress bar;
- a line at the bottom:
  - **Meta cumplida.** once the saved amount reaches the target;
  - **Necesitás ahorrar $ X por mes** when there is a deadline;
  - **Faltan $ X** when there is no deadline;
- a **Registrar aporte** button on goals with manual contributions.

The page shows the household goals, your own goals and, if your partner shares their dashboard, their personal goals (read only, without the **⋯** menu). It does not filter by the dashboard chosen in the top bar.

Archived goals are hidden. Turn on **Mostrar archivadas** to see them, faded.

## What you can do

### Create a goal

1. Click **Nueva meta**.
2. Fill in:
   - **Nombre**, for example *Fondo de emergencia*;
   - **Objetivo** (the target) and **Moneda** (ARS or USD);
   - **Fecha límite** (optional, today or later);
   - **Cuenta vinculada** (optional, see below);
   - **Ámbito**: **Hogar (de los dos)** or **Mía**. It starts on **Mía** if you are viewing your own dashboard, otherwise on **Hogar**;
   - **Color** for the progress bar.
3. Click **Guardar**.

### Choose how progress is measured

There are two ways, and each goal uses one:

- **Linked account**: pick an account in **Cuenta vinculada**. The saved amount is that account's current balance. Every deposit or withdrawal you record in that account moves the goal. This works best with an account used only for this purpose, such as a savings account for the trip.
- **Manual contributions**: leave **Cuenta vinculada** empty (*Sin vincular (aportes manuales)*). The saved amount is the sum of the contributions you record on the goal.

### Record a contribution (manual goals)

1. Click **Registrar aporte** on the card, or **⋯ → Aportes**.
2. Enter the **Fecha**, the **Monto** and an optional **Nota**. Use a negative amount for a withdrawal.
3. Click **Registrar aporte**. The list below shows every contribution (green) and withdrawal (red).
4. Use the trash icon on a row to delete it.

Contributions are a record for the goal only. They do not create a movement and do not change any account balance. If you also moved real money, record that movement in [Movimientos](movimientos.md) as usual.

### Edit, archive or delete

- **⋯ → Editar** opens the same form. Change anything, including the linked account.
- To archive a goal (finished or put on hold), open **⋯ → Editar**, turn on **Archivada** and save. Turn it off the same way to bring it back.
- **⋯ → Eliminar** deletes the goal and all its recorded contributions. Linked accounts and their movements are not touched.

You can edit household goals and your own goals. Your partner's personal goals are read only.

## How the numbers are worked out

- **Saved, linked account**: the account's balance today (confirmed movements up to today; future installments do not count yet). If the account is in another currency than the goal, it is converted at today's BNA quote.
- **Saved, manual**: all contributions added up, withdrawals subtracted.
- **Avance** = saved ÷ target × 100, capped at 100%.
- **Months left** = the months from the current month to the deadline's month, counting both. In October with a deadline in March that is 6 (October to March). A deadline this month, or one already past, counts as 1.
- **Necesitás ahorrar por mes** = (target − saved) ÷ months left, rounded up to the cent. It is recalculated every time you open the page, so if you fall behind, the monthly amount goes up.

For example: target $ 3.000.000, saved $ 1.200.000, 6 months left: $ 1.800.000 ÷ 6 = $ 300.000 per month.

## Tips

- A goal is not archived automatically when it is reached. It shows **Meta cumplida.** and stays until you archive it.
- If you switch a manual goal to a linked account, its contributions are kept but no longer counted. Unlinking the account brings them back.
- Changing a manual goal's **Moneda** does not convert the contributions already recorded; their numbers are simply read in the new currency.
- Inflation is not applied to targets. For a long goal in pesos, consider setting it in dollars or updating the target from time to time.

See also: [Guide index](README.md) · [Cuentas](cuentas.md) · [Movimientos](movimientos.md) · [Presupuestos](presupuestos.md) · [Reportes](reportes.md) · [How the numbers are worked out](como-se-calcula.md)
