---
version: 1
slug: "web-src"
primary_target: "web/src"
related_targets: []
---

# Surface brief: Finanzas app (all authenticated screens)

Scope: the whole web app under web/src (shell, navigation and every page). Visitor mode: Operate.
Audience and job: the couple, mostly on PC: quick entries a few times a week, batch imports of bank statements, and a monthly sit-down together. Avoid: playful tone, spreadsheet density.
User-pinned: a mostly boxed look with straight corners, early-2010s style; rounded corners may exist but never prominent.
User-pinned (references: 2012 Apple Store, 2010 Fandom): dark top bar with divided pressed-in tabs; breadcrumb strip carrying page title and actions; blue gradient title bars on side panels with small 'ver/más' buttons in the bar; small square NEW-style state tags; buttons and inputs with slight depth (soft vertical gradient, 1px border, top highlight, pressed state, inset inputs); Source Sans 3 as the Myriad-era face; thin dividers between figures; tabs attached to their panel; square pagination; slim footer strip. Left out on purpose: heavy gloss and bevels, embossed text, textures, drop shadows on every box, tiny low-contrast text, fixed widths, carousels, pill fields.
Constraints: every existing feature, route and data field keeps working; Spanish (es-AR, voseo); light and dark.
Build path: code-led (Operate surface). Roll ran degraded: no challengers, no quality-bar boards.

## Direction contract

THESIS: Finanzas reads the household like a statistical release: every headline figure arrives with its monthly change and its inflation-adjusted change, and the source is always named. It refuses the category default of white floating cards, a donut and a grey sidebar.

OWN-WORLD: Deep navy institutional rail and header band; cool blue-grey ground; boxed white work panels with visible 1px borders and a titled header strip, square corners (0-2px radius; rounding only on avatars and switch knobs), no drop shadows. One humanist sans (Source Sans 3, the open cousin of Myriad) with tabular figures for everything. Series in a statistical blue-to-teal family; one warm orange reserved for "real" (CPI-adjusted) series; green/red only for signed variations. Small "Fuente:" caption lines under figures and charts.

STORY: Open the app and read the month's informe for the chosen scope: what came in, what went out, what was saved, nominal and real change; then where it went by rubro; then act (add, confirm, settle, import).

FIRST VIEWPORT: Navy rail (nav groups, primary "Nuevo movimiento" at its top). Dark top bar: scope as divided tabs, ARS/USD, alerts, user. Breadcrumb strip: home › page title, month and actions on the right. Lead band "Informe de <mes>": three headline figures (Gastos, Ingresos y aportes, Ahorro) each with var. mensual, var. real and a six-month sparkline. Below: "Gasto por rubro" ranked bars with a nominal|real switch, beside "Presupuestos" and "Saldos entre ustedes".

FORM: grounded candidate 4 of 7 (INDEC informe técnico publication). seed:a530ccc246b668e8. Signature interaction: the nominal|real switch on charts, mirrored by the headline triple. Motion: 150-200 ms state changes only.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
