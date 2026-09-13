# ADR 0049 — The written guides retire: the chain lives on the surfaces it names

Status: accepted — 2026-09-13

Removes the Guides header entry, the `/guides` index, and the written setup guide at
`/guides/setup`. The glossary moves to `/glossary` as a destination for term links rather than a
section of its own.

Records one decision and one concession: that a section whose contents already live on settings
and on each view is deleted rather than kept as an index of what it used to hold, and that with
it goes the last page that walked all ten steps of the chain in one place.

## Context

ADR 0044 put the guides beside lab settings at `/guides`, on the same footing: a new operator has
no shop, so help that lived only inside one would become reachable one step after the step it
existed to explain. That placement was right for a written walkthrough. What the section then
held was two pages — the setup guide, and the glossary — and an index that named them.

Three later decisions emptied it.

ADR 0047 put the fast path on `/settings` as *Create the demo*, inheriting the emptiness refusal
that made the seed safe. ADR 0048 put every step of the chain on the surface it names, as the
opening step of that surface's *Show me around* tour, composed from `SETUP_CHAIN` and
`SETUP_GUIDE_STEPS` so the answer a popover gives is the table's own gate sentence. ADR 0045 had
already replaced the inline explainers with those tours, and ADR 0046 made the launch control
unconditional.

What remained of Guides was an index of two pages whose contents now live elsewhere, plus a
glossary that is a destination for a hovered word rather than a section an operator opens from
the header. The setup guide still walked the ten steps in dependency order, but it walked them
with nothing the tours did not already say on the screens those steps name, and with a fast-path
card that pointed at a button two clicks away.

## Decision

### The section is deleted

The header carries **Settings** only. `GuidesPage` and `SetupGuidePage` are removed.
`/guides` and `/guides/setup` redirect to `/settings`, which is where the fast path actually
runs. `/guides/glossary` redirects to `/glossary`, keeping the hash so a bookmark to a term
still lands on it.

The rejected alternative was keeping the index as a table of contents for the tours. An index
that says "the help is on the screen you are already on" is a section that exists to send the
reader away from itself. The header slot it occupied is the same slot Settings uses; leaving
both implied two kinds of help, one of which had already moved.

### The glossary is a destination, not a section

`/glossary` still renders the one module that defines a term. Tour popovers keep linking there,
and the hover definition is still the link's own `title`, which is ADR 0044's one-definition
rule unchanged. There is no header entry for it. A reader reaches it by following a word, which
is the way in GuideProse already promised for someone with no pointer or someone who wants the
rest of the vocabulary.

Putting the glossary on `/settings` was considered and refused. Settings reports composition —
what this build can run, how it is composed to run it, what this browser remembers — and a
definition list of the lab's vocabulary is not a fact about the build. Folding it in would have
made the one lab-level page longer without making the terms easier to find than following one
from a popover.

### The tables stay; the page that listed them does not

`SETUP_CHAIN` and `SETUP_GUIDE_STEPS` are untouched. They are what a tour composes from, what
the anchor sweep reaches by, and what the copy tests hold. The `body` paragraphs are no longer
rendered on a page; they remain the one copy of what each step is, so a term in them still fails
the suite if it resolves to nothing, and a second sentence about the same step is still a second
thing to keep in agreement.

`stepHref` stays for the same reason: the sweep still has to land on the surface a step names.

## Deliberately not here

- **Putting the ten steps onto settings.** Settings reports the build. Walking the authoring
  chain is what each surface's tour already does.
- **A glossary entry in the header.** It is a destination for a word, not a section.
- **Deleting `SETUP_GUIDE_STEPS.body`.** The suite still holds those sentences; unread by a
  page is not the same as untested.
- **A tour of the glossary, or of settings.** ADR 0048's refusal stands: they are not links of
  the chain, and a tour on each would exist to not be missing.
- **Restoring a page that lists all ten steps.** The cost below is accepted.

## Consequences

Nothing in the application now walks the ten steps in one place. An operator who wants the whole
chain in order stands on each surface and asks to be shown around, or reads the table. That is
the same shape of loss ADR 0045 recorded when the derived strip went: the reading survives in
the build and leaves the screen. It is recorded here as a cost rather than dressed up as a
simplification.

`/settings` and `/glossary` remain the lab-level surfaces outside the eighteen-frame set. The
last-visited shop is still what they offer a way back to.

## Verification

- The header is asserted to reach Settings and not to reach Guides, inside a shop and outside
  one.
- `/guides` and `/guides/setup` are asserted to land on lab settings; `/guides/glossary` is
  asserted to land on the glossary, so a bookmark written against the old namespace still
  resolves.
- The glossary is asserted to render the module at `/glossary` and to offer no way back to a
  section that is gone.
- The tour journey asserts a defined word links to `/glossary#…`, which is the one-definition
  rule with the new path.
- The setup guide's own suite is deleted with the page. What it was protecting — that the chain
  table and the surfaces it names cannot disagree — is already held by `tours.test.ts` and the
  anchor sweep.
- `make check` passes, `pnpm build` runs for the frontend change, and `pnpm test:e2e` runs the
  tour journey because the glossary href it asserts changes.

## Migration

None that a database or a contract would notice. Three retired routes redirect. A browser that
bookmarked `/guides/setup` opens settings; a browser that bookmarked `/guides/glossary#shop`
opens the same term at `/glossary#shop`.
