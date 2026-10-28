# Presupuestos

Set a monthly spending limit per expense category and see how much of it you have used this month.

![Presupuestos page with the monthly total and one card per budgeted category](img/presupuestos.png)

## What you see

The page follows the dashboard chosen in the top bar (**Hogar**, **Mío** or your partner's, see [Guide index](README.md)). The subtitle reminds you which one: *Límites mensuales por categoría · Hogar*.

- **Month selector** (top right): pick any month. Budgets are the same every month; only the spending changes.
- **Ajustar por inflación** (checkbox, top right): when ticked, peso budgets are shown adjusted by the inflation published since you set them. See [Adjust for inflation](#adjust-for-inflation).
- **Gastado del presupuesto (ARS)**: total spent against all budgets in pesos, "de" the sum of those budgets, with a percentage badge and a bar. Budgets in dollars are not part of this total.
- **Disponible (ARS)**: what is left of all peso budgets together, in large type. When you've spent more than the total it reads **Excedido (ARS)** in red. Below it, one row per budget with what is left in that category, or **Excedido $ X** in red.
- **One card per budget**, sorted from most used to least used:
  - category name, *spent de budget*, a percentage badge and a bar;
  - with inflation adjustment on, *· incluye +7,4% de inflación* after the amounts;
  - **Quedan $ X** or, in red, **Excedido por $ X**;
  - **vas más rápido que el mes** when you are more than 10 points ahead of the share of the month that has passed (and not yet at 100%).
- **Colors**: green below 80%, yellow from 80%, red above 95%. These color steps are fixed and do not follow the alert settings. The same colors are used in the **Presupuestos** panel on **Inicio**.
- **Gastos sin presupuesto este mes**: main categories with spending this month that no budget covers, with a **Presupuestar** button next to each.

When you look at your partner's dashboard, a grey note says *Estás viendo los presupuestos de tu pareja. Solo podés editar los del hogar y los tuyos.* and the buttons are hidden.

## What you can do

### Create a budget

1. Choose **Hogar** or **Mío** in the top bar. That decides whether the budget is for the household or only for you.
2. Click **Nuevo presupuesto**.
3. Pick the **Categoría** (only expense categories). A budget on a main category also covers its subcategories.
4. Enter the **Monto mensual** and the **Moneda** (ARS or USD).
5. Click **Guardar**.

Each category can have one budget per dashboard. Saving a new budget for a category that already has one replaces its amount.

### Start from what you actually spend

Click **Sugerir según últimos 3 meses**. The window lists each main category with the average monthly spending of the last three full months (the current month is not included), largest first.

- Categories without a budget come ticked; categories that already have one say *Ya tiene presupuesto (se reemplaza)* and come unticked.
- Adjust any amount, tick what you want and click **Guardar seleccionados**. Suggested budgets are always in pesos.

You can also click **Presupuestar** on a row of **Gastos sin presupuesto este mes**. The form opens with that category and this month's spending as the amount.

### Edit or delete

Use the pencil icon on a card to change the amount or currency (the category cannot be changed; delete and recreate instead). Use the trash icon to delete it. Deleting a budget does not touch any movement.

### Adjust for inflation

Tick **Ajustar por inflación**. Each peso budget is then shown raised by the inflation (CPI) published since you set it, and the cards say how much, for example *incluye +7,4% de inflación*. Untick it to see the amounts as you entered them. Dollar budgets never change.

It's a switch, not an action: nothing is overwritten, so ticking it again never adds inflation twice. It applies to every dashboard (household and personal), and it's the same setting as **Ajustes → Hogar → Ajustar presupuestos por inflación**.

Editing a budget's amount starts it again from that month: the amount you type is what it's worth now, and only later inflation is added.

More about CPI in [How the numbers are worked out](como-se-calcula.md).

### Alerts at 80% and 100%

When a movement makes a budget of the current month cross a threshold, you get a notice in the bell of the top bar and, if you linked Telegram, a Telegram message such as *Presupuesto al 80%: Supermercado* or *Presupuesto superado: Supermercado*.

- Household budget alerts go to both of you; personal budget alerts go only to that person.
- Each threshold is announced once per budget and month. If one movement jumps past both, you only get the higher one.
- Change the two thresholds in **Ajustes → Hogar** (**Primer aviso de presupuesto** and **Segundo aviso**).
- Turn Telegram delivery on or off in **Ajustes → Notificaciones** (**Presupuestos al 80% y superados**). The notice in the app is always kept.

## How the numbers are worked out

- **Spent** is the sum of confirmed expenses of that month in the chosen dashboard, in the budget's category or its subcategories. Pending recurring movements are not counted until you confirm them.
- What counts in each dashboard follows the usual rules: **Hogar** counts joint-account spending plus shared expenses at their full amount; **Mío** counts your own accounts plus only your share of shared expenses. See [Gastos compartidos](gastos-compartidos.md).
- Movements in the other currency are converted to the budget's currency at the BNA quote of each movement's own day.
- **Percentage** = spent ÷ budget × 100.
- **Per day** = what is left ÷ days left in the month, counting today.
- **Share of the month passed** = today's day number ÷ days in the month. "Vas más rápido que el mes" appears when the budget's percentage is more than 10 points above that.
- **Inflation adjustment**: new budget = budget × (1 + CPI of the latest month ÷ 100), rounded to whole pesos. With a CPI of 2,7%, a $ 100.000 budget becomes $ 102.700.
- **Suggestion**: for each main category, (spending in each of the last three months) added up and divided by 3, rounded to whole pesos.

## Tips

- There is nothing to copy from one month to the next: a budget keeps applying every month until you change or delete it.
- Alerts are checked when you add, edit or confirm a movement in the app. Rows brought in with **Importar** do not trigger alerts by themselves.
- If a subcategory has its own budget and so does its parent, the subcategory's spending counts in both.

See also: [Guide index](README.md) · [Inicio](inicio.md) · [Movimientos](movimientos.md) · [Gastos compartidos](gastos-compartidos.md) · [Objetivos](metas.md) · [Reportes](reportes.md) · [Cierre de mes](cierre-de-mes.md) · [Ajustes](ajustes.md) · [How the numbers are worked out](como-se-calcula.md)
