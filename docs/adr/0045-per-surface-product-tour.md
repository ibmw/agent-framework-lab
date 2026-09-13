# ADR 0045 — A tour of the screen you are on, and what the derived strip took with it

Status: accepted, partially superseded by ADR 0046 — 2026-09-12

Reopens Milestone 7 after it closed. It replaces both of the guide's on-screen readings — the
derived next-step strip of Slice 2 and the six inline explainer bands of Slice 3 — with a stepped
product tour, an overlay that dims the surface, highlights one element at a time and explains it in
a popover beside it. It partly reverses ADR 0044, which rejected exactly that.

Records five decisions: that coach marks are adopted and the one clause of ADR 0044's refusal that
was correct is answered by a test rather than argued away, that a tour is per-surface and launched
on demand rather than a walkthrough spanning routes, that the loss of the derived strip is a
deliberate cost and not a benefit, that the overlay is a dependency rather than a component this
repository writes, and that guide mode stays as the one preference gating what the guide shows.

ADR 0046 voids the last of those five. Guide mode is removed and the *Show me around* controls are
unconditional: the reasoning below asked whether a preference still earned its keep once nothing
appeared unbidden and answered yes, without checking what the mode had become in practice — which
was a switch that hid the guide from any lab holding a completed comparison, including every lab
filled by `make seed`. The other four decisions are untouched, and so is everything about the tours
themselves. The narrowing notes below mark what ADR 0046 reaches.

## Context

ADR 0044 gave the operator three things: a band at the top of the shop home and the shops index
naming the one step that unblocks the chain, a note below the header on the six surfaces whose
vocabulary is not transferable from a commerce admin, and a glossary the two of them referenced.
Slices 2 and 3 built them, and Milestone 7 closed.

The product owner has read the result and asked for something else: a **product tour** in the style
of `driver.js` — the surface dims, one element is cut out of the overlay and lit, and a popover
beside it says what that element is, with *Back*, *Next* and a step count. That request is not a
refinement of the band. It is the thing ADR 0044 refused, and the refusal was written down:

> What it is not is an overlay tour. Coach marks that highlight a control and advance to the next
> one were rejected: they pin the guide to the exact geometry of surfaces that are still being
> designed, they go stale silently when a control moves, and staleness in a tour is invisible to
> every test this project runs. A derived strip cannot go stale in that way, because the thing it
> reads is the record.

Three claims, and they are not equally strong.

The first — that a tour pins the guide to surfaces still being designed — is a cost, not an
argument. Every UI-bearing slice of this milestone pins something to a surface; the explainer band
was mounted on six of them by hand and would have had to move with any of them.

The second and third are one claim, and it is the real one: a note that sits under a page header
cannot be wrong about *where* anything is, because it points at nothing. A tour that highlights
`the publish card` is a claim about the page, and when the publish card is renamed, moved into a
tab, or folded into a header menu, the tour goes on running with a popover pinned to nothing or,
worse, pinned to whatever now matches. Nothing in this repository would fail. That is a true
statement about the suite as it stood when ADR 0044 was written.

It is not a true statement about what this repository is *able* to check. ADR 0023 met the same
shape of problem on the backend — a set of invariants that held for the tools somebody remembered
to list — and answered it by parameterizing the sweep over the contract registry itself, so that
"the eleventh tool is conformant on the day someone remembers it" stopped being the failure mode.
A tour has a registry too, if it is written as one.

## Decision

### Coach marks are adopted, and the staleness clause is answered rather than argued away

The product owner has overruled the first clause, and this ADR does not relitigate it. The second
and third clauses stand exactly as written: a tour *does* go stale when a control moves, and
staleness in a tour *was* invisible to every test this project ran. What changes is the last word.

Every tour in the application is declared in one table, `apps/web/src/lib/tours.ts`: surface
identifier to an ordered list of steps, each step carrying the selector of the element it
highlights, its title, and its body. That table is the only place a tour is written down. The
runtime reads it, the unit tests read it, and — the part that answers the objection — a Playwright
**anchor sweep** reads it.

The sweep builds the chain once through the public API, then, for every surface in the table and
every step in that surface's tour, navigates to the surface and asserts the step's anchor resolves
to exactly one visible element. A control that is renamed, moved, hidden behind a tab, or rendered
twice fails the sweep, naming the surface and the step. A step declared today joins the sweep today:
nobody adds it to a list, because there is no list — the sweep's cases *are* the table's rows. The
one way a parameterized sweep can stop proving anything is by becoming empty, so, as ADR 0023 does,
it asserts it has cases and that no tour has zero steps.

The surface-to-route half of the sweep is deliberately in the test and not in the table.
`apps/web/src/lib/tours.ts` says what a tour is; `tests/e2e/tour-anchors.spec.ts` says where that
surface lives and what state it needs, keyed exhaustively by the tour identifier, so a tour declared
without a route fails to compile rather than being silently swept over. That is the same split
ADR 0023 made when it kept one valid call per published tool in the test factories and asserted the
table's keys are exactly the published set.

Anchors prefer the name the page already has. Where an element is already a landmark or a card with
an accessible name — `nav[aria-label="Shop workspace"]`, `[aria-label="Publish"]`,
`[aria-label="Customer composer"]` — that name is the anchor, and renaming it is a visible change
that fails the sweep on purpose. Where the thing worth pointing at has no name of its own — a bare
table section, the grid of two arm summaries, the provenance chip strip — an explicit `data-tour`
hook is added at the mount site. No anchor is a positional DOM path.

### One tour per surface, launched on demand

There is no first-run tour, no tour that starts unbidden, and no tour that spans routes. Each
surface that has a tour carries a **Show me around** control in its own `PageHeader` actions, and
the tour it runs covers that one screen.

A walkthrough spanning routes was rejected for three reasons. It would have to drive navigation
itself, which makes the guide an actor on the application rather than a reader of it — the same line
ADR 0044 drew when it decided the strip links to the surface where the work is done and never
performs the work, and ADR 0043 drew when it decided the seed is a command and never a route. It
would have to hold its position across a route change, which is stored progress, which is the second
shape ADR 0044's whole argument exists to refuse. And it would fail worst exactly where the chain
refuses: a walkthrough that reaches the scenario editor's step in a lab with no published ticket has
no scenario editor to stand on, so it would need the derived readiness reading it is replacing in
order to know whether its next step exists at all.

A per-surface tour needs none of that. It is launched by somebody who is already standing on the
surface, which is the proof that the surface exists, and it ends where it started.

### The derived strip is removed, and something goes with it

`deriveSetupPath`, the ten listing reads behind it, and the band that rendered them are deleted.
What that removes from the product is not only a component:

**Nothing in the application now tells an operator returning to a half-built lab what is still
missing.** The strip read ten listings the product already serves and named the first step nothing
satisfied — with the publish gate's own finding underneath when a gate was refusing — for a lab
filled by hand, filled in a different order, or filled by `make seed`, with nothing stored. A tour
cannot do that. A tour of the scenario editor explains the scenario editor; it does not know that
this lab has no published ticket, and it is launched from a screen the operator had to find first.
The written setup guide at `/guides/setup` still walks the chain in dependency order, but it walks
it with nothing to decorate it with: it says what the ten steps are, not which of them this lab has
already satisfied.

That is a loss, it is the product owner's deliberate choice, and it is recorded here as a cost
rather than dressed up as a simplification. The reading was the more novel half of Milestone 7 — it
was projected rather than stored, which is a property this project spent three ADRs earning — and it
is the half being given up. If it is wanted back, the thing to restore is the projection, not the
band: `deriveSetupPath` was a pure function over listings, and its tests recorded exactly what it
claimed.

What survives the removal, and stays: `SETUP_CHAIN`, still walked by the written setup guide;
`/guides/setup` and `/guides/glossary`; the glossary module and its one-definition rule; `/settings`
and every read-out on it.

### `driver.js`, pinned, and skinned rather than shipped as it comes

The overlay is `driver.js` 1.8.0, pinned exactly in `apps/web/package.json` the way every other
dependency in this repository is pinned. It is MIT, it has no transitive dependencies, and it is
about 25 KB of runtime and 3 KB of stylesheet — roughly 7 KB and 1 KB gzipped.

Hand-rolling it was considered and refused. What a coach mark actually needs is an SVG overlay with
a hole cut in it that tracks an element through scroll and resize, a popover placed on whichever
side has room, focus moved into that popover and kept there, Escape and arrow keys bound, and the
whole thing torn down without leaving the document scroll-locked. That is a layout engine, and
ADR 0044's reasoning about the glossary's hover definitions applies unchanged: this work is not
entitled to invent a positioning rule for this application, and a positioning rule is exactly what
it would have to invent.

The library ships a skin, and the skin is not used. `driver.js/dist/driver.css` is imported for its
structure, and one `.lab-tour` block in `apps/web/src/styles.css` restates the popover, its arrow,
its buttons and its progress text in the tokens `docs/design-direction.md` already fixes — pine ink
on paper, the admin border, the accent on the forward button, the Georgia display face on the title.
No token is added. The overlay colour is the lab's own pine rather than the library's black.

The tour's popovers are React, not HTML strings: each step's body is rendered by `GuideProse`, into
a container the tour hands to the popover, so the `[[term-id]]` copy this application already writes
renders inside a tour popover exactly as it rendered inside an explainer — the word is a link to its
entry in the glossary and the hover definition is the element's own `title`, which is ADR 0044's
decision and is unchanged. There is one renderer of guide copy and one module that defines a term.

### Guide mode stays, and now gates the launch control

> Voided by ADR 0046 (2026-09-12). The mode is removed and the launch controls are unconditional.
> Both arguments below are about the mode rather than about what it was now gating. The first —
> that one preference keeps the guide one thing rather than seven — was answering a question
> nothing asks of a header button: seven buttons that do nothing until pressed are not seven things
> an operator has to manage. The second — that a lab with no completed comparison is a lab somebody
> is still learning — is the one that failed on a real machine: `make seed` writes a completed
> comparison, so the derived default took the guide away from every operator who followed the
> setup guide's own fast path, and the switch that brings it back was itself on a page they had to
> already know about. The refusal of a second mode, a second store and a per-tour dismissal stands
> and is inherited by ADR 0046: none of the three is added in place of what is removed.

Guide mode is unchanged: derived on while the lab holds no completed experiment, off once it does,
with only an operator's disagreement stored, offered as the same three choices on `/settings`. What
it now decides is whether the **Show me around** controls are shown at all.

It was worth asking whether a preference still earns its keep once nothing appears unbidden, and the
answer is that it does, for two reasons. It is what keeps the guide one thing rather than seven: an
operator who does not want the guide says so once and the controls leave every surface together,
which is the property the explainer band had and a per-screen dismissal would not. And its derived
half still carries a reading worth having — a lab that has never produced a completed comparison is
a lab somebody is still learning, and the control appearing there without anybody turning it on is
the last piece of "the default is read from the record" this milestone still has. A second mode, a
second store, or a per-tour "don't show me this again" would each be the stored second shape
ADR 0044 refused, and none is added.

### Seven surfaces, and no new route

> Extended by ADR 0048 (2026-09-13). Fourteen surfaces now, because every one of the chain's ten
> steps offers a tour. Seven of those ten had nothing to launch, and what they now open with is a
> *composed* step — its position in the chain, its neighbours, and the gate sentence
> `/guides/setup` already holds for it — so the reach is bought without seven more pieces of copy
> to keep true. The paragraph below about the shops index still stands: it is not on the chain.

The tours are on the six surfaces that had an explainer — the objective-block library, the
mutation-block library, the scenario composition editor, the starting-states listing, the live bench
and the results screen — plus the shop home, which had the strip instead. Seven tours, seventeen
steps.

The shops index gets none. It hosted the strip because it is where an operator with no shop is
standing, and what it has to say there is "create a shop", which is the chain's reading and not a
tour of a page with one table and one form on it. The written setup guide says it, in dependency
order, and the shop-creation form is on the surface already.

No backend route is added or changed. A tour is copy about a screen and a selector into it; there is
nothing for the API to serve, and a tour that needed a route would be a tour that had started
reading the record, which is the thing being removed rather than relocated.

## Deliberately not here

- **A first-run tour, an auto-start, or a "new here?" prompt.** Every tour is launched by somebody
  who asked for it.
- **A tour that spans routes**, and with it any stored position, step counter, or completion flag.
  All three are the stored second shape ADR 0044 refused, and this slice adds none of them.
- **A "don't show this again" per tour.** Guide mode is the one preference; seven of them would be
  seven things to keep in agreement. *(ADR 0046 removes guide mode too; the refusal of the seven
  stands, and nothing replaces the one.)*
- **Any control inside a popover that performs the work it describes.** A tour points at the control
  and the reader clicks it. ADR 0043's refusal and ADR 0044's reading of it are unchanged: the guide
  gains no privilege over the chain.
- **Tours on the shops index, the shop-setup pages, the order and ticket editors, the experiment
  setup, or the history listing.** Their vocabulary is transferable from a commerce admin, which is
  ADR 0044's test and is not weakened by the change of shape.
- **Restoring the derived reading in another form.** It is removed, and the removal is the point of
  the request rather than an accident of it.
- **The library's own skin, its hint API, and its animation timings.** The one animation decision
  taken is that motion is off when the reader has asked for it to be: the library tweens its
  cut-out from JavaScript, so `styles.css`'s global reduced-motion rule cannot reach it and the
  preference is read in the component instead.

## Verification

- The anchor sweep is the milestone claim of this slice. It builds a shop, a customer, an order, a
  ticket, both block libraries, a published scenario, a support identity, two published agent
  configurations and one started experiment through the public API, then walks `TOURS` and asserts
  every step of every tour resolves to exactly one visible element on its own surface. It asserts it
  has cases, and that no tour is empty, because a parameterized sweep that became empty would report
  as passing.
- The sweep's surface table is keyed exhaustively by the tour identifier, so a tour added to
  `TOURS` and not given a route fails to compile.
- The sweep is one case per surface — `for (const id of TOUR_IDS) test(…)`, so a rename that
  loosens two surfaces reports both — over a worker-scoped fixture that builds the chain once, with
  the file pinned to one worker so "once per worker" stays once. Within a case the two assertions
  per step are soft, so one surface reports every step that has come loose rather than only its
  first. The `for` loop declares nothing when the table is empty, so the non-empty guard is a case
  of its own rather than a line inside one.
- Building that chain is a second heavy writer against the one API process and the one SQLite file
  the Playwright suite shares, and it made the paired-experiment journey — the suite's other heavy
  writer, which publishes nine definitions, starts an experiment, drives both arms and scores a
  judge — fail intermittently on assertions that were correct but slow. The wait is lengthened in
  `experiment-start.spec.ts` alone, by configuring that file's `expect`; no assertion anywhere is
  relaxed, removed or narrowed, and no other spec's patience changes. It is deliberately not a fix
  for a write that queues past SQLite's own five-second busy timeout: that surfaces as a refused
  request and a wrong page, which no wait repairs. `docs/PLAN.md` carries the `busy_timeout`/WAL
  question as a deferred trigger; this slice does not touch the engine.
- Reduced motion is read rather than declared: the library tweens its cut-out from JavaScript,
  where `styles.css`'s global rule cannot reach it, so `animate` is set from
  `prefers-reduced-motion` and the journey asserts the page carries the un-animated class under an
  emulated preference.
- Focus is asserted on the way out as well as on the way in — a tour dismissed after stepping puts
  the reader back on the control they launched it from, which is not what the library does on its
  own.
- The table's integrity is a unit concern: every step has a non-empty title and a non-empty body,
  every anchor is unique within its tour's surface, and every `[[term-id]]` in every body resolves
  to a definition — the same assertion the explainers carried, over the copy that replaced them.
- The launch control is asserted present while guide mode is on and absent when it is off, and
  asserted to read nothing at all when an operator has stored the disagreement, so a build that
  spent a request to decide not to show a button fails. *(Narrowed by ADR 0046: the mode is gone,
  so the control is asserted present on every surface in `TOURS` and the request assertion becomes
  unconditional — mounting a launch control makes no request at all.)*
- One Playwright journey runs a tour end to end: launch, the first step's popover naming the first
  step, forward, back, focus inside the dialog, Escape dismissing it, and the overlay gone
  afterwards. What `driver.js` promises about focus and keys is asserted rather than assumed.
- The tests that existed only for the strip and the band are removed with them. The setup guide's
  assertions — that it names `make seed` as a command, exposes no control that performs it, and
  walks `SETUP_CHAIN` rather than a second list — are kept unchanged.
- `make check` passes, `pnpm build` runs for the frontend change, and `pnpm test:e2e` runs because
  the journey the removed band appeared in is replaced.

## Migration

None. One frontend dependency, one deleted component pair, and one deleted projection. No table,
column, canonical document, fingerprint, tool contract, published-version semantics or HTTP contract
changes, and the only stored preference involved is the guide-mode override this slice does not
touch. A browser that stored `off` before this change still reads as `off` after it, and what it
hides is now the launch controls rather than the band.

> Narrowed by ADR 0046 (2026-09-12). That last sentence is what went wrong, and it stops being true
> there: the override is removed, the key is left in the browsers that hold it and read by nothing,
> and a browser that stored `off` now sees the same controls as one that stored nothing.
