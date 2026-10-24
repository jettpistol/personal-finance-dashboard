# Cómo se calcula

The rules behind every figure in the app: currencies and exchange rates, inflation, what counts in each dashboard, how shared amounts are split and settled, and what stays private.

The examples use Iván and Milagros, a joint account, and made-up quotes and CPI values.

## Amounts and currencies

- Every amount is kept exactly, to the cent. There is no rounding when you save a movement.
- Each account is in **ARS** or **USD**, and every movement is in its account's currency. You can't record a dollar expense in a peso account: use a dollar account, or enter the pesos you actually paid.
- Amounts are shown in Argentine format: `$ 1.234,56` for pesos and `US$ 1.234,56` for dollars. Some compact figures (charts, budget cards) drop the cents or show millions as **M**.
- Percentage changes are (this period − previous period) ÷ previous period. When the previous period is zero there is no percentage and a dash is shown.

## Converting between ARS and USD

The **ARS / USD** switch in the top bar never changes what's stored. It converts each movement for display, one by one, at the **BNA official dollar quote of that movement's own date**, and then adds them up.

**Which quote.** Set in **Ajustes → Hogar → Cotización BNA para convertir**: **Vendedor** (default), **Comprador**, or **Promedio** (the two added and divided by 2). The same choice applies to every conversion in the app.

**Which day.**

- The quote of the movement's date, if there is one.
- Weekends and holidays have no quote: the closest **earlier** day is used.
- Dates before the first quote on file use the earliest quote; dates after the latest (today, future installments) use the latest.

**Example.** Friday 16/10 the BNA quote is buy 1.400 / sell 1.450, and there is no quote on the weekend.

- A US$ 20,00 expense on Saturday 17/10, viewed in ARS with **Vendedor**: 20,00 × 1.450 = **$ 29.000,00**. With **Promedio** (1.425): **$ 28.500,00**.
- A $ 10.000 expense on the same Saturday, viewed in USD: 10.000 ÷ 1.450 = 6,8966 → **US$ 6,90** (rounded to the cent).
- Two $ 29.000 expenses, one on 1/10 at 1.400 and one on 30/10 at 1.450, viewed in USD: US$ 20,71 + US$ 20,00 = **US$ 40,71**. The same pesos are worth fewer dollars later in the month.

Because each movement is rounded on its own, a converted total can differ by a cent or two from converting the total in one go.

**Balances and net worth** are converted differently, because a balance has no single date:

- **Cuentas** and savings goals linked to an account: the balance today, at today's quote (or the latest available).
- Net worth in **Reportes**: each month's closing balance, at the quote of that month's last day (today for the current month).

**No quotes at all.** If the data profile has no quotes yet, conversions can't be made: those amounts count as zero and a warning asks you to load quotes in **Ajustes**. As soon as there is at least one quote, every date has a rate (see the rules above).

## Inflation (CPI)

The app uses INDEC's monthly CPI (IPC): the percentage prices rose each month.

### The price index

The monthly percentages are chained into an index, starting at 100 at the first month on file. Example with July 3,0%, August 2,5% and September 2,0% (September being the latest published):

| Month | CPI | Index at month end |
| --- | --- | --- |
| July | 3,0% | 103,00 |
| August | 2,5% | 105,58 |
| September | 2,0% | 107,69 |

### Constant pesos (**Real (IPC)**, *en pesos de hoy*)

Past peso amounts are restated in pesos of the **latest published CPI month**:

amount × (index of the latest published month ÷ index of the movement's month)

- $ 100.000 spent in July: × (107,69 ÷ 103,00) = × 1,0455 → **$ 104.550**.
- $ 100.000 spent in August: × 1,02 → **$ 102.000**.
- $ 100.000 spent in September, or in October while October's CPI isn't out: **$ 100.000** (no adjustment).

Only pesos are adjusted. In USD, the **Real (IPC)** option is disabled (*El ajuste por inflación (IPC) aplica a montos en pesos*).

### Real change (**Var. real**, **Real:**)

Real change compares how much spending moved with how much prices moved:

real change = (1 + nominal change) ÷ (1 + inflation over the same period) − 1

- **Vs. last month**: inflation is the month's own CPI. Spending went from $ 500.000 in August to $ 550.000 in September (+10%), September CPI 2,0%: 1,10 ÷ 1,02 − 1 = **+7,8%**. You spent more than prices alone explain.
- **Vs. a year ago**: inflation is the CPI accumulated over the 12 months. Spending went from $ 400.000 to $ 550.000 (+37,5%) with 30% inflation: 1,375 ÷ 1,30 − 1 = **+5,8%**.
- A negative real change means spending grew less than prices.

On **Inicio**, the **Var. real** of **Ahorro del mes** is in money, not a percentage: this month's savings minus last month's savings raised by the month's CPI. Savings of $ 200.000 against $ 190.000 last month, CPI 2,0%: 200.000 − 190.000 × 1,02 = **+$ 6.200**.

### Months not yet published, and **(e)**

INDEC publishes each month's CPI some weeks after it ends, so the current month (and sometimes last month) has no CPI yet.

- For real changes, unpublished months are **projected** by repeating the latest monthly rate. With September at 2,0% as the latest, October is assumed to be 2,0%, November another 2,0% on top, and so on.
- On **Inicio**, a small **(e)** next to **Var. real** marks a figure that uses such an estimate, and the note under the figures explains it. **Reportes → Inflación** shows a yellow note instead: *El INDEC todavía no publicó el IPC de …*
- Constant pesos are not projected: unpublished months are taken at the latest published level, as in the October example above.

## Budget indexing

**Ajustar por inflación** (on **Presupuestos**) and the automatic option (**Ajustes → Hogar**) raise budgets in pesos by the **latest published monthly CPI**, rounded to whole pesos:

- A $ 200.000 budget with a 2,7% CPI becomes $ 205.400.
- A $ 150.333 budget becomes 150.333 × 1,027 = 154.391,99 → **$ 154.392**.

Rules:

- Dollar budgets never change.
- The button applies to the budgets of the dashboard you're viewing (**Hogar** or **Mío**), and it applies again every time you click it, compounding. Click it once per new CPI.
- The automatic option applies to every peso budget of every dashboard, once for each newly published CPI month, starting with the first one published after you turn it on. A notification says what was applied.

**How much of a budget is used**: the confirmed expenses of that month that count in the budget's dashboard, in the budget's category or its subcategories, converted to the budget's currency at each expense's own day quote. Example: a $ 300.000 **Supermercado** budget with $ 250.000 in peso expenses plus a US$ 20 expense on a day quoted 1.450 ($ 29.000) is at $ 279.000, **93%**. Percentages are shown with one decimal.

## What counts in each dashboard

Only **confirmed** expenses and incomes count as spending or income. Pending movements, transfers and adjustments never do.

| Movement | **Hogar** | Iván's **Mío** | Milagros's **Mío** |
| --- | --- | --- | --- |
| Joint account, not shared | Full amount | No | No |
| Joint account, shared | Full amount | His share | Her share |
| Iván's account, not shared | No | Full amount | No |
| Iván's account, shared | Full amount | His share | Her share |

Incomes follow the same rules (a shared income is split like a shared expense).

**Example.** Iván pays a $ 60.000 supermarket bill from his own account, marked shared 50/50: **Hogar** shows $ 60.000 of spending, each **Mío** shows $ 30.000, and Milagros owes Iván $ 30.000.

Your partner's dashboard follows the **Mío** rules for them, minus anything you can't see (see [Privacy](#privacy)).

### Contributions and savings

Money moved between a personal account and a joint account is a **contribution**, not income or spending:

- In **Hogar**, money put into a joint account adds to **Ingresos y aportes**; money taken back out to a personal account subtracts.
- In **Mío**, it's the other way round for your own accounts: what you put into the joint pot appears as **Aportaste al hogar** and lowers your savings for the month.
- Transfers between two joint accounts, or between two of your own accounts, count for nothing.

**Savings** (**Ahorro del mes**) = income + contributions − spending. **Tasa de ahorro** = savings ÷ (income + contributions, if positive), with one decimal.

Example for **Hogar** in a month: no income of its own, Iván contributes $ 350.000 and Milagros $ 250.000, spending is $ 450.000. Savings: 600.000 − 450.000 = **$ 150.000**; rate: 150.000 ÷ 600.000 = **25,0%**.

### Net worth

- **Hogar**: every account you can see (joint, yours, and your partner's non-private ones).
- **Mío**: your own accounts.
- Your partner's dashboard: their accounts that aren't private.

## Shared expenses and income

### Split methods

- **Default**: the percentages in **Ajustes → Hogar → División por defecto de gastos compartidos**; equal parts if none are set.
- **Equal**: the same for everyone.
- **Percent**: must add up to 100 (*Los porcentajes deben sumar 100.*).
- **Exact amounts**: must add up to the total exactly (*Los montos de la división deben sumar el total.*).

A person whose share comes out as zero is left out of that movement completely: it doesn't count in their **Mío** and creates no debt for them.

### Rounding

Shares are whole cents and always add up exactly to the total. Each person first gets their share rounded down; leftover cents go one by one to whoever lost the largest fraction. On a tie, the person created first (usually whoever set up the app) gets it.

- $ 1.000,01 split equally: **$ 500,01** for the first person, **$ 500,00** for the other.
- $ 100,01 split 60/40: 60,006 and 40,004 → **$ 60,01** and **$ 40,00**.

### Installments

A purchase in **N** installments becomes N monthly expenses with equal amounts; leftover cents go to the first installments. $ 100.000 in 3: **$ 33.333,34**, $ 33.333,33, $ 33.333,33.

If you split the purchase with exact amounts, they're turned into percentages and applied to each installment. $ 90.000 in 3 with Iván $ 60.000 and Milagros $ 30.000: each $ 30.000 installment is split $ 20.000 / $ 10.000.

### Who owes whom

**Gastos compartidos** keeps one balance per currency (pesos and dollars are never mixed or converted), using confirmed movements dated up to today:

- Shared expense paid from a personal account: the payer is owed everyone else's shares.
- Shared income received in a personal account: the receiver owes everyone else's shares.
- Anything paid or received in a joint account: no debt, the joint pot is already shared.
- A settlement: reduces the debt by its amount.

**Example.** Iván pays $ 60.000 (50/50): Milagros owes $ 30.000. Milagros pays a $ 20.000 dinner (50/50): Iván owes her $ 10.000. Net: **Milagros owes Iván $ 20.000**. She transfers $ 20.000 from her account to his as a settlement, and both are at zero. A room rented out for $ 100.000, paid into Milagros's account and shared 50/50, would instead make her owe Iván $ 50.000.

## Transfers, settlements and adjustments

- A **transfer** moves money between two accounts and is never income or spending. Between currencies it stores both amounts: buying US$ 100 for $ 145.000 takes $ 145.000 out of the peso account and puts US$ 100 into the dollar one.
- A transfer from one person's account to the other person's account is a **settlement** by default (you can untick it). Settlements need both accounts in the same currency and can't be private. Unticked, it's a plain transfer that doesn't change who owes whom.
- Transfers into a joint account are contributions (see above), not settlements, and create no debt.
- An **adjustment** corrects an account's balance up or down. It never counts as income or spending.

**Account balance** = opening balance + every confirmed movement dated up to today (expenses subtract, incomes add, adjustments add or subtract, transfers subtract from the source and add the received amount to the destination). Future installments and pending items don't touch balances until their date or confirmation, although future installments do show in their own month's spending.

## Privacy

Each movement is in one of three states for the person looking at it:

| State | When | What you see |
| --- | --- | --- |
| Full | On a joint account, on your own account, or on your partner's account when neither the account nor the movement is private | Everything; you can edit it |
| Masked | A shared expense or income you have a share in, paid from (or into) an account of your partner's that you can't see | Date, amount, description, category and the split; no account, notes or receipt; you can't edit it |
| Hidden | Anything else on your partner's private accounts, and their private movements | Nothing: it's left out of lists, totals, budgets, reports and exports |

- Only movements on personal accounts can be private, and shared movements and settlements never are.
- A settlement your partner sends you from a private account is shown in full, except that their account is hidden.
- Masked movements count in your figures like any other (full amount in **Hogar**, your share in **Mío**). In exports their account reads *(privada)*.
- If your partner hides their personal dashboard, their tab disappears for you, and **Reportes → Por persona** shows only their shared figures.
- Server backups contain everything; privacy applies inside the app.

See also: [Guide index](README.md) · [Inicio](inicio.md) · [Movimientos](movimientos.md) · [Cuentas](cuentas.md) · [Gastos compartidos](gastos-compartidos.md) · [Presupuestos](presupuestos.md) · [Reportes](reportes.md) · [Ajustes](ajustes.md)
