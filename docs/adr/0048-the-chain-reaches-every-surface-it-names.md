# ADR 0048 — The setup chain reaches the surfaces it names, as a composed tour step

Status: accepted, partially superseded by ADR 0049 — 2026-09-13

Extends ADR 0045's per-surface tour to all ten steps of the setup chain, and gives every one of
those surfaces an opening step that is composed from `setupPath.ts` rather than written down.

Records one decision and one concession: that the chain's reading belongs on the surfaces it
names and not only on the page that lists them, and that seven of those surfaces now offer a tour
with exactly one step in it.

## Context

`/guides/setup` walks ten steps in dependency order and says, for each, what stays refused until
it is satisfied. It is the only place that reading exists. An operator standing on the customers
screen — the second link of ten — has no way to ask where they are without leaving for the guide
and finding the step again.

> Narrowed by ADR 0049 (2026-09-13). That page is gone. The reading this slice put on each
> surface is now the only reading; the table it composes from stays, and nothing lists all ten
> steps in one place.

Meanwhile ADR 0045 put a tour on seven surfaces, chosen because they were the seven that had
carried an explainer or the strip. That set was drawn from what the *previous* shape happened to
cover, not from the chain. The overlap is three: the shop home, the objective-block library and
the bench. Seven chain surfaces had no tour at all — customers, orders, tickets, the scenario
listing, support identities, agent configurations and judges — which are seven of the ten screens
where somebody is most likely to be lost, because they are where the work is done in order.

## Decision

**Every step of the chain offers a tour, and opens on its place in it.** Twenty surfaces have a
launch control. The tenth step is `/bench` — the page an experiment is *started* on — and
not the live bench it is watched on, which a reader reaches only by starting one; a chain step
there would answer a question after it had stopped being asked. The live bench keeps its own walk
and carries no chain step. The ten on the chain open with a step titled `Step N of 10 · Label`, which
says which neighbours the chain puts either side and then gives that step's gate.

**That step is composed, not written.** `chainPlacement` reads the position and the labels from
`SETUP_CHAIN` and the gate sentence from `SETUP_GUIDE_STEPS`, the table the written guide already
renders. So the answer a popover gives is the answer `/guides/setup` gives, and there is no second
copy to drift. Writing it per surface would have been ten chances to phrase one fact differently
and ten places to leave it stale.

> Narrowed by ADR 0049 (2026-09-13). The page is gone; the answer a popover gives is the answer
> `SETUP_GUIDE_STEPS` gives. The "no second copy" claim is stronger rather than weaker: there
> is no page left that could phrase the gate differently.

**Only the step's own gate is used.** `gate` is what a step unlocks, not what the next one needs,
and on most of the chain those are different sentences — the shop's gate is about publishing a
ticket, three links further down. Pairing each step with its predecessor's gate would have read
fluently and been wrong nearly everywhere.

**The anchor is still declared and still swept.** A tour's `chain` names the element its composed
step lights, so every element any tour points at is in the table and under
`tests/e2e/tour-anchors.spec.ts`. What is composed is the copy, never the selector. The anchor is
`[data-tour="page-name"]` on all ten: the page's own name is the element every surface has, and
the step is about where the reader has arrived.

**Seven surfaces have a one-step tour, and that is the honest size of it.** They have nothing
written about their own controls, and inventing some to make the control look better used would be
copy written to fill a tour rather than to be read. Where a surface later earns a walk of its own,
those steps go after the chain step, which is what the three overlapping surfaces already do.

**`SETUP_GUIDE_STEPS` moves to `lib/setupPath.ts`.** It was exported from the route that rendered
it, which was already odd enough that the tour tests imported a page module to read it. It is now
beside the chain it describes, and the guide page imports it like everything else.

## Deliberately not here

- **A tour on every route.** Settings, the glossary, the guides, the shop version reader and the
  per-item editors are not links of the chain, and a tour on each would exist to not be missing.

  *The guides are gone (ADR 0049). Settings and the glossary still have none, for the same
  reason: they are not links of the chain.*
  The chain is what this decision extends; it is not an argument for coverage as such.

  *Amended: the catalog and the four shop-setup pages did get one. They are not links of the
  chain and they carry no chain step, but they are where the first link's work is actually done —
  a shop is published from those five screens and the home the step names — so a reader sent to
  step 1 does most of it somewhere the step could not reach. The per-item editors still have
  none: you arrive at those from a list that has just explained itself.*
- **Stored progress, or a tour that knows which steps this lab has done.** ADR 0044 refused a
  stored second shape and ADR 0045 kept refusing it. A composed step reads two tables in the
  build, never the record, so nothing here can go stale against a lab's contents.
- **A walk that crosses surfaces.** ADR 0045's reason stands: carrying a position across a route
  is the stored progress above, wearing a different hat.
- **Generated copy for the surface's own controls.** The chain step is composed because the chain
  is a table. What a screen's controls are is not, and a sentence about a control is worth writing
  by hand or not having.

## Consequences

- `tsconfig.node.json` gains `setupPath.ts` and `glossary.ts`, because the anchor sweep reads the
  tour table and the tour table now reads the chain.
- `tour.spec.ts` asserts the glossary link on the second step of the shop-home tour rather than
  the first, the first now being the composed step, which names no vocabulary. Its last section
  steps onto the rail before leaving the surface, because the opening step's cut-out is the page
  name and everything else is genuinely unclickable.

## Verification

- `tours.test.ts` asserts the ten chain steps are claimed by exactly one surface each, that every
  chain surface opens on its placement, that the body carries the guide's own gate sentence, that
  the ends of the chain name no neighbour they do not have, and that a surface with nothing of its
  own walks one step. The copy tests it already ran — glossary terms resolve, definitions are not
  restated — now read the composed step too, because every reader of the table goes through
  `tourSteps`.
- `tour-anchors.spec.ts` sweeps all fourteen surfaces, composed steps included.
