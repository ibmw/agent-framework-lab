# ADR 0079 — The width folds the rail at a phone's width

Status: accepted — 2026-10-26; the narrow opening decided 2026-10-27

Amends ADR 0016, *The helpdesk workspace* ("The rail collapses to icons **only when the author
asks**"); ADR 0055, *The bar is one row*; and ADR 0058, its *Reset to defaults…* section, as to
what the rail's preference governs. Every other decision of the three stands, as do ADR 0044's and
ADR 0054's on where the collapsed state lives: one browser preference for both rails, never a
database row.

## Context

The operator decided on 22 October 2026 that the rail collapses at phone width in Milestone 12, as
a shell slice (PLAN-UX Milestone 12). On the seeded run's results page at 390×844 the expanded rail
took 216px of the 390. The pane left was 174px wide, and it scrolled sideways to 509px. The top
bar's three groups needed 813px on one 56px row, so Settings ended at x=813 and *Show me around* at
x=689, and the window had nothing to scroll them back with. Of the 139 elements drawn past the
viewport, none could be reached. The live bench was the same, with a 206px scroll in a 174px pane.
The rail's *Collapse menu* already drew the 52px strip, but only when the operator pressed it, and
a phone's press was then remembered by the desktop that came after it.

Three standing texts said the rail never folds on its own. ADR 0016: "An earlier version folded the
rail automatically on the ticket routes … that made one shared control mean different things
depending on which section you had navigated to, and an author who had never collapsed the menu
arrived to find it collapsed. … the toggle is the only thing that changes it." `AppShell`'s
comment said the same: "a navigation that folded the menu on its own would make the same control
mean different things depending on where you happened to be standing". ADR 0054 added that the
collapse "is a statement about how much room the operator wants and not about where they are
standing".

## Decision

### The narrow breakpoint is 48rem, written once for the classes and once for the hook

The viewport is narrow below 48rem (768px): `(width < 48rem)`. That is Tailwind's `md`, the
point at which the execution timeline's lanes already stack (`md:` in `ExperimentTimelinePage.tsx`),
so the workspace has one answer to "is this a phone". Below it, the expanded rail leaves the pane
under 552px, which is under 504px of content after the pane's padding. Every phone and a small
tablet held upright are under it. A 768px tablet and every desktop window keep the remembered
choice.

The string is in two places because a stylesheet cannot export it and `matchMedia` cannot read a
variant. `styles.css` declares `@custom-variant narrow (@media (width < 48rem));`, and the classes
below use it. `lib/viewport.ts` exports `NARROW_VIEWPORT_QUERY` with the same string, and
`useNarrowViewport()` subscribes to it through `useSyncExternalStore`. `lib/viewport.test.ts`
reads the stylesheet as text and fails if the variant's query is not exactly the constant.
`test/viewport.ts` stubs `matchMedia` to answer that constant and nothing else, so a hook that
asked another question would read as wide and fail every narrow case. Where `matchMedia` is
missing (jsdom, an old browser), the viewport reads as wide.

### Below it, the width folds the rail, and never writes the preference

Below the breakpoint the rail is the 52px strip, whatever the browser remembers. This is true for
both rails, because there is one preference. Nothing the rail does at that width writes
`agent-lab.navigation-collapsed`: a stored `true`, a stored `false` and no value at all are each
left exactly as they were. When the viewport widens past the breakpoint, the remembered choice
is drawn again.

This departs from ADR 0016's rule on purpose, and its reasoning still holds where it applied. ADR
0016 refused folding by **route**: on one screen at one size, the same press meant different
things depending on the section, and an author arrived somewhere to find the rail folded for
reasons the screen did not show. The width is not a route. At a given width the rail does the same
thing on every route, and the press means the same thing on every route. No route folds the rail
differently from another: above the breakpoint nothing but the author's control moves it, and
below it a navigation folds an opening the same way wherever it lands (next section). ADR 0054
calls the preference a statement about how much room the operator wants, and the room is exactly
what the width changes. A choice made about a desktop's room is not overridden by a phone. It is
kept for the next time there is a desktop's room to apply it to. A phone has no room for the
column and a pane beside it, so the choice that preference would make for a phone is already the
strip's.

### The control at narrow width opens the rail to pick a destination

The strip's foot control still reads *Expand menu*. Pressed below the breakpoint, it draws the
216px column in place, as it does when wide, and the pane narrows beside it. It writes nothing.
*Collapse menu* then folds it back, and also writes nothing.

**Going somewhere folds it again.** The operator decided on 27 October 2026 that a column opened
at a phone's width is for picking a destination, and that once there the page gets its whole width
back. Going somewhere is a change of path by a push (a rail entry, a link, a press that navigates)
or a step back or forward through history, wherever it lands, or by a replace onto another route
(a removal landing on its index, a redirect). Two things are not going somewhere and leave the
column open. A change of query or fragment alone (`?attempt=`, `#event-…`) is the same page. A
replace whose path changes but whose matched route does not — the last of `useMatches()`, by its
id — is the page moving its own address, as a product's handle does when it follows the title. A
press on the same page never folds it.

This is not ADR 0016's folding by route. That fold differed by section: the ticket routes folded
the rail and the others did not, so the same control meant different things depending on where
the author stood. This fold is the same on every route at a given width, it only ever undoes an
opening the operator made at that width for that purpose, and it never touches the remembered
preference.

Crossing the breakpoint in either direction also drops the opening: narrow again later, the rail
is the strip. Above the breakpoint the control is the author's, as before, a navigation leaves the
rail as the author left it, and the control writes the choice.

The column opens in place and does not overlay the page. An overlay is a drawer: it needs a scrim,
dismissal on an outside press and on `Escape`, a focus trap, and focus returned to the control. The
workspace has no such component, and the plan admits no new UI dependency. The column in place is
the component that already exists, with its names, its counts and its tour anchors unchanged. Hiding
the control at narrow width was refused too. The strip keeps every destination's name for a screen
reader, but an operator who wants the words on screen would have no way to get them.

### The top bar wraps rather than clips

Below the breakpoint the bar drops its fixed 56px for `min-h-14` and wraps its three groups: the
identity, the mode tabs, and *Show me around* with *Settings*. Each row the tabs or the controls
land on is at least 44px tall, so each one stays a press-sized target. At 390 that is three rows
and 144px, with the switcher on the first. No control is hidden or renamed, and none is
shortened but the shop's name, which is cut on screen only when it is longer than its row (*The
indexes scroll their tables, and a long shop name is cut*, below). So the keyboard meets them in
the order it always has. Above the breakpoint the bar is ADR 0055's one 56px row, byte for byte.

### A page header's actions wrap among themselves

`PageHeader`'s actions group is `flex-wrap justify-end`. The row it shares with the title already
wrapped, and it puts the group on a line of its own before any button would have to move. So
the group's own wrap happens only once that line is narrower than the buttons, which only a
phone's pane is. Nothing moves wider than that. ADR 0066's third-of-the-pane rule decides as
before whether the header pins.

### The results' matrices keep their reading widths

Slice 44 already put the results matrices in an `overflow-x-auto` scroller and gave each arm's head
220px. The `w-16` arm head the plan named (`ObjectiveEvidence.tsx`) is gone. What remained at 390
was this. The scroller was not positioned, so each cell's `sr-only` line, which is absolutely
placed, was laid out against the pane. That made the pane 509px wide in a 338px viewport, the same
escape ADR 0066 found down the page. The scroller is now `relative`. The objective column also
gave its width up to the arms', and was 88px. It now keeps `min-w-[10rem]`, and the card scrolls
whatever is left over.

### The indexes scroll their tables, and a long shop name is cut

Each index on the index template draws one table in a card, and nine of them had no scroller. The
card's `overflow-hidden` clipped the columns past its edge, out of reach, and an `sr-only` line
in the table, laid out against the pane, could still push the pane sideways. Every
index's table now sits in a scroller, and so do the results matrices. The class set is the one
Slice 53 gave the matrices, `relative overflow-x-auto`, and it is declared once as
`tableScrollerClasses`. History's table already scrolled, but its scroller was not positioned, so
it was the matrices' escape again.

The switcher's name is the one text in the bar that grows with what the operator types. Every box
down to it is `min-w-0`, and the name is `truncate`, so a name too long for the row gives up its
width to an ellipsis rather than running past the viewport. This is the one text the bar shortens,
and only on screen. The button is still named "Switch shop, current: <name>" in full, and the
name's `title` is the whole name for a pointer.

## Departures

- `tmp/design-frames/README.md`, *Chrome*: "**Top bar** — 56px." The bar keeps it from 48rem up;
  below, it wraps to as many rows as its groups need — 144px at 390. The prototype draws no phone
  width, so nothing else here departs from it. Recorded in `docs/design-direction.md`,
  *Departures from the handoff, in force*, whose principle *Desktop first, usable narrower* is
  rewritten to say that the rail narrows and that this ADR decides how.

## Consequences

- Settings' *Start with the navigation rail collapsed* row now says where it stops applying: its
  hint names the rail's control as writing the same preference, and says that on a phone-width
  screen the rail starts as its strip whatever the row says, and that opening it there is not
  remembered.
- No accessible name, `title`, tour anchor or landmark moves. No Playwright spec is renamed or
  re-pointed.
- Measured at 390×844 on the seeded run: the results page and the live bench draw nothing past the
  viewport. The pane is 338px wide and does not scroll sideways (it was 174px, scrolling to 509px
  and to 206px), and the rail is 52px with the stored preference untouched. At 1440×900 both pages
  are pixel-identical to the screenshots taken before.
- `sticky-header.spec.ts`'s sized header measures 261px against a third of 235.33px at 390×844
  (it was 350px against 262.67px). The pane is wider and shorter there now, the header still
  scrolls away, and the margin still holds.
- The indexes and the switcher at 390 were settled on 2026-10-27, measured on a built chain at
  390×844. All thirteen indexes on the index template now draw their table in
  `tableScrollerClasses` (`lib/ui.ts`). Every figure here is the pane's scroll width against the
  pane's own width: 338px beside the 52px strip, and the whole 390px on the shops index, which
  draws no rail. The two marked *about* move by a pixel with the generated names. Before,
  Products' pane scrolled to 479px of 338 and its last columns were clipped by the card.
  History's unpositioned scroller let its rows' `sr-only` reasons out to about 654px of 338. A
  scroller without `relative` is not enough either: in one, the shops index's pane still scrolls
  to about 426px of 390, and Products' to 479px of 338. A shop name longer than the bar's row is
  cut with an ellipsis, and the button's name and the name's `title` carry it whole. No
  accessible name, tour anchor or landmark moves.
- This ADR still does not cover the tables off the index template at 390. The snapshots page's
  three tables (`SnapshotsPage.tsx`) and the shop version's (`ShopVersionPage.tsx`) have no
  scroller inside their `overflow-hidden` card. Experiment setup's matrix
  (`ExperimentSetupPage.tsx`) has none either. The product editor's variants table
  (`ProductEditorPage.tsx`) scrolls, but its scroller is not `relative`, and its cells carry
  `sr-only` lines. The results page's *Quantitative* table (`ExperimentResultsPage.tsx`) has no
  scroller inside its card, and nobody has measured it at 390. These are the ones known on
  2026-10-27, not a sweep of every table. Each is a narrow-width slice of its own.

## Verification

- `lib/viewport.test.ts`: the stylesheet's `narrow` variant is the hook's query, declared once, and
  the query is `md`.
- `shell/AppShell.test.tsx`, *the rail at a phone's width*: the strip with nothing stored, with
  `false` and with `true` stored, each left as it was; the lab's rail too; expanding at narrow
  width opens the column and writes nothing, and collapsing it again writes nothing either, for
  each of the three stored states; widening restores a remembered column and a remembered strip,
  whatever was opened narrow; an opening is forgotten once the viewport has been wide; an opening
  folds once the path changes by a push, for each of the three stored states, each left as it was,
  and on a step back through history, and on a replace that lands on another route; it stays open
  on a query, a fragment, or a replace that stays on its route; a wide rail is left as the author
  left it across a navigation; a wide column folds when the viewport narrows, unwritten; and wide,
  the control still writes the choice. *The top bar at a phone's width*: the `narrow:` wrapping
  classes are present and the wide 56px row is unchanged, and the switcher drops its divider below
  the breakpoint, where it would stand mid-row with nothing after it; every control is still
  reached by Tab, in order, at narrow width.
- `LabSettings.test.tsx`: the rail row's hint says the control writes the same preference, and
  that on a phone-width screen the rail starts as its strip and an opening there is not
  remembered.
- `App.test.tsx`, *the workspace at a phone's width*: on the product editor as the application
  ships, the strip with `false` and with `true` stored, unchanged; a rail opened narrow folds once
  a rail entry is followed, and writes nothing; Save and Discard sit in the header group that
  wraps, and the wrapped Save still saves.
- `WorkspaceChrome.test.tsx`: the header's actions group is `flex-wrap justify-end`, holds every
  action and nothing else, inside the row that wraps first.
- `Experiments.test.tsx`: both results matrices scroll in a `relative` scroller, with the objective
  column at `min-w-[10rem]` and each arm head at 220px.
- Each index's suite, *scrolls its table inside its card* (`expectIndexTableScrolls`,
  `test/indexes.ts`), checks the box the table sits in. That box is inside the card, is not the
  card, and is `overflow-x-auto relative`. The suites are `Shops`, `App` (Products), `Orders`,
  `Customers`, `Tickets`, `Scenarios`, `Documents`, `SupportIdentities`, `AgentConfigurations`,
  `JudgeConfigurations`, `Blocks` and `History`. History's also holds a row's `sr-only` fork
  reason inside the scroller.
- `shell/AppShell.test.tsx`, *the top bar at a phone's width*: a long shop name is `truncate`
  with its whole self as its `title`, the button and its group are `min-w-0`, and the button is
  still named "Switch shop, current: <name>" in full.
- `tests/e2e/workspace-shell.spec.ts`, *at a phone's width the rail is the strip…*: a first paint
  at 390×844 with nothing stored is the strip, passes nothing past the viewport, and leaves the
  key absent. Then, for a stored `false` and a stored `true`: at 390×844 the rail is 52px wide and
  nothing passes the viewport (no document or pane overflow, and no element outside a scroller
  that is itself on screen); the top bar has grown past 56px and every control it draws is inside
  its box and the viewport (`expectTopBarHoldsItsControls`, `support/viewport.ts`); the rail
  opened narrow is the strip again once *Orders* is followed from it, nothing on Orders passes
  the viewport, and the stored value is unchanged. At 1280 the
  remembered state is back. The lab's rail on the bench folds at the same width. *At a phone's
  width the indexes scroll their tables…*: on a built chain, each of the thirteen indexes draws
  its table and passes nothing past the viewport. History's rows carry `sr-only` lines. A shop
  named past the bar's row draws its name cut (content wider than its box, `text-overflow:
  ellipsis`), is still named in full, passes nothing past the viewport and keeps the bar's
  controls in it.
- `tests/e2e/experiment-start.spec.ts`: the results of the journey's run at 390×844 show the
  strip, pass nothing past the viewport, and keep the bar's controls in it. The journey's cells
  carry no timeline link, so they hold no `sr-only` line. The spec's second journey, *a deciding
  call scrolled to inside the results matrix…*, records through the API a run whose one row names
  a deciding call in each arm (`recordDecidedRun`, `support/lab.ts`). At 390×844 arm B's link
  starts past the scroller's right edge with the scroller at rest, is scrolled to inside it, and
  nothing passes the viewport. Followed, it lands focused on that call in the timeline. Without
  `relative` the pane scrolls to 494px of 338 there (581px on the seeded run), and the journey
  fails.

## Migration

None. No contract, route, stored key or stored value changes; a browser's remembered choice is read
as it was written.
