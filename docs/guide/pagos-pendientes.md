# Pendientes

What you have to pay yourself every month (**Pagos**) and the money people owe you on a schedule (**Cobros**), with the app chasing you until each one is done. This section used to be called *Pagos pendientes*.

![Pendientes, Pagos list: an overdue savings plan and a debt, with the Pagos / Cobros toggle](img/pagos-pendientes.png)

Pendientes sits next to [Recurrentes](recurrentes.md) and doesn't replace it:

- **Recurrentes**: things that arrive by themselves, where you only confirm the real amount. Bills, subscriptions, salary, card installments, purchases.
- **Pendientes**: commitments you carry out yourself, with people or with yourself. A monthly savings transfer, a debt you're paying back, money someone owes you.

Each person only sees, and is only chased for, what they are responsible for.

## What you see

- **Pendientes** in the sidebar, with a red counter of what's due today or late, Pagos and Cobros together.
- **Pagos / Cobros** at the top right, each with its own counter. They are always separate lists; the toggle switches between them (the address remembers which: `/pendientes?ver=cobros`).
  - **Pagos**: **AHORRO** (move money to your savings) and **DEUDA** (pay someone back). **Nuevo compromiso** creates one.
  - **Cobros**: loans from [Deudores](deudores.md) with a return date or installments. **Ir a Deudores** to add one.
- One card per item, the late ones first, with a red rule on the left:
  - the **name**, large;
  - below it, small: the tags (**AHORRO** or **DEUDA**, and **VENCIDO**, **PARCIAL** or **PENDIENTE**), where it goes or who it's with, and when it was due (*Venció el 6 oct · hace 21 días*);
  - the amount still missing; below it what was already paid and *+ $ X del mes anterior* when something rolled over (or *− $ X pagado de más*);
  - **Registrar** and the **⋯** menu;
  - **Historial**: every month with what was expected and paid, the payments, and the reason for any partial one.
- **Completados** (green, under the list): what's paid for this month (*Al día este mes*), finished commitments, and loans that came back (*Cobrado el 28 oct 2026*) or were forgiven. Click its title to fold it.

## What you can do

### Create a commitment

1. In **Pagos**, click **Nuevo compromiso**.
2. **Ahorro mensual** or **Deuda que pago**.
3. **Nombre** (e.g. *Ahorro en dólares*) and, for a debt, **¿A quién?**
4. **Cada mes**: the amount, and its currency in the box next to it.
5. **Cuenta de ahorro (destino)** for savings; for a debt, optionally **Pagás desde**.
6. **Día** of the month it's due (29, 30 or 31 fall on the last day of shorter months), **Desde** (first month) and **Meses** (empty for no end; e.g. 6 for a debt in 6 payments).

### Registrar: mark it as done

Click **Registrar** on the card. It asks whether the movement is already loaded:

- **Elegir un movimiento cargado**: a list of movements of the last 90 days that can count (same currency, not used for something else), exact amounts first and tagged **EXACTO**. Search by text, pick one and click **Registrar**.
- **Cargar un movimiento nuevo**: **Nuevo movimiento** opens filled in, with *Para «Ahorro en dólares» · faltan USD 200* at the top: a **Transf. propia** to the savings account, a payment to that person, or the money that came back. When you save it, it counts for that item right away, whatever the amount.
  - For a dollar target with pesos: pick a peso account in **Desde**. It becomes a conversion: the rate starts at today's BNA quote and the pesos are set so exactly the target arrives (USD 200 at 1.450 = $ 290.000). Change the rate or the pesos and **Monto recibido en USD** follows; that's what counts.

Something that can't count (pesos for a dollar target, an expense for a savings plan) isn't saved: a message says why.

A movement with **exactly** the amount links on its own too, when you save it anywhere, import it or load it from a CSV.

### Partial payments and collections

If the amount is less than what's missing, the app asks **¿Por qué es un pago parcial?** (or **cobro parcial**) and says how much would still be missing; nothing is saved without an answer. For a monthly commitment, the rest **rolls over** to the next month: with a monthly $ 50.000 and $ 30.000 paid in September, October expects $ 70.000. Paying more works the other way: the extra lowers the next month. For a loan, the rest stays pending until it comes back.

To undo a link, open **Historial**, use the **⋯** of that month and **Desvincular**.

### Edit or delete

**⋯ → Editar** or **Eliminar** (deleting keeps the movements). For loans, **⋯ → Ver en Deudores**.

## How the reminders work

From the due day until it's done, the person responsible gets a reminder **every day, including weekends, between 8 and 18**, three times a day (around 8, 12 and 16): in the bell and by email (see [Set up email notifications](configurar-correo.md)). These reminders can't be turned off: they stop when the item is done.

## Tips

- For savings, create a separate account for it in [Cuentas](cuentas.md) and point the commitment there.
- **Registrar** from the card is the surest way: the movement is tied to the item even when the amount isn't round.

See also: [Guide index](README.md) · [Deudores](deudores.md) · [Recurrentes](recurrentes.md) · [Movimientos](movimientos.md) · [Ajustes](ajustes.md)
