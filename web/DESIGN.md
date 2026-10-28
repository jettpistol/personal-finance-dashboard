---
name: Finanzas
description: The household read like a monthly statistical release, dressed in the boxed, early-2010s web.
colors:
  rail-navy: "#0f2a4a"
  rail-navy-hover: "#17375e"
  rail-ink: "#dbe5f2"
  rail-ink-muted: "#93a8c4"
  navy-primary: "#244e80"
  navy-bar: "#2e5a91"
  navy-focus: "#3d6ba6"
  title-blue-top: "#3f73b3"
  title-blue-bottom: "#20508b"
  title-blue-edge: "#173f70"
  topbar-top: "#4b586b"
  topbar-bottom: "#2a3343"
  topbar-edge: "#1b2230"
  real-ocre: "#c96f08"
  signed-up: "#2b7a4b"
  signed-down: "#b4362f"
  ground: "#eceff4"
  panel: "#ffffff"
  strip: "#f3f5f9"
  strip-top: "#fbfcfd"
  strip-bottom: "#e8ecf2"
  rule: "#cdd5e1"
  rule-strong: "#aab5c6"
  ink: "#1b2434"
  ink-muted: "#4f5b70"
  button-face-bottom: "#eaeef3"
  button-edge: "#aeb9c8"
  tag-blue-top: "#3a6aa6"
  tag-blue-bottom: "#1f4a82"
  tag-ocre-top: "#e49536"
  tag-ocre-bottom: "#b9640a"
typography:
  display:
    fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-0.015em"
    fontFeature: "'tnum' 1"
  headline:
    fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: "24px"
  body:
    fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "'tnum' 1"
  label:
    fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "'tnum' 1"
  nav-group:
    fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.02em"
  tag:
    fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  hero-amount:
    fontFamily: "'Cascadia Code', ui-monospace, Menlo, Consolas, monospace"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "'tnum' 1"
rounded:
  square: "0px"
  hairline: "1px"
  soft: "2px"
  full: "1000px"
spacing:
  xs: "10px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "32px"
components:
  shell-rail:
    backgroundColor: "{colors.rail-navy}"
    textColor: "{colors.rail-ink}"
    width: "224px"
  shell-rail-link-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.navy-primary}"
    rounded: "{rounded.square}"
  shell-topbar:
    backgroundColor: "{colors.topbar-bottom}"
    textColor: "{colors.rail-ink}"
    height: "52px"
  bar-tab:
    textColor: "{colors.rail-ink}"
    typography: "{typography.title}"
    padding: "0 18px"
  crumbs-strip:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    padding: "8px 14px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "{spacing.md}"
  panel-title-bar:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "8px 16px"
    height: "40px"
  panel-title-bar-blue:
    backgroundColor: "{colors.title-blue-bottom}"
    textColor: "{colors.panel}"
    typography: "{typography.title}"
    padding: "8px 16px"
    height: "40px"
  bar-button:
    backgroundColor: "{colors.button-face-bottom}"
    textColor: "{colors.navy-primary}"
    rounded: "{rounded.square}"
    padding: "0 9px"
    height: "22px"
  button-primary:
    backgroundColor: "{colors.navy-primary}"
    textColor: "{colors.panel}"
    rounded: "{rounded.hairline}"
    height: "36px"
    padding: "0 18px"
  button-default:
    backgroundColor: "{colors.button-face-bottom}"
    textColor: "{colors.ink}"
    rounded: "{rounded.hairline}"
    height: "36px"
    padding: "0 18px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.hairline}"
    height: "36px"
  tag:
    backgroundColor: "{colors.tag-blue-bottom}"
    textColor: "{colors.panel}"
    typography: "{typography.tag}"
    rounded: "{rounded.square}"
    padding: "0 5px"
    height: "16px"
  tag-pending:
    backgroundColor: "{colors.tag-ocre-bottom}"
    textColor: "{colors.panel}"
    typography: "{typography.tag}"
    height: "16px"
  release-figure:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    padding: "14px 16px 12px"
  rank-bar:
    backgroundColor: "{colors.navy-bar}"
    height: "14px"
  source-line:
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
---

# Design System: Finanzas

## Overview

**Creative North Star: "The Household Release"**

Finanzas reads a couple's month the way a national statistics office publishes a technical release: every headline figure arrives with its monthly change and its inflation-adjusted change, figures sit in ruled boxes divided by thin lines, and a small "Fuente:" line names where the numbers came from. The dress is the boxed web of the early 2010s, pinned by the users (2012 Apple Store, 2010 Fandom): a deep navy rail, a dark graphite top bar with divided pressed-in tabs, a breadcrumb strip carrying the page title and its actions, gradient title bars on boxed panels, small square NEW-style tags, and buttons and inputs with a little physical depth.

Density is moderate and calm: one humanist sans (Source Sans 3, the open cousin of Myriad) at working sizes, tabular figures everywhere, generous row heights in tables and ranked bars. Color is spent on meaning, not identity: navy carries structure and action, one warm ocre is reserved for CPI-adjusted ("real") readings and pending states, and green/red appear only on signed changes and budget status. The system rejects the category default of white floating cards with soft shadows, donut charts and a grey sidebar, and it rejects the excesses of its own era: heavy gloss and bevels, embossed text, textures, shadows on every box, tiny low-contrast text, fixed widths, carousels and pill fields.

Light and dark schemes share one structure; dark swaps the ground to near-black blue (#0f141c), panels to #161d28 and lifts ocre, up and down to lighter steps so they hold contrast.

**Key Characteristics:**
- Navy rail plus graphite top bar frame every authenticated screen.
- Square, ruled, shadowless panels with a titled header strip.
- Grey gradient title bars on main panels, blue gradient title bars on side panels.
- Tabular Source Sans 3 for every figure; changes always signed and colored by good/bad, never by sign alone.
- Ocre means "real (IPC)"; nothing decorative may use it.
- A "Fuente:" caption under every figure group and chart.
- State changes only, 120-200ms; nothing animates on its own.

## Colors

A cool institutional palette: navy and graphite structure on a blue-grey ground, with one warm accent reserved for inflation-adjusted data.

### Primary
- **Institutional Navy** (rail-navy): the left rail background; its hover step (rail-navy-hover) lights rows under the pointer. Rail text is pale steel (rail-ink), group labels a dimmer steel (rail-ink-muted).
- **Action Navy** (navy-primary, Mantine `navy.8`, the light-scheme primary shade): filled buttons, active rail link text, links, the active pagination control. In dark scheme the primary shade moves to `navy.4`.
- **Bar Navy** (navy-bar, `navy.7`): ranked category bars, goal progress, the neutral sparkline.
- **Focus Navy** (navy-focus, `navy.6`): focus outlines, focused input borders, text caret.
- **Title-Bar Blue** (title-blue-top to title-blue-bottom, edged by title-blue-edge): the vertical gradient on side-panel title bars and the active pagination and toggle-filter face.

### Secondary
- **Real Ocre** (real-ocre, `ocre.6`; `ocre.4` in dark): the CPI-adjusted reading. The "(e)" estimate mark, the dashed ghost outline of the comparison month in real mode, near-limit budget state (`ocre.5`/`ocre.8`), warning alerts, and the "Pendiente" tag (tag-ocre-top to tag-ocre-bottom).

### Tertiary
- **Signed Green** (signed-up; #5cbf86 in dark) and **Signed Red** (signed-down; #ef7b72 in dark): only on signed variations, colored by whether the move is good for the household (more spending reads red even though it is "up"). Budget bars use Mantine `teal.7` under budget and `red.7` over it; the Gastos/Ingresos sparklines use `red.7`/`teal.7`.

### Neutral
- **Blue-Grey Ground** (ground): the app background behind panels.
- **Panel White** (panel): panel bodies, active tab, active rail link tile.
- **Strip** (strip, with strip-top to strip-bottom as its gradient): panel title bars, table headers, breadcrumb strip, modal header, tab panels, hovered rows.
- **Rule** (rule) and **Strong Rule** (rule-strong): 1px panel borders and dividers; strong rule for input borders, table-header underline, segmented controls, ghost bars.
- **Ink** (ink) and **Muted Ink** (ink-muted): text and secondary text (labels, captions, source lines). Muted ink stays at #4f5b70, never lighter.
- **Graphite Top Bar** (topbar-top to topbar-bottom, edged by topbar-edge): the header gradient.
- **Button Face** (panel to button-face-bottom, edged by button-edge): the default/white button and small bar-button gradient.

### Named Rules
**The Ocre Means Real Rule.** Ocre marks CPI-adjusted figures, estimates and pending states. Categories, accounts, goals and chart series never use it.

**The One Family Rule.** Decorative identity colors (categories, accounts, goals, series) are remapped into one statistical blue-to-teal family (Mantine `indigo`, `blue`, `cyan`, `green`, `lime`, `orange`, `pink`, `grape`, `violet` all resolve to slate-blue and teal tones). Identity never competes with ocre or with signed green/red.

**The Good-Or-Bad Rule.** A variation is colored by its effect, not its sign: spending up is red, income up is green, anything that rounds to zero is muted ink and never prints as "-0%".

## Typography

**Display Font:** Source Sans 3 Variable (with Source Sans 3, Myriad Pro, system-ui)
**Body Font:** Source Sans 3 Variable (same stack)
**Label/Mono Font:** the same face; monospace (ui-monospace, SF Mono, Menlo) only for technical strings.
**Hero Amount Font:** Cascadia Code, only for the big editable amount at the top of a form.

**Character:** one humanist sans in the Myriad lineage carries everything, which is what puts the system in the early-2010s web without imitating its gloss. Tabular figures are on at the body level, so every column of amounts aligns.

### Hierarchy
- **Display** (750, 1.75rem, 1.15, -0.015em): the three headline figures of the monthly release. Nowhere else.
- **Headline** (700, 19px, 1.25): the page title inside the breadcrumb strip. Theme heading sizes (h1 1.625rem down to h5 0.9375rem, all 700) serve in-page headings outside the strip.
- **Title** (700, 0.875rem, 24px line): panel title bars, release column labels at 650.
- **Body** (400-600, 0.875rem, 1.55): table cells, list rows, panel content; amounts at 600.
- **Label** (400, 0.75rem): release rows, legends, table headers (700, muted ink), "Fuente:" lines, footer.
- **Nav group** (700, 11px, +0.02em, sentence case): rail section labels in muted steel.
- **Tag** (700, 10px, +0.04em, uppercase): the small state tags only.
- **Hero amount** (Cascadia Code 600, 44px): the amount a form is about, centered and unboxed, "−" in down-red for gastos and "+" in up-green for ingresos, with the currency as a small menu beside it.

### Named Rules
**The Tabular Everywhere Rule.** Every amount and percentage is set with tabular numerals and does not wrap.

**The No Tiny Grey Rule.** Nothing smaller than 10px, and only uppercase tags reach 10px; secondary text stays at muted ink, never a paler grey.

## Layout

An application shell: a 224px navy rail fixed on the left (with "Nuevo movimiento" at its top, then grouped nav), a 52px graphite top bar holding the scope tabs (Hogar / Mío / partner) on the left and ARS/USD tabs, alerts and the user on the right. Main content sits in a centered column at 20px shell padding, as wide as the page needs (`PAGE_WIDTH` in `Layout.tsx`, `.pfd-page`): 1320px for data pages (Inicio, Movimientos, Cuentas, Presupuestos, Reportes, Cierre de mes), 1000px for settings and short lists, 760px for single-column lists (Pendientes, Perfil de datos). A small panel on its own is centered in its area, not pinned to the left.

Each page opens with the breadcrumb strip (home icon cell, divided by a rule, then the title and an optional muted description, actions right-aligned), 20px above the content. Content is a grid of boxed panels: on Inicio, the three-column release band across the top, then a wide main column (ranked bars, latest movements) beside a narrower column of blue-barred side panels. Panels stack with 16-20px gaps on the Mantine spacing scale (10/12/16/20/32px).

Responsive: at 48em the rail collapses behind a burger, the scope tabs move into a 40px graphite strip at the top of the content, the release band stacks to one column with horizontal rules, and compact tables hide every tag except "Pendiente". At 36em ranked-bar rows put the bar on its own line under the label.

## Elevation & Depth

Panels are flat: no drop shadow on any box, depth comes from 1px rules, the strip/panel tonal step and gradients. The era's depth lives only in interactive and framing chrome, kept slight: a 1px white top highlight on gradient faces, a 1px soft under-shadow on buttons, an inset well on inputs, and a pressed-in inset on active tabs and pressed buttons. Mantine's floating layers (menus, popovers) take the theme's `md` shadow because they genuinely float.

### Shadow Vocabulary
- **Top highlight** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.7)`; 0.22 on blue bars and filled buttons, 0.8 on button faces, 0.12 on the top bar): the lit upper edge of every gradient face.
- **Button lift** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 1px 1px rgba(15,42,74,0.14)`): filled buttons; default buttons use 0.8 / 0.1.
- **Pressed** (`box-shadow: inset 0 2px 4px rgba(0,0,0,0.22)`): any button while active; its gradient drops.
- **Pressed tab** (`box-shadow: inset 0 2px 6px rgba(0,0,0,0.45)` over `linear-gradient(rgba(0,0,0,0.42), rgba(0,0,0,0.28))`): the active top-bar tab.
- **Input well** (`box-shadow: inset 0 1px 2px rgba(15,42,74,0.09)`), plus a 2px `navy.1` ring on focus.
- **Floating** (`box-shadow: 0 4px 12px rgba(15,42,74,0.14)`): menus and popovers only.

### Named Rules
**The Ruled Not Raised Rule.** A panel is a box with a border, not a card with a shadow. If it does not float over other content, it casts nothing.

**The Slight Depth Rule.** Gradients are short and soft (white to #eaeef3, #3f73b3 to #20508b). No gloss highlights, bevels, embossed text or textures.

## Shapes

Square by default. Corners are 0px on panels, modals, tabs, pagination, tags, progress bars and rail links, 1px on buttons and inputs (the theme default), 2px at most on the remaining small controls. Only switches (the familiar pill lever), avatars and notification indicators are round. Borders are always 1px; dotted 1px rules separate the release figure from its rows; dashed outlines mean "real". Category swatches are 10px squares.

## Components

### Buttons
Small, physical, quiet.
- **Shape:** near-square (1px).
- **Primary (filled navy):** navy-primary face with a white-to-clear vertical sheen, 1px `rgba(0,0,0,0.28)` border, top highlight and button lift.
- **Default / White:** white to button-face-bottom gradient, 1px button-edge border, top highlight. The rail's "Nuevo movimiento" is the white variant with navy ink.
- **Hover / Focus / Active:** 120-150ms on shadow and background; 2px focus-navy outline offset 1px; active drops the gradient into the pressed inset; disabled loses gradient and shadow.
- **Bar button ("Ver todos", "Editar", "Detalle"):** a 22px link-button in title bars, 12px/600, button-face gradient and edge; keeps dark navy ink on its light face even inside blue bars.
- **Toggle filters:** default compact buttons that switch to the title-blue gradient with white text and a pressed inset when on; these replace pill chips.

### Chips
Not used as pills. Categories render as small light Mantine badges (2px corner at most, sentence case, 600) in the series family; free tags as outline grey badges.

### Tags (NEW-style state tags)
- **Style:** 16px tall, 5px side padding, 10px uppercase 700 white text on a short vertical gradient (tag-blue default, tag-ocre for "Pendiente", grey #7d889b to #566175 for muted states), square.
- **Use:** transaction and page state only ("PENDIENTE", "COMPARTIDO", page badge). Never as section labels.

### Cards / Containers (boxed panels)
- **Corner Style:** square (0px).
- **Background:** panel on ground; body padding 16px.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px rule; blue-barred panels take the title-blue-edge border.
- **Title bar:** any panel that opens with a title becomes a 40px strip: strip gradient, 1px rule underneath, top highlight, title at 14px/700, actions right. Side panels (Presupuestos, Saldos, Cuentas, Cuotas, Metas) use the blue gradient with white title and pale (#dbe6f4) secondary text.

### Inputs / Fields
- **Style:** white field, 1px strong-rule border, 1px corner, inset well; segmented controls are boxed in strip with a 2px inner gutter and a bordered, shadowless indicator.
- **Focus:** border to focus-navy plus a 2px `navy.1` ring (`navy.8` in dark).
- **Error / Disabled:** Mantine defaults on the red family.

### Navigation
- **Rail:** 14px links on navy, 7px block padding, square; hover rail-navy-hover in 150ms; active is a white tile with bold navy text (dark: a rail-navy-hover tile with a 1px `navy.5` inset ring). Group labels in nav-group type.
- **Top bar tabs:** full-height cells divided by a dark 1px line with a faint light line beside it; 14px/600, 18px side padding (12px/12px type when compact, as for ARS/USD); active cell is pressed in.
- **Tabs in pages:** strip-gradient tabs with 3px gaps attached to a ruled tab panel (strip background, no top border); the active tab is panel white and opens onto the box.
- **Pagination:** square button-face controls; active control in title-bar blue.
- **Footer:** a slim 12px muted strip under a 1px rule naming the sources (BNA, IPC INDEC) and a few links.

### Release Triple (signature)
Three equal cells in one ruled box, divided by vertical rules: a 14px/650 muted label, the display figure, an 84x30 linear sparkline (navy, red or teal, 0.12 fill), then a dotted rule and a two-column definition list of var. mensual, var. real (with the ocre "(e)" mark when CPI is estimated) and a context row, values right-aligned at 650. A "Fuente:" line follows the box.

### Ranked Bars with Nominal|Real Switch (signature)
Rows of swatch + name, a 14px navy bar with a 1px outlined ghost of the comparison month (dashed ocre when real), amount and signed change, separated by 1px rules. Widths animate in 200ms `cubic-bezier(0.16,1,0.3,1)`. The "Nominal | Real (IPC)" segmented switch sits in the title bar and is disabled with an explanation when the currency is USD.

## Do's and Don'ts

### Do:
- **Do** box every work area in a 1px-ruled, square panel and let its first title become the header strip.
- **Do** give side panels the blue gradient title bar and keep "ver/más" actions as small bar buttons inside it.
- **Do** pair every headline figure with var. mensual and var. real, and end figure groups and charts with a "Fuente:" line.
- **Do** set every amount in tabular Source Sans 3 and color changes by good/bad for the household.
- **Do** keep motion to 120-200ms state changes (hover, press, bar width).
- **Do** use toggle buttons and square tags for filters and states.
- **Do** keep related things within one glance: a label next to its value or control, a tag next to what it labels, figures next to their title. When a screen has little on it, narrow and center it rather than spreading it out.

### Don't:
- **Don't** put drop shadows on panels or use floating white cards; only menus and popovers cast a shadow.
- **Don't** round panels, tabs, tags or fields beyond 2px, and don't use pill-shaped fields or chips.
- **Don't** use ocre, green or red for decoration, categories or series.
- **Don't** add heavy gloss, bevels, embossed text, textures, carousels, or pages that stretch a few items across the whole screen.
- **Don't** set secondary text paler than muted ink (#4f5b70) or below 10px.
- **Don't** use donut charts as the summary view; the ranked bars carry the breakdown.
