# ADR 0058 — A relative timestamp needs a clock, and an authored instant has none

Status: accepted — 2026-09-21

Settles the one preference in the settings zones that reaches every screen: how a timestamp is
written. It is the fifth browser preference (ADR 0044, ADR 0054, ADR 0055), and the first that
any surface other than the shell reads.

Records three decisions. That the preference's two readings are the prototype's, defaulting to
relative, and that *absolute* means the string this workspace has always drawn. That a relative
reading is relative to *now*, so it is offered only for the instants the lab's own clock wrote,
and an instant an author typed into a fixture keeps its date whatever the preference says. And
that *Reset to defaults* returns the preferences an operator chose and touches nothing the shell
recorded.

## Context

`formatTimestamp` in `lib/ui.ts` is one function with twenty call sites across seventeen route
modules, and it has always answered the same way: `toLocaleString("en-GB", …)`, which renders
a date and a clock — `19 Sept 2026, 14:07`. Nothing in the application has ever offered a second reading.

The prototype's settings page proposes seven browser preferences. `docs/design-direction.md`,
*Proposals, not decisions*, keeps two of them: where the app opens, whose reader ADR 0054 already
shipped, and the timestamp format, which has no reader at all. A preference no surface reads is
half a slice, so this one lands with its consumers or not at all — and its consumers are every
listing in the workspace.

The prototype states both readings in the hint under the row, and states which is the default by
selecting it: **relative**, "Shown as 12 minutes ago. Easier to read a fresh run with", against
"Shown as 19 Sep 2026, 14:07. Easier to quote in a report with". So the preference is drawn as a
trade between reading a fresh run and quoting an old one, and the prototype takes the first side.

Two things in this repository complicate the reach of that.

The first is that not every instant on screen belongs to the same clock. A definition's
`updated_at`, an experiment's `created_at`, a published version's `published_at`, a snapshot's
`created_at` and an annotation's `created_at` are all written by the lab at the moment the thing
happened. An order's `placed_at` and a frozen shipping address's `selected_at` are not: they are
fields of the order's canonical document, typed by whoever authored the fixture, describing an
instant inside the fiction. `docs/PLAN-UX.md` Slice 15 already ruled on exactly this class of
field, and `docs/design-direction.md` records the ruling: a ticket's `opened_at` "is an instant in
the fiction rather than in this workspace, so neither sentence has a clock that means it".

The second is that `formatTimestamp` is a plain function called during render, not a hook. Making
it read a preference makes it impure, and the question of how the value reaches it — argument,
context, module read — has to be answered once rather than per caller.

## Decision

### The two readings are the prototype's, and relative is the default

`agent-lab.timestamp-format` holds `relative` or `absolute`, in `localStorage`, guarded the way
every accessor in `lib/preferences.ts` is guarded, with anything unrecognised reading as the
default. It is a browser preference and never a row, for the reasons ADR 0044 gave and ADR 0052
re-stated: this is how one viewer likes to read, not a fact about the installation.

**Absolute is exactly what the workspace already draws** — the `en-GB` locale with a short
month, a numeric year and a two-digit clock, in the reader's own zone, which a runtime with a
full ICU spells `19 Sept 2026, 14:07`. Nothing about it changes, and
nothing about it is re-decided here; it is named so that the hint under the row can be generated
from the formatter rather than typed beside it.

**Relative is `Intl.RelativeTimeFormat("en-GB", { numeric: "always" })`** over the largest unit
that fits: seconds under a minute read "just now", then minutes, hours, days, months and years.
`numeric: "always"` rather than `"auto"`, so a column of them reads "1 day ago" beside "2 days
ago" instead of "yesterday" beside "2 days ago" — a table's rows have to be comparable down the
column, which is the one thing the friendlier spelling costs.

**The default is relative**, which is the prototype's own. Keeping the absolute reading as the
default would be *Authority* rule 5 applied where rule 5 does not reach: the handoff is not
silent here, it draws the choice and draws which side it starts on. What the trade costs is
written down rather than smoothed over — a relative stamp cannot be quoted and does not re-render
as it ages — and the way out is the row itself, which is why the hint says what each reading is
good for in the prototype's own words.

### A relative reading is offered only where the lab's clock wrote the instant

`formatTimestamp` reads the preference. **`formatFixtureTimestamp` does not, and is always
absolute.** It is called at the three sites where the instant is a field of a canonical document
rather than a fact about the record: an order's `placed_at`, in the orders table and in the order
editor's header, and a frozen shipping address's `selected_at`.

The argument is not that those dates are less important. It is that *ago* is measured from the
reader's wall clock, and a fiction has no wall clock. An author who types 21 August 2026 into an
order fixture has said when the order was placed *in the story*; rendering it as "a month ago"
says the shop has been trading for a month, which is a claim about this workspace that nobody
made and that changes every day the fixture is not touched. The same order read in a scenario
resolved next year would say "13 months ago" without a byte of it having moved.

This is not a new rule. Slice 15 refused to write "Ticket T-204 opened by Maya Laurent" on the
overview's activity list for the same reason — `opened_at` is an instant in the fiction and there
is no clock in this workspace that means it — and the departure is already recorded. What is new
is applying it to a rendering rather than to a sentence.

The split is two functions rather than a flag, so that a new call site has to say which clock it
is on. A boolean argument defaulting to the preference would make the fiction the case a caller
forgets, and the sites that forget are exactly the ones the fixture authoring surfaces will add.

### The preference is read where the format is decided

`formatTimestamp` reads `localStorage` at call time. It is not threaded through a context, a
provider or a prop.

A context would be the shape a preference that can change *while a surface is open* needs, and
this one cannot: `/settings` is a route of its own, so the only way to change it is to be standing
somewhere that draws no timestamps, and leaving is a mount. The rail's collapsed state is the
counter-example that proves the rule — it is read once into `useState` in `AppShell` precisely
because a control on the rail itself writes it, and the rail has to redraw on the press.

The read is guarded like every other accessor, so a browser that refuses storage renders the
default rather than failing. The cost is that a formatter is no longer pure, and it is worth
naming: a test asserting a rendered timestamp has to say which reading it is asserting, and the
suites that do fix the preference and the clock together.

### Reset to defaults returns what an operator chose, and nothing the shell wrote

*Reset to defaults* writes the defaults of the three preferences an operator set on this page:
where the app opens, whether the rail starts collapsed, and the timestamp format.

It does **not** clear the last-visited shop, and it does not clear the location Settings returns
to. Neither was chosen: the shell writes both as the operator moves, and they are a record of
where a browser has been rather than a statement of how it should behave. A reset that emptied
them would make the control mean "forget where I was" as well as "undo what I picked" — and the
first of those already has a control of its own, the *Forget* beside the last-visited shop, which
is the prototype's own answer and the one the row names.

The prototype's own reset re-points the remembered shop at the first shop in its list, which is a
fixture's way of saying *undo*; there is no shop a real reset could pick, and picking one would be
the application deciding where the operator had last been.

## Deliberately not here

- **A stored row, a per-user setting, or anything in the contract.** ADR 0044's refusal of a
  `lab_settings` table stands whole, and ADR 0052 restated it for exactly these preferences.
- **A live-updating relative stamp.** A timer per row that re-renders a table every minute is a
  cost paid on every listing to keep a convenience honest for the reader who is watching one.
  The stamp is correct when the surface draws it and the preference is the way to an exact date.
- **A tooltip carrying the absolute date under the relative one.** `title=` is never the only
  carrier of anything (*The form language*), and a second reading of a value that already has a
  control for choosing its reading is a third thing to keep in agreement with the other two.
- **`<time dateTime>` on every call site.** It would be a real improvement and it is not this
  preference's: the function returns a string to twenty callers that put it in a table cell,
  and turning it into an element is a change to all of them for a reason that has nothing to do
  with the preference.
- **The other three proposed preferences.** Auto-offered tours and table density are cut
  (*Proposals, not decisions*; ADR 0049 refused the first outright), and confirm-before-delete
  lands with the confirm it governs, in Slice 21.
- **A relative reading of the seed's own output, or of anything in a trace.** Nothing here
  reaches the API, the record or an exported span.

## Consequences

- `lib/ui.ts` gains a dependency on `lib/preferences.ts`. It is one direction only —
  `preferences.ts` imports nothing — so there is no cycle, and the preference module stays the
  one place a stored key is spelled.
- Fifteen route modules keep calling `formatTimestamp` unchanged. Two — `OrdersPage` and
  `OrderEditorPage` — call `formatFixtureTimestamp` for the three fixture instants, and go on
  calling `formatTimestamp` for nothing else, because those two pages draw no other instant.
- A surface added later that draws a canonical document's instant has a function to reach for and
  a rule that names it, rather than the default being silently wrong.

## Verification

- `lib/ui.test.ts` fixes the clock and asserts both readings of the same instant, the unit
  boundaries of the relative one, and that a fixture instant is unmoved by the preference.
- `lib/preferences.test.ts` asserts the key's default, its round trip, that an unrecognised
  stored value reads as the default, and that a browser refusing storage answers with it.
- `LabSettings.test.tsx` asserts each preference's write and read-back across an unmount, that
  *Reset to defaults* returns the three and leaves the remembered shop standing, and that
  *Forget* clears the shop without touching the three.
- A page test asserts the reach the slice's evidence names: a listing rendered with the
  preference set to absolute quotes a date, and the same listing rendered with it set to relative
  does not.

## Migration

None. One `localStorage` key that no browser holds yet and every reader defaults; no table, no
column, no canonical document, no fingerprint and no contract.
