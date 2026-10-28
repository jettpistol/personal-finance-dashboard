# Known issues

Found while writing the [user guide](guide/README.md) (v0.3.3), by reading the code against what each screen claims. Not fixed yet. Grouped by how much they matter.

## Privacy and permissions

1. **Recurrentes:** deleting a template has no permission check, so either partner can delete any template, including the other's private one, along with its pending movements. Editing only checks the account the template is being moved to, not who owns it now.
2. **Importar:** undoing an import has no permission check. **Historial** lists every import (file name, account) with no privacy filter, which exposes imports into a partner's private account.
3. **Metas:** a goal linked to an account shows that account's name and balance to anyone who can see the goal. A household goal linked to a private account leaks its balance.
4. **Movimientos:** the "same description last time" category suggestion reads all movements, including the partner's private ones, so it can reveal their category or merchant.
5. **Movimientos:** search matches notes on masked movements whose notes the viewer can't see.
6. **Nuevo movimiento:** marking **Privado** on a movement in your partner's non-private account hides it from you, not from them. The hint text says the opposite.
7. **Nuevo movimiento:** the **Privado** flag stays set when you switch the type to **Transferencia**, even though the switch disappears, so a plain transfer from a personal account can end up private.
8. **Perfil de datos:** the scheduler runs in every profile, so **Prueba (demo)** or a test profile can send real Telegram alerts and monthly .docx reviews.

## Wrong numbers

9. ~~**Presupuestos:** **Ajustar por inflación** applies the latest CPI again on every click, and again after the automatic adjustment. Budgets compound.~~ **Fixed in 0.5.0.**
10. **Presupuestos:** if a parent category and one of its subcategories both have budgets, that subcategory's spending is counted in both, and twice in the page total. A budget on a subcategory also hides the parent's other spending from "Gastos sin presupuesto este mes".
11. **Importar:** imports never trigger budget alerts. Only movements entered in the app do.
12. **Importar:** "Seleccionar todos (sin duplicados)" also re-ticks rows flagged **Otra moneda**, which are then imported as if in the account's currency.
13. **Movimientos:** the summary line "Ingresos / Gastos (en ARS)" leaves USD movements out instead of converting them. On **Mío**, with **Solo del tablero seleccionado** on, shared movements are added at the full amount rather than your share.
14. **Reportes → Ahorro:** **Tasa de ahorro promedio** and **Ahorro acumulado** skip months with spending but no income, which overstates savings.
15. **Reportes → Anual:** the income row's monthly cells and the yearly total treat money taken out of the joint account differently, so the cells may not add up to the total.
16. **Real (IPC):** Reportes uses only published CPI, so months after the last publication aren't adjusted. Inicio projects them from the latest rate. The two can disagree for the current month.
17. **Cierre de mes .docx:** "Saldo compartido" is the balance on the day it's generated, not at the end of that month.
18. **Cuentas:** accounts with no exchange rate to convert count as 0 in **Patrimonio visible** and the group subtotals, with no warning.
19. **Ajustes → Hogar:** with a custom default split, a person added later gets 0% and is silently left out of default-split shared expenses.
20. **Metas:** changing a manual goal's currency keeps the contributed numbers and reads them in the new currency.

## Data loss or silent failures

21. **Confirming a pending movement** sends only the amount and date: other edits in the form (category, description, tags) and a chosen receipt are dropped.
22. **Compra en cuotas:** a receipt chosen while creating the purchase is ignored.
23. **Bulk "Asignar categoría"** with no category chosen removes the category from every selected movement.
24. **Enviar por Telegram** (and the automatic monthly send) reports success and marks the month as sent even when no one has Telegram linked, or no bot is configured. Delivery errors are dropped.
25. **Receipt files** aren't removed on bulk delete or when a profile is deleted, and backups don't include them.
26. **Telegram link codes** live only in memory, so a restart invalidates a pending code.

## Wrong or misleading labels

27. **Inicio:** the source line always says "dólar BNA vendedor" with the sell quote, even when **Ajustes → Hogar** uses buy or average.
28. **Reportes → Inflación:** the empty state points to "Ajustes → Inflación", but the tab is **Cotizaciones e inflación**.
29. **Ajustes → Notificaciones:** the label says "Presupuestos al 80% y superados", and the bar colors are fixed at 80/100, even when the thresholds are changed.
30. ~~**Movimientos and Gastos compartidos:** for shared income, the tooltip and the **Pagó** column say "Pagó X" when X received the money.~~ **Fixed in 0.5.0.**
31. **Inicio, Mío:** a person who took more out of the joint account than they put in sees the household labels **Ingresos y aportes** and **De aportes al pozo**.
32. **Saldar:** the notice asks for a "(no privada)" account, but the payer's own private accounts are offered.
33. **After Compra en cuotas then Ingreso,** the labels still say **Monto total de la compra** and **Fecha de compra**.
34. **Cierre de mes .docx** contains an emoji ("Están a mano. 🎉"), against PRODUCT.md.
35. **Zero change** (0,0%) shows a grey down arrow.
36. **Ajustes → Datos:** the backup list text hard-codes "14 days / one per month for a year", and it mixes every profile's files with the logins file.

## Behaviour that surprises

37. **Inicio:** the pending-recurring alert counts from two months before the selected month, so it changes with the month picked. **Últimos movimientos** ignores the selected month.
38. **Metas** shows the dashboard selector but always lists every goal you can see.
39. **Recurrentes:** turning **Activo** back on creates a pending movement for every date missed while paused (the guide explains how to skip them).
40. **Older installs** move their data to **Principal**, but open on the new empty **Vacío** until someone switches.
41. **Category filter in Movimientos:** an expense category stays active (hidden) after switching the type to **Ingresos**, so the list comes up empty. With **Transferencias** selected, expense categories are still offered.
42. **Category suggestions:** the history fallback and rules with no type can suggest an income category for an expense. Saving then fails. A rule's shared flag overrides the switch the user already set.
43. **Transfers between partners in two currencies:** the settlement box starts ticked, so saving fails until it's unticked.
44. **Agregar gasto compartido** opens a plain Gasto with the shared switch off.
45. **Exportar CSV** in Movimientos applies the dates but ignores the other filters.
46. **Rules:** the amount range ignores currency (and the list shows it in pesos). "Aplicar reglas" stops at the first matching rule even when it sets no category.
47. **Importar:** a rule can mark an income row as shared, but the review table has no switch to see or undo it.
48. **Cierre de mes:** merchants are grouped case-sensitively, unlike **Reportes → Comercios**. A closed month can't be reopened.
49. **Patrimonio** counts archived accounts; the Inicio **Cuentas** card hides them. **Patrimonio** and **Comercios** never show the missing-quote alert.
50. **Categorías:** an archived parent hides its active subcategories while **Mostrar archivadas** is off.
51. **Exchange rates:** dates before the first stored quote use the earliest quote, so the missing-quote warning only appears when there are no quotes at all.

## Resúmenes (v0.12.0)

52. **Resúmenes:** only tested with statements that have one physical card. A statement with an additional card (the partner's) is read assuming each card's purchases are followed by its **Total Consumos** line, which has not been checked against a real one.
53. **Resúmenes:** the marks `*`, `K` and `F` that Galicia prints next to card purchases are kept but not interpreted; nobody has confirmed what they mean.
54. **Resúmenes:** a card payment seen from the account (**PAGO TARJETA VISA**) is proposed as a transfer, but the card's account is not chosen for you, and the payment is not matched with the payment line of the card statement.
55. **Resúmenes:** transfers to the partner are read as ordinary expenses or income. The partner is not recognised by tax id yet.
