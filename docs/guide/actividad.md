# Actividad

A log of who did what, and when: every change that moves the numbers (movements, payments, loans, budgets, settings…) is recorded with the person who made it. Open it from **Actividad** in the sidebar, between **Perfil de datos** and **Ajustes**.

![Actividad page: the filter box with Todas las secciones · 31, Todas las personas, Fechas and Buscar, the Todos los perfiles button and Hora de Argentina (GMT-3) with a pencil; below, entries of Martes 27 de octubre de 2026, one opened to show IPC mensual 2,1% → 2,3%, its profile, its time in Argentina and in UTC](img/actividad.png)

## What gets recorded

Every action that changes data, as soon as it is saved:

- **Movimientos**: new, edited and deleted movements (with what changed), installment purchases, bulk changes, CSV uploads, receipts attached or removed, confirmed pending movements.
- **Cuentas**, **Presupuestos**, **Objetivos** (including contributions), **Reglas**, **Recurrentes**, **Importar** (presets, imports and undone imports), **Cierre de mes**.
- **Gastos compartidos**: settle-up payments.
- **Deudores** and **Pendientes**: loans, returns (a partial one with its reason), forgiven amounts, commitments and their payments.
- **Ajustes**: household settings, categories, exchange rates and CPI loaded by hand or refreshed, backups, the sending email account, your own profile.
- **Perfil de datos**: profiles created, renamed, deleted or switched to.
- **Mercado Pago**: connecting, disconnecting, checks and report settings.
- **Accesos**: logins, logouts, switching account, wrong passwords for an existing user, password changes, new users.
- **Actividad**: clearing entries is itself recorded, with how many were deleted.
- **Deshacer**: an undone action gets its own line, "Deshizo: …" followed by the original one, in the same section and visible to the same people (see [Undo an action](barra-superior.md#undo-an-action)).

Looking at reports, inflation or the list of movements is not recorded. Neither is anything that fails: an entry means the change was saved.

Things the app does by itself, such as creating the pending movement of a recurring bill on its date, appear as **Automático**.

Entries are never part of a data profile's data: they stay when the app is updated, when a profile is reset (including `npm run demo:reset`) and when you switch profile.

## What you see

**Filters** (top box):

- **Sección**: *Todas las secciones* or one section. Each option shows how many entries it has with the other filters applied, so the list doubles as a count per section.
- **Persona**: everyone, one person, or **Automático**.
- **Fechas**: one day or a range. Days are whole days in the time zone shown on the right (see below).
- **Buscar**: words in the entry's text.
- **Todos los perfiles**: off, the list shows the profile in use plus entries that aren't tied to any profile (logins, profiles, email setup, your personal settings). On, every profile.

**The list**: entries grouped by day, newest first. Each row has the time, the person, one line saying what happened and, when all sections are shown, the section. A lock means only you can see that entry.

Click a row to see its details:

- for an edit, a table with **Campo**, **Antes** and **Después**;
- for bulk actions, one line per movement;
- **Sección**, **Perfil**, **Hora** (in the chosen time zone, with its offset) and **UTC** (the exact instant, with milliseconds).

The buttons at the top right refresh the list, download it as CSV, and open the **⋯** menu.

## Time zones

The server stores each entry as an exact instant in UTC, so nothing depends on where the server or your device is. The page shows times in the zone written above the list, **Hora de Argentina (GMT-3)** by default, whatever the device's own zone.

To see them in another zone, click the pencil next to it and pick one from **Zona horaria** (you can type to search, e.g. *Madrid* or *Tokyo*). **Usar la de este dispositivo** and **Volver a la hora de Argentina** are shortcuts. The choice is remembered in this browser. Times, day headers and the **Fechas** filter all follow the zone you picked: in *Hora de Japón (GMT+9)* an entry from 22:54 on 27 October in Argentina shows at 10:54 on 28 October.

## Download

The download button saves a CSV (Excel-friendly) with what the filters show. Its columns are **Fecha y hora (UTC)**, **Fecha y hora** in the zone you picked (the column name says which, and each value carries its offset), **Usuario**, **Perfil**, **Sección**, **Acción**, **Resumen** and **Detalle**.

## Clearing entries

Either of you can clear entries from the **⋯** menu. Each option asks for confirmation first:

- **Borrar esta sección**: every entry of the section chosen in **Sección** (available when one is chosen).
- **Borrar anteriores a…**: everything before the start of the day you pick, in the chosen time zone. The window shows the exact cut-off before you confirm.
- **Borrar todo**: everything.

Clearing follows **Todos los perfiles**: off, it clears the profile in use (plus entries not tied to a profile); on, every profile. It only deletes entries you can see: your partner's private entries stay. The clearing itself leaves a new entry in **Actividad** saying how many were deleted.

## Privacy

The log follows the same rules as the rest of the app:

- Entries about a private account, a private movement, your **Deudores** and **Pendientes**, your personal settings and your Mercado Pago connection are visible only to you.
- A shared expense paid from a private account is shown to your partner with the account replaced by *cuenta privada*, as in **Movimientos**.
- A movement registered for a **Pendientes** item shows that item's name only to you.
- Passwords, the Gmail app password, Mercado Pago tokens, Telegram chats and receipts are never written to the log. A changed email password appears only as *nueva*.

See also: [Guide index](README.md) · [Perfil de datos](perfil-de-datos.md) · [Ajustes](ajustes.md) · [Movimientos](movimientos.md)
