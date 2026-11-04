---
name: Maverick Jellyfin Complete
description: Seasonal Jellyfin collections run as a timetable of scheduled departures, with every change planned, reviewed and traceable.
colors:
  paper: "#fafaf8"
  ink: "#131313"
  ink-2: "#474743"
  ink-3: "#66655f"
  rule: "#dcdbd5"
  rule-2: "#8c8b85"
  hover: "#efeee9"
  timetable-yellow: "#ffd200"
  yellow-ink: "#131313"
  signal-red: "#c8101b"
  rail: "#131313"
  rail-ink: "#f4f3ee"
  rail-ink-2: "#b8b7b1"
  rail-rule: "#2c2c2a"
  paper-dark: "#15161a"
  ink-dark: "#f1efe8"
  ink-2-dark: "#c3c1b9"
  ink-3-dark: "#a8a69d"
  rule-dark: "#2e3036"
  rule-2-dark: "#6f6e69"
  hover-dark: "#1f2126"
  signal-red-dark: "#ff7a72"
  rail-dark: "#0b0c0e"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 750
    lineHeight: 1
    letterSpacing: "-0.005em"
    fontVariation: "\"wdth\" 70"
    fontFeature: "\"tnum\""
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 90"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
    fontVariation: "\"wdth\" 100"
  body-sm:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  band:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "0.02em"
    fontVariation: "\"wdth\" 80"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    fontVariation: "\"wdth\" 85"
    fontFeature: "\"tnum\""
rounded:
  hairline: "2px"
  sm: "3px"
  pill: "9px"
  full: "50%"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
  button-on-yellow:
    backgroundColor: "{colors.yellow-ink}"
    textColor: "{colors.timetable-yellow}"
    rounded: "{rounded.sm}"
    height: "32px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-danger-hover:
    textColor: "{colors.signal-red}"
  button-sm:
    padding: "0 8px"
    height: "26px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  segment:
    textColor: "{colors.ink-2}"
    typography: "{typography.body-sm}"
    padding: "0 10px"
    height: "28px"
  segment-selected:
    backgroundColor: "{colors.timetable-yellow}"
    textColor: "{colors.yellow-ink}"
  segment-inherited:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
  chip:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  chip-next:
    backgroundColor: "{colors.timetable-yellow}"
    textColor: "{colors.yellow-ink}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  timetable-row-next:
    backgroundColor: "{colors.timetable-yellow}"
    textColor: "{colors.yellow-ink}"
    padding: "8px 10px"
  next-panel:
    backgroundColor: "{colors.timetable-yellow}"
    textColor: "{colors.yellow-ink}"
    padding: "12px 16px 16px"
  rail-item:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    padding: "9px 16px"
  rail-item-current:
    backgroundColor: "{colors.timetable-yellow}"
    textColor: "{colors.yellow-ink}"
---

# Design System: Maverick Jellyfin Complete

## Overview

**Creative North Star: "The Station Timetable"**

The year is a departures board. Every collection change is a scheduled departure with a date, a change, a destination collection, a library, its sources and remarks, and the interface is set like a railway timetable poster: paper, black ink, hairline rules, month bands, and one posted departure on yellow. Information is dense and tabular, read down columns rather than across cards. Nothing floats; hierarchy comes from heavy rules, weight and the width axis of a single typeface.

Light mode is paper-white ground with black ink and a black left rail; dark mode is a deep-ink ground with warm paper text, the same yellow, and a softened red. The palette is four inks and their tints of ink, with no tinted card surfaces. Kometa's seasonal posters appear only as content inside rows, never as decoration of the frame.

The direction lends type, palette, density and one signature move; layout, navigation and controls stay the conventional ones (left rail, top bar, tables, forms, segmented controls).

**Key Characteristics:**
- Four inks: paper, ink, timetable yellow, signal red. Everything else is a tint of ink.
- One family, Archivo, with the width axis carrying hierarchy and tabular figures on every number.
- Hairline 1px rules between rows; 2px ink rules open sections and table heads; month bands group the schedule.
- Flat: no shadows, no card fills, no gradients in the product.
- Tables drop whole columns by priority instead of squeezing.

## Colors

A poster palette: near-white paper, near-black ink, one committed yellow and one alarm red.

### Primary
- **Timetable Yellow** (`timetable-yellow`): a solid panel or fill that means "next" or "selected". It posts the next-change panel, the next rows in the timetable, the next window in the year strip, the opening-date chip, the current rail item, the selected segment, the bulk-selection bar, selected table rows, and text selection. It also fills the degraded-state dot and the dry-run notice (a held state that is waiting, not failing). Text on yellow is always `yellow-ink`; yellow is unchanged in dark mode.

### Secondary
- **Signal Red** (`signal-red`, dark `signal-red-dark`): failures and the today hand only. Failing-state dots, field errors, invalid input borders, a full cap meter, and the red today line with its disc on the year strip. It is also the hover/focus color of destructive buttons, never their resting color.

### Neutral
- **Paper** (`paper`, dark `paper-dark`): the ground of every surface, including inputs and buttons.
- **Ink** (`ink`, dark `ink-dark`): text, 2px section rules, primary buttons, live windows, checkbox accent, the focus ring in light mode.
- **Ink 2** (`ink-2`): secondary text, column heads, remarks, crumbs.
- **Ink 3** (`ink-3`): faint text: hints, disabled labels, axis ticks.
- **Rule** (`rule`): the 1px hairline between rows and around chips and choices.
- **Rule 2** (`rule-2`): control strokes (buttons, inputs, segmented controls), dashed empty states.
- **Hover** (`hover`): the only tonal fill: row hover, disabled inputs, poster placeholders.
- **Rail** (`rail`, `rail-ink`, `rail-ink-2`, `rail-rule`): the black navigation rail in both themes (`rail-dark` in dark mode).

### Named Rules
**The Four Inks Rule.** Paper, ink, yellow, red. Any new color must be a tint of ink; there are no brand blues, greens or tinted card surfaces.

**The Posted Departure Rule.** Yellow is a committed solid fill for the next change and for selection (plus the held/degraded state). It is never an accent stripe, gradient, border-only highlight or decoration.

**The Alarm Rule.** Red means something is failing, or it is the today hand. Nothing rests red; destructive actions turn red only on hover or focus.

## Typography

**Display Font:** Archivo (variable, self-hosted, weight 100 to 900, width 62% to 125%), with ui-sans-serif, system-ui fallback
**Body Font:** Archivo
**Label/Mono Font:** Archivo for labels; ui-monospace only for inline code identifiers

**Character:** One humanist grotesk doing every job. Narrow widths (70 to 88) compress dates, column heads, bands and the departure figure the way a timetable is set; normal width (100) is for reading.

### Hierarchy
- **Display** (750, 2rem, line-height 1, width 70): the departure time in the next-change panel. One per screen.
- **Headline** (700, 1.375rem, width 90, -0.01em): page title in the top bar. The overview page uses 750 at 1.75rem, width 88.
- **Title** (700, 1.0625rem): section heads ("Needs you", "Upcoming changes", form sections).
- **Body** (400, 0.875rem, line-height 1.45): table cells, rows, form values. Prose blocks cap at 68 to 72ch.
- **Body small** (400, 0.8125rem): notices, key-value lists, hints in panels, segmented labels (550).
- **Band** (750, 0.8125rem, width 80, +0.02em): month bands and group heads in the timetable.
- **Label** (600, 0.75rem, width 85): table column heads, year-strip months, legends. Sentence case, as built.

### Named Rules
**The Width Axis Rule.** Hierarchy in data comes from width and weight, not size: dates set at width 85 weight 650 with the time in 400 ink-2 beside them.

**The Tabular Figures Rule.** Every number (table cells, counts, times, the timetable) uses tabular figures so columns align.

## Layout

An app shell of a 216px black rail and a fluid main column. The main column has a top bar (title, crumbs, actions to the right, a clock) over a content area padded 24px with 32px between sections. Spacing runs on a 4px base: 4, 8, 12, 16, 24, 32, 48.

The dashboard opens with a three-part answer band (Needs you, Service notices, Next change on yellow) in a 1 : 1.3 : 1 grid, then the year strip, then the month-grouped timetable. Editors use two equal columns (form, then a sticky preview); Missing uses a list and a 340px sticky drawer; Settings uses a 200px sticky sub-navigation beside the form.

Responsiveness is container-query driven on the app frame (`container: app`), not the viewport:
- **1300px:** low-priority columns in the Missing list hide.
- **1260px:** timetable drops its first two priority columns (Library, Via) whole.
- **1100px:** editor and Missing collapse to one column; preview and drawer stop sticking.
- **980px:** rail collapses to a 64px icon rail (counts become corner badges); the answer band goes to two columns with Next change full width.
- **860px:** Settings sub-nav becomes a horizontal tab strip; connection rows stack.
- **640px:** rail becomes a bottom tab bar; everything is one column; content padding drops to 16px; the year strip becomes a now-and-next list.

### Named Rules
**The Whole Column Rule.** Tables drop whole columns by priority as space shrinks; they never squeeze, wrap mid-column, or scroll sideways.

## Elevation & Depth

Flat. The product has no shadows, no blurs and no layered surfaces; depth is conveyed by rules and ink. A 2px ink top rule opens a panel or form section, a 2px ink underline sits under table heads, 1px ink rules sit under month bands, and 1px `rule` hairlines separate rows. Sticky elements (preview, drawer, sub-nav, bulk bar) stick without a shadow.

### Named Rules
**The Ruled Not Raised Rule.** Grouping is a heavy rule above, never a box with a shadow or a tinted fill.

## Shapes

Near-square. Controls, chips, inputs and choice tiles take a 3px radius; posters and year-strip windows take 2px. Only two things are round: the 9px pill of rail counts and the 50% status dots and today disc. Strokes are 1px; selected choices thicken to a 2px ink outline (inset). Dashed strokes mean unavailable or not owned: disabled choices, off windows, empty states, other tools' jobs on the day timeline. Diagonal hatching marks short windows in the year strip and its legend.

## Components

### Buttons
Plain, outlined, compact.
- **Shape:** 3px radius, 32px tall (26px small), 1px `rule-2` stroke, weight 550.
- **Default:** paper fill, ink text; hover fills `hover`; press nudges down 1px.
- **Primary:** solid ink with paper text; one per view (Save changes, Run now). Hover goes to ink-2.
- **On yellow:** ink fill with yellow text, used only inside yellow panels.
- **Ghost:** no stroke until hover.
- **Destructive:** outlined in `rule-2` with ink text at rest, identical to a default button; turns red (text and stroke) only on hover or focus. It always stands alone: 32px of clear space and a 1px rule to its left, separating it from the rest of the action group.
- **Loading:** ink-2 text with a 12px spinning ring.

### Segmented Control
The mode vocabulary: Off / Review / Auto, and other short exclusive choices (Movies/Shows/Both, Fixed dates/Relative rule, Sync/Append).
- **Style:** one 1px `rule-2` box with 3px radius; options 28px tall, 0.8125rem 550, divided by 1px hairlines, ink-2 text.
- **Selected (explicit):** solid timetable yellow with yellow-ink text.
- **Inherited:** when the value comes from Settings, the active option is not filled; it is ink text with a 2px ink underline (inset). An explicit override is selected yellow and labelled with an "override" chip.
- **Disabled:** ink-3 with a line-through.
- **Focus:** 2px focus outline inset.

### Chips
- **Style:** 1px `rule` stroke, 3px radius, 0.75rem ink-2 text. Used for source provenance, phase markers, "suggests", "override".
- **Variants:** solid ink (pinned), yellow (the opening date of the next window), red outline (failing).

### Status Dots
9px circles with a 1.5px ink stroke. **Hollow** = OK; **yellow fill** = served from cache, degraded, or held (dry run); **red fill** = failing; **solid ink** = live. Each dot carries an accessible label.

### Inputs / Fields
- **Style:** paper fill, 1px `rule-2` stroke, 3px radius, 32px tall, 10px inline padding. Label above in 600 0.8125rem; hint below in 0.75rem ink-3.
- **Hover:** stroke darkens to ink-2. **Focus:** 2px focus outline offset 2px (ink in light, yellow in dark).
- **Error:** red stroke with a red 0.75rem message. **Disabled:** `hover` fill, ink-3 text.
- **Choice tiles:** radio cards with a 1px rule; checked gets a 2px ink outline; unavailable options are dashed and faint but still visible with their reason.
- **Token field:** a bordered input holding removable chips.

### Navigation
- **Rail:** black in both themes. Items 500 weight with a 16px stroke icon; hover fills `rail-rule`; current item is a solid yellow bar with 650 weight. Counts are inverted pills. The foot holds the dry-run state and last run.
- **Tabs:** 600 weight ink-2 labels on a hairline; current tab is ink with a 3px ink underline; counts follow in ink-3.
- **Sub-nav (Settings):** a hairline left edge; current item gets a 3px ink left bar.

### Timetable (signature)
The schedule set in a timetable's column rhythm: Date, Change, Collection, Library, Via, Remarks.
- Column heads in Label type over a 2px ink rule; rows on 1px hairlines with 8px 10px cells; row hover fills `hover`.
- Month bands in Band type with 16px top padding over a 1px ink rule.
- Date in width 85 weight 650 with the time in 400 ink-2; collection in 600; remarks ink-2.
- Change glyphs: a solid 8px square for "opens", a hollow 5px square for "closes".
- The next departure's rows are posted solid yellow; selected rows are yellow too.
- The Review queue reuses the same table with group heads per collection and action, and a sticky yellow bulk bar for selections.

### Year Strip (signature)
Twelve equal month columns on hairline gridlines under a 1px ink baseline, with windows packed into three 24px lanes.
- Windows: 20px boxes with a 1px ink stroke and 2px radius, 11px 600 width-78 labels. Live = solid ink; next = yellow; scheduled = outline; short windows (under 10 days) = diagonal hatch; off = dashed faint.
- The today hand: a 2px red line with a 12px red disc and a red "Today" label. A legend sits beneath.
- On a phone the strip becomes a now-and-next list.

### Next-Change Panel
The one yellow panel on the dashboard: yellow fill under a 2px yellow-ink top rule, the departure set in Display type, the opening and closing rows, the plan summary, and an on-yellow button.

### Notices and Meters
- **Service notice:** dot, bold name, ink-2 detail and a Retry button on a hairline row. Healthy services share one line.
- **Banner:** a full-width yellow strip under the top bar for the held dry-run state.
- **Cap meter:** an 80px by 6px bar on `rule` filled in ink, red when the cap is full, beside a running total (7/10).

## Do's and Don'ts

### Do:
- **Do** keep to four inks; derive every neutral as a tint of ink.
- **Do** post the next change and the current selection on solid timetable yellow with yellow-ink text.
- **Do** use red only for failures and the today hand.
- **Do** set every number with tabular figures, and compress dates, heads and bands with the width axis (70 to 88).
- **Do** open sections with a 2px ink rule and separate rows with 1px hairlines.
- **Do** isolate destructive actions behind 32px of space and a hairline, outlined in ink at rest.
- **Do** show inherited modes as an underlined segment and explicit overrides as yellow plus an "override" chip.
- **Do** drop whole table columns by priority at the container breakpoints.

### Don't:
- **Don't** build KPI cards, tinted card surfaces or dark-slate dashboard panels.
- **Don't** add shadows, gradients or blurs to product surfaces.
- **Don't** use yellow as an accent stripe, border-only highlight or decoration.
- **Don't** rest a button in red; destructive actions turn red only on hover or focus.
- **Don't** introduce a second typeface; monospace is for inline code identifiers only.
- **Don't** add holiday decoration or terminal/log-viewer styling; seasonal posters appear only as content.
