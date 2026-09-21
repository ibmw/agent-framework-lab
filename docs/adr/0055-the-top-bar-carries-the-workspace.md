# ADR 0055 — The top bar carries the workspace: a switcher, the tour and a Settings toggle

Status: accepted — 2026-09-20

Finishes the chrome ADR 0054 left half-drawn. The mode tabs take the prototype's glyph, underline
and inactive ink; the shop switcher stops being a `<select>` and becomes a button opening a panel;
*Show me around* leaves sixteen page headers for one mount in the bar; and *Settings* becomes a
toggle that returns to the screen it was opened over.

Records four decisions. That the switcher is a `menu` with roving focus rather than a native
select, because it draws a badge, a version and a row that is not a shop at all. That the tour
control is mounted once and resolves the surface's tour from the location against the table
`lib/tours.ts` already holds, so no route file names a tour twice. That *Settings* returns to a
**remembered location** rather than to `history.back()`, and that the location is a browser
preference and never a row. And that the bar's ground becomes a token of its own, which is also
where the departure `docs/design-direction.md` deferred to this slice — the forest hover — is
settled.

## Context

ADR 0054 split the workspace into two modes and said in as many words what it was not doing: *"The
mode tabs need somewhere to live for the lab to be reachable at all, so they ship here as two plain
links in the existing header. Their glyph, underline, inactive ink and the switcher's panel are
Slice 10's, and so is moving Show me around into the bar."* This is that slice.

What the header holds today is four unrelated things that grew one at a time. The title is a link.
The switcher is a native `<select>` whose options are shop names and nothing else. The mode tabs
are two pill links borrowed from the Settings entry beside them. Settings is a third pill of the
same class. Nothing in it is the prototype's bar, which is 56px of `#16332d` carrying a shop badge
and its name in Georgia, two stretched tabs under a white underline, and two quiet controls at the
right that fill a pill under the pointer (`Workspace.dc.html` :20–:82, the README's *Chrome*
section).

*Show me around* is the larger change and is not cosmetic. ADR 0045 put one launch control on every
surface that declares a tour, and sixteen route files mount it inside their `PageHeader`. Every one
of those mounts names the tour it launches, so `lib/tours.ts` — which ADR 0054 made name the
**route** of each surface — and the route file are two places saying which tour belongs to which
screen. They have not disagreed yet. They can, and nothing would fail if they did: the anchor sweep
navigates to the table's route and asserts that *a* control offering that tour is visible, which is
satisfied by either spelling being right.

Settings is the one control in the bar with a state. The prototype draws it lit with a close glyph
while its page is open, and returning from it is not navigation to a fixed place: an operator opens
Settings from the middle of a product editor and expects to be put back in it.

## Decision

### The bar is one row, and what it carries depends on where you are standing

56px, `#16332d`, three zones: an identity at the left, the mode tabs beside it, and the two quiet
controls pushed to the right.

The README gives the bar 56px and the prototype draws 58px; the README gives the active tab a 2px
underline and the prototype draws 3px. Both are one value against one value in one role, which is
`docs/design-direction.md`'s Authority **rule 3**: the README wins, twice. Nothing else in the bar
is in dispute, so every other measurement, colour and hover is the prototype's under **rule 2**.

**The identity is the switcher or the title, never both.** The prototype draws the app title only
when `mode === "shops"` and the switcher in every other scope; the README lists both and scopes
only the switcher, "(in shop scope)". The README is silent on where the title goes when the
switcher is drawn, so **rule 2** hands the composition to the prototype: the switcher replaces the
title at the left of the bar. Our route tree has one case the prototype does not — a lab with no
shops at all, where there is no switcher to draw — and there the title is drawn, because a bar
whose left half is empty is not a case the prototype considered and not one worth inventing a
control for. The title returns to the shops index and hovers `#cfe0d8`, which is what it does in
the prototype on the one screen it appears on.

**The tabs are present in a mode and absent outside one.** `undefined` is already the shell's
answer for the three frameless surfaces (ADR 0054), so this needs no new condition: the shops
index, Settings and the glossary draw no tabs, exactly as they draw no rail. The prototype keeps
the tabs on its settings screen because its settings is an overlay on a mode rather than a route;
ours is a route in neither mode, and drawing tabs there would be the only place in the application
where the mode is not the branch of the tree you are standing in.

### The switcher is a `menu`, not a `<select>`

The panel holds three kinds of row: the current shop with a check, the other shops with a badge and
a version, and an *All shops* row that is not a shop. A `<select>` can hold the first two as
options and cannot hold the third as anything but an option that is a lie — an `<option>` whose
choice navigates rather than selects. It also cannot carry the badge, and a `<select>` styled until
it can is the new UI dependency the plan refuses.

So the control is a button and the panel is a `menu`, with the contract that follows:

- The button carries `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`, and is named
  **"Switch shop, current: <name>"** — the verb first, because a button named only after the shop
  says what it is showing rather than what pressing it does, and the shop last, because that is the
  fact a reader arriving in the bar wants.
- Every row is a `menuitem`. The panel takes **roving focus**: exactly one row is in the tab order,
  arrows move it, `Home` and `End` jump to the ends, and opening the panel puts focus on the
  current shop.
- `Escape` closes it and puts focus back on the button. A pointer press outside it closes it. A
  navigation closes it — including the navigation choosing a shop causes, so nothing has to
  remember to close it on the way out.
- The current shop's row is named "<name>, current shop" and carries `aria-current`. It is a
  `menuitem` like the others and choosing it closes the panel and does nothing else; a row a
  reader can see, cannot reach and cannot be told about is worse than a row whose only effect is
  to agree with them.
- The rows are `menuitem` and not `menuitemradio`. A radio group is a set of mutually exclusive
  options, and this panel is not one: *All shops* sits in it and is a destination rather than a
  choice, so the radio shape would need a `group` around the shops and a second kind of row
  outside it to describe what a reader sees as one list. What it costs is the state being carried
  by `aria-current` and a word instead of by `aria-checked`, and the word is what this design asks
  for anyway — "status is never colour alone: a glyph or a word always accompanies it"
  (`docs/design-direction.md`, *Principles*). The check is the second signal.
- `Tab` closes the panel and returns to the button rather than running on. The panel is rendered
  immediately after the button, so "the next element in the tab sequence" is a row the same press
  unmounts, and where a browser resumes from a node that has gone is its own business — some keep
  a starting point at its old position, others fall back to the top of the document. Answering it
  here costs a forward Tab one extra press and leaves Shift+Tab, which was going to the button
  anyway, unchanged.

What choosing a shop *means* is ADR 0054's and does not change: in shop mode it navigates to that
shop, in lab mode it sets the lab's current shop and stays put.

**What a spec relies on.** No Playwright spec picked a shop before this one; three Vitest suites
did, through `getByRole("combobox", { name: "Shop" })`. That role is gone, and the three move to
`getByRole("button", { name: /Switch shop/ })` and the menu's rows. The plan's sentence — that one
of the eleven specs picks a shop by its name — describes the unit suites as they stood; the browser
spec that does it is added here, as the slice's own evidence, and picks the shop by its name from
the menu. Nothing a Playwright spec already reached the application by moves:
`nav[aria-label="Shop workspace"]`, `nav[aria-label="Experiment lab workspace"]`,
`nav[aria-label="Workspace mode"]`, every rail label, every tour anchor and every button name
outside the bar are where they were.

### The tour control is mounted once and reads the current surface from the route

`TourLaunch` takes no identifier. It reads the location, resolves it against `TOURS`, and renders
the control for the tour whose `route` matches — or nothing at all where no tour matches, which is
what "lit only where a tour exists" means: the control is **absent**, as the prototype's
`tourAvailable` branch is absent, rather than present and disabled. A disabled control on a product
editor would be an offer the application never intends to honour.

**A route declares its tour by being the route the table already names.** ADR 0054 put `route` on
every tour so the anchor sweep could compose its own navigation; it is now also what the bar reads,
so the tour, its address and its launch control are one row. Matching is **exact**, never by
prefix: `/shops/:shopId/products` is the catalog's tour and `/shops/:shopId/products/:handle` is
the product editor, which has none, and a rule that handed a route's tour to its children would
offer the catalog's walk on a screen none of its anchors is on.

**A surface that answers at more than one address says so, in the table.** Two do, and neither is
found by a prefix rule. The comparison is one layout behind three tabs whose header, arm cards and
provenance row all belong to the layout. The helpdesk is one screen at two URLs: `TicketsPage`
opens its newest ticket as soon as the list answers and **replaces its own address** doing it — the
list is a way in rather than a waiting room — so the bare index is an address almost no reader is
standing on. Each declares its second address in `alsoAt` beside its route, which is addressing and
not a second tour: the steps, the anchors and the surface are one.

The helpdesk is also what this decision got wrong first, and the reason the guard over it changed.
Declared with its index alone, the bar drew no *Show me around tickets* one frame after the page
opened, on every lab that holds a ticket. The anchor sweep passed anyway, because it asked whether
the control was visible on the frame after `page.goto` — before the surface had finished arriving —
and the chain step's anchor survives the redirect. So the sweep now waits for the surface to settle
and then asks **two** questions: that the address it settled at is one the table names, and that
the control is on screen there. The first is what fails loudest, and it is the one that will catch
the next surface whose loaded address is not the one it declared.

**ADR 0049 is untouched.** No tour gains or loses a step, no anchor moves, no copy changes,
`SETUP_CHAIN` and `SETUP_GUIDE_STEPS` are as they were, and the control's accessible name is still
`Show me around <surface>` — which is what `tour.spec.ts` and the anchor sweep reach it by. What
changed is which element mounts it.

### Settings is a toggle over a remembered location, not over history

While `/settings` is open, the control renders lit with a close glyph, and pressing it returns to
what was underneath.

**Not `history.back()`.** A reload leaves the settings page at the top of its own history entry
with nothing behind it, and the operator who reloads a settings page is the operator most likely to
have been reading it for a while. `history.back()` there either does nothing or leaves the
application — which is the one behaviour a control drawn as a close glyph must not have. It is also
wrong in the ordinary case whenever Settings was reached by any path other than one press of this
control: a deep link, a redirect from `/guides` (ADR 0049), a second navigation inside Settings.

**What is remembered is the last location that was not `/settings`** — path, query and fragment —
written by the shell on every navigation, so it is as correct after a reload as before one, and
correct however the operator arrived. The query travels because history's narrowing lives in the
URL (ADR 0033) and returning to a filtered history unfiltered would discard the reason the operator
was there.

**Where it is stored.** `agent-lab.settings-return` in `localStorage`, beside the three preferences
`lib/preferences.ts` already holds, guarded the way all of them are. This is a per-viewer
convenience about where one browser tab was standing; ADR 0044 refused a database row for exactly
this kind of fact, and nothing here reopens that refusal. It is not in the OpenAPI contract, not in
a fingerprint, and not evidence of anything.

Three cases, answered:

- **Reload at `/settings`.** The preference was written before the operator left the page they were
  on and is not rewritten while `/settings` is open, so the toggle returns to the same place it
  would have before the reload.
- **A deep link straight to `/settings` in a browser that remembers nothing.** The toggle returns to
  `/shops`, which is where the application opens a session it knows nothing about (ADR 0054's own
  fallback) and the one destination that exists in every lab.
- **A remembered location that no longer exists** — a shop removed, a scenario deleted. The
  preference is a string and is not resolved against anything before the move, because resolving an
  arbitrary path would mean a second copy of the route tree. The application answers the dead
  address as it answers any other: the catch-all route returns to the shops index, and a shop that
  cannot be loaded says so. That is one honest step further than the operator wanted rather than a
  silent refusal to move.

The lit control is named **"Settings, back to workspace"** — the visible word first, so a
voice-control reader saying what is on the button still reaches it, and the consequence after it.
Unlit it is the link it has always been, named "Settings", pointing at `/settings`.

### The bar's controls take the bar's own focus ring

The prototype rings its bar controls in `2px solid #1d6241`, the pine it rings everything else in.
On the bar's `#16332d` that measures **1.86:1**, under the 3:1 WCAG 2.2 asks of a focus indicator
(1.4.11) — so the one thing a keyboard reader has to locate themselves by is very nearly invisible
on the one surface that is present on every screen. `docs/design-direction.md`'s *Principles* —
"WCAG 2.2 AA contrast; every workflow keyboard-reachable" — "outrank any measurement below", which
is where the Authority's rule 2 would otherwise have carried the prototype's value.

The ring is the bar's own paper instead: 13.37:1 on the bar and 10.44:1 on the hover pill, and
already the colour of the active tab's underline, so the bar gains a contrast rather than a colour.
It is on every control the bar draws — the switcher, both mode tabs, the tour and Settings, and the
app title where it stands in the switcher's place — and the mode tabs gain a `focus-visible` ring
they did not have at all, which *Tokens, type and glyphs* requires of every variant.

**Two of them take it inset.** A mode tab and the app title are the bar's whole 56px, so the
handoff's 2px outward offset puts their top band above the bar, where the shell's `overflow-hidden`
clips it, and their bottom band on the pane below, where the paper reads **1.06:1** on
`admin-canvas` — a reader would get two vertical lines and no ring. The offset is negative on those
two and outward on the three that sit within the bar's height, so all four edges are always on the
forest and the figure above is the figure everywhere.

The panel's rows keep the pine. They are on the panel's white, where it reads **7.3:1**, and no
lower than 6.45:1 on the two tinted rows — it was never the problem there.

### The bar's ground is a token, and the forest hover is settled

`--color-lab-bar: #16332d` is added. The handoff's token table names the role — *Top bar*,
`#16332d`, "close to `--color-lab-ink` `#173c34`" — and `lab-ink` is kept for the four button
variants and the tour popover that already use it, so the two roles that were one value are now two
names. The bar's hover pill `#21453b` stays a literal: one file draws it, and
`docs/design-direction.md` mints a token with its role and not with its first hex.

`docs/design-direction.md`'s departures table carries a row that says to revisit here: the forest
action's hover, `#22544a` in the handoff and `#215347` in the code. **Rule 5** is what licensed it
— "a value that already is a token" — and it licensed it correctly: `#215347` predates the handoff,
and a refresh is not a reason to repaint every token it happens to touch. What ends the departure
is not that rule 5 has stopped applying but that the table itself said to revisit the row with this
slice, and the revisit finds nothing on the other side of the question: the README's token table
states `#22544a` (**rule 3**) and the prototype draws it and never draws `#215347` (**rule 2**),
which is two authorities agreeing and none for the value in the code. `--color-lab-ink-hover`
becomes `#22544a` and the row leaves the table.

## Deliberately not here

- **A shop logo.** The badge is the shop's initials on `lab-ink` until Slice 28 gives it a logo,
  which is what the plan says and what the payload can supply today.
- **Counts on the rail.** Slice 11.
- **The preference control for where the app opens.** Slice 18, as ADR 0054 left it. The return
  location added here is a *different* preference with a different meaning, and it is written by
  the shell rather than by an operator, so it needs no control and gets none.
- **A stored mode, or a remembered last screen per mode.** The mode is the route (ADR 0054), and
  the return location is one value for the whole workspace rather than one per mode.
- **Anything about a tour's content.** ADR 0049 and ADR 0045 stand entire.
- **A `dialog` for the switcher panel.** It is a menu of destinations, not a surface with work in
  it; the workspace has no modal and this slice does not introduce the first one.
- **Removing `/settings`' own *Back to <shop>* link.** It names one shop and the bar's toggle names
  the screen; they answer different questions and the settings surface keeps its own.

  > Narrowed by PLAN-UX Slice 18 (2026-09-21). Both questions are still asked on that page and
  > neither answer moved; where they are asked did. The header now carries
  > *← Back to workspace*, which reads `agent-lab.settings-return` — this decision's own
  > preference, not a second mechanism — so the page and the bar cannot disagree about what is
  > underneath. The shop link is the *Last-visited shop* row of *Your preferences*, beside the
  > *Forget* that drops it, which is where the prototype draws it.

## Consequences

Sixteen route files lose an import and a mount, and four of them lose a `<>…</>` that existed only
to put two controls where one now is. A route added after this gets its tour by declaring it in
`lib/tours.ts` and nowhere else, which is one step fewer and one place fewer to be wrong.

The tour control's appearance changes: it was a small bordered secondary in a page header and is
now a quiet bar control that fills a pill under the pointer. Its name, its words and what it does
are untouched, so every spec that reaches it by name still does.

A surface whose page failed to load still offers its tour, because the route still names one. That
is the same staleness a page header would have had if it rendered, and it is left rather than
guarded, since the guard would be a second answer to "which surface is this" beside the route.

The bar is now the only place in the workspace that holds a menu with roving focus. Nothing else
needs one yet; when a second does, the keyboard rules belong in a primitive rather than copied.

## Verification

- `AppShell.test.tsx` holds the bar: the tabs' active state per mode and their absence outside one,
  the underline and the inactive ink; the switcher's name, its badge initials, the panel's rows and
  their versions, opening it focusing the current shop, arrows and `Home`/`End` moving focus with
  exactly one row in the tab order, `Escape` closing it and giving the keyboard back to the button
  while an outside press closes it and moves nobody's focus, choosing a shop navigating in shop
  mode and calling the lab's handler in lab mode, and the panel closing on navigation; the bar's
  identity being the switcher, the title outside a mode and the title in a lab with no shops; the
  tour control present on a surface with a tour and absent on one without; and the Settings control
  as a link off `/settings` and as a lit toggle on it that returns to the location the shell
  recorded, to `/shops` when it recorded none, and never overwrites that location while it is
  open. It also holds the focus ring down: the bar's paper on all five controls the bar draws,
  the pine still on the panel's rows, the offset inset on the two controls that are the bar's full
  height and outward on the three that are not, and `Tab` out of the panel closing it onto the
  button.
- `TourLaunch.test.tsx` moves its mount: it renders the control at a route rather than with an
  identifier, sweeps every tour's own route from `TOUR_IDS`, asserts the three comparison tabs and
  the helpdesk's opened ticket all resolve to their surface's tour, and asserts nothing is drawn on
  a route with no tour — and still asserts, as it did, that the control reads nothing at all to
  decide whether to appear.
- `tours.test.ts` asserts the resolution is total and exact: every tour resolves at its own route
  and at every address it declares, a child of a tour's route that is a different surface resolves
  to nothing, and a declared second address is a segment under the route rather than a path of its
  own that could drift away from the surface.
- `tour-anchors.spec.ts` waits for the surface to settle before asking anything of it, and then
  asks both halves: `tourAt` over the address the browser actually landed on, and the control on
  screen. Asserted against the defect it was written for — with the helpdesk's second address
  removed from the table the case fails twice, on the address and on the missing control, and
  passes with it restored.
- `Tickets.test.tsx` asks the same question of the same defect with no browser and no timing in
  it: the page is opened at its index, the redirect is awaited, and the address it actually
  produced is put to `tourAt`. It fails on `null` with the table's second address removed.
- `preferences.test.ts` covers the return location: absent reads as none, a write is read back, and
  a `localStorage` that throws is not a failed render.
- `App.test.tsx`, `AgentConfigurations.test.tsx` and `History.test.tsx` move from the switcher's
  `combobox` to its button and menu. `History.test.tsx`'s distinction between the page's own *Shop*
  filter and the bar's switcher becomes a distinction between a `combobox` and a `button`.
- `workspace-shell.spec.ts` walks the slice's own evidence in a browser: an operator on a product
  catalog switches from Northstar to Alpenglow by name from the bar and is still in shop mode,
  opens the tour of the screen they are now on from the same bar, then opens Settings, reloads it,
  and closes it back onto the product editor they were in — the reload being the case the history
  stack cannot answer, and the editor being the address the slice's evidence names.
  `tour.spec.ts` and `tour-anchors.spec.ts` reach the launch control where it now lives, by the
  name it kept. The whole eleven-spec suite runs: every spec navigates, and every
  navigation lands in this chrome.
- `make check` passes and `pnpm build` runs.

## Migration

None in the database, the contracts or the published versions. One browser key is added,
`agent-lab.settings-return`, and a browser that has never held it returns from Settings to the
shops index. No existing key changes meaning. Every URL resolves to the page it did.
