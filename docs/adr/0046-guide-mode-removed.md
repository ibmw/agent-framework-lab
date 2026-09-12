# ADR 0046 — Guide mode is removed: a switch that hid the help from whoever needed it

Status: accepted — 2026-09-12

Removes guide mode, the lab-wide preference ADR 0044 introduced and ADR 0045 kept. The seven
*Show me around* controls now appear on their surfaces unconditionally.

Records one decision and one concession: that the mode is deleted rather than re-defaulted, and
that with it goes the only way to turn the controls off lab-wide.

## Context

Guide mode was derived rather than stored: on while the lab held no completed comparison, off once
it held one, with only an operator's disagreement written to `localStorage` (ADR 0044). It was a
good shape for the thing it was built for. With the mode on, three things **drew themselves on
screen without being asked**: a next-step band across the top of the shop home and the shops index,
and an explainer note under the header of six surfaces. An operator who did not want them needed a
way to say so, and saying it once for all of them — rather than seven times, or once per screen —
is what kept the guide one thing.

ADR 0045 replaced every one of those readings with a tour: an overlay launched from a control in
the page header, which does nothing at all until somebody presses it. It then asked whether the
preference still earned its keep, and answered yes, on two grounds — that one preference keeps the
guide one thing, and that the derived half still carried a reading worth having, because a lab with
no completed comparison is a lab somebody is still learning. Both arguments were about the mode.
Nobody checked what the mode was now *doing*.

What it was doing, on a real machine:

The product owner opened the lab and could not find the guide. Their database holds the run
`make seed` writes — a completed two-arm comparison, because a finished example is the entire point
of the seed — so `GET /api/v1/experiments?status=completed&page_size=1` answered with a row, guide
mode derived to **off**, and every *Show me around* control was hidden on every surface. The one
control that turns it back on lives on `/settings`, in the Workspace card, because the band used to
carry that control too and was deleted with the band.

So the derived default, read through the new shape, says: *the moment this lab contains a finished
example, take the help away.* Anybody who runs `make seed` — the path `/guides/setup` itself
recommends at the top of the page — lands in a populated lab with the guide silently switched off,
and the switch that reveals it is behind a page they have to already know about to find. The reading
"a lab with a completed comparison is a lab whose operator has learned this product" was defensible
for a band that interrupted the page. It is false for a button, and it is exactly backwards for a
seeded lab, where the completed comparison proves nothing about the reader at all.

That is not a bad default in need of a better one. A default cannot be got right here, because the
mode is answering a question nobody is asking any more: *may the guide put something on my screen?*
Nothing puts anything on anybody's screen. Guide mode is a leftover of the shape ADR 0045 removed.

## Decision

### The mode is deleted, and the control is unconditional

`lib/guide.ts`, `components/GuideModeChoices.tsx`, the `readGuideModeOverride` /
`writeGuideModeOverride` accessors and the `agent-lab.guide-mode` key are removed, and so is the
Workspace card's guide-mode control on `/settings`. `TourLaunch` reads nothing and renders its
button on every surface that declares a tour, on the first frame and every frame after it.

Re-defaulting was the alternative, and it was rejected. Deriving the mode from something else — a
first visit, a count of tours already run, the age of the database — replaces one wrong reading with
another and keeps the machinery that produced it, including the request each surface spent to decide
whether to draw a button. Defaulting it to on and leaving the three choices keeps a preference whose
only remaining function is to be discovered, before it can be used, by somebody who by hypothesis
has not yet found the button it hides. A switch that is only reachable by people who do not need it
is not a setting; it is a way for the product to be wrong quietly.

What the mode protected is worth naming precisely, because it is what makes deleting it safe. Its
job was to stop the guide **appearing**. A header button is not an appearance in that sense: it
occupies one chip-sized slot the header component already lays out — beside *Save draft*, *Publish*,
*Results*, *Replay* — it obscures nothing, it interrupts nothing, and pressing it is the only thing
that costs the reader anything. The two surviving browser preferences, the rail's default collapsed
state and the last-visited shop, are untouched: they are about where a viewer was and how their
window starts, not about whether the product may speak.

The consequence is that **there is now no way to turn the controls off lab-wide**, and that is
recorded here as a cost rather than described as a simplification. An operator who has walked every
tour and wants the seven buttons gone cannot have that. What makes it acceptable is the size of what
they are refusing: seven buttons that do nothing, in a slot that was already carrying buttons. If
that ever stops being true — if a tour starts on its own, if something is remembered about where a
reader got to, if the guide grows a shape that survives being dismissed — this reasoning stops
applying, and the thing to restore is a preference over *that*, not this one.

### The stale key is left where it is

Browsers belonging to anybody who used the gated build still hold `agent-lab.guide-mode`. It is
left there, unread.

Clearing it once on read would mean keeping a reader for the key whose reader is being deleted: a
module that exists only to erase a string from other people's browsers, which is a migration
mechanism for a browser preference, and this repository does not build those (ADR 0044 put these
values in `localStorage` precisely so that no migration would ever be owed for them). The cost of
leaving it is one unread string per browser, which no code path can consult and which the browser
discards with the rest of the site's data whenever the reader clears it. The cost of clearing it is
a permanent line of code. A test asserts the key cannot reach the control in either direction, so
"unread" is a claim the suite makes rather than one the reader takes on trust.

## Deliberately not here

- **A replacement preference, under any other name or default.** Including a first-visit default, a
  per-surface dismissal, or a "you've seen this one" counter. Each is the stored shape ADR 0044
  refused, bought back for a button.
- **A migration, or any code that touches the old key.**
- **Any change to what the tours are, where they are, what they say, or how they are swept.** The
  table in `apps/web/src/lib/tours.ts`, the anchor sweep, the glossary and the `.lab-tour` skin are
  untouched; the only difference is that the control that starts them is always there.
- **Restoring the derived next-step reading.** It was deleted by ADR 0045 and that ADR records the
  cost; nothing here revisits it.
- **A settings surface with nothing writable on it.** The Workspace card keeps the rail preference
  and the last-visited shop, which are what it was for besides this.

## Verification

- The launch control is asserted present on **every** surface in `TOURS`, parameterized off the
  table rather than off a list somebody maintains, so a tour added tomorrow is covered tomorrow.
- The negative case ADR 0045 asserted — that a stored `off` cost the application zero requests — is
  kept in the form that is still true and still worth protecting: mounting a launch control makes no
  request at all. What bites is the assertion over msw's `request:start`, which is emitted before
  any handler or unhandled-request strategy is consulted, so a reader that swallowed its own
  rejection — as the removed `useGuideMode` did — still fails. The suite is registered with **no**
  handlers besides, so the failure cannot be made to go away by adding one.
- A browser holding `agent-lab.guide-mode` as `off` is asserted to get the control anyway, which is
  the claim that the old key is genuinely unread.
- One suite carried an absent-when-off half, and it is the one that is converted: the block
  libraries asserted the control present on both, then stored `off` and asserted it gone. The
  stored half is dropped and the presence assertions stay. The scenario editor, the starting
  states, the bench and the results asserted presence only, with the mode named in the test title
  and served by a handler; those keep the assertion and lose the title and the handler. The
  block-library case keeps its other half, which was never about the mode: every anchor that tour
  lights resolves to exactly one element on the page.
- The preference module's tests keep the storage-refusal case they carried for guide mode, now made
  over the two preferences that remain: a browser that throws on `localStorage` gets the derived
  default rather than a failed render.
- The two Playwright specs stop seeding `agent-lab.guide-mode` into the browser before they run,
  and are otherwise unchanged. That removes an arrangement rather than adding a proof: the lab the
  sweep builds starts an experiment and never completes one, and whether the shared database holds
  a completed comparison at that moment depends on which worker ran first. The seeded case — a lab
  that does hold one — is proved deterministically by the unit suite above, not by the sweep.
- `make check` passes, `pnpm build` runs for the frontend change, and `pnpm test:e2e` runs because
  both tour specs change.

## Migration

None. One deleted module, one deleted component, two deleted preference accessors, and one control
removed from `/settings`. No table, column, canonical document, fingerprint, tool contract,
published-version semantics or HTTP contract changes. A browser that stored `on` or `off` keeps the
string and nothing reads it; either way it sees the same controls as a browser that never stored
anything.
