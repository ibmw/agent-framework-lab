# ADR 0035 — What an arm's world became, and the counter that could not say it

Status: accepted — 2026-09-05; amended 2026-10-25

Delivers the state-diff half of `docs/PLAN.md` Milestone 5's sixth outcome, which ADR 0033
deferred by name. Records the diff as a projection of the bytes a fingerprint already
covers, the walk that has no list of interesting fields, the grouping by order identity, and
what is kept rather than dropped so the card's claim stays falsifiable.

## Context

Since ADR 0020 an arm has carried two fingerprints: the snapshot it was cloned from and the
state it is in now. Since ADR 0026 every tool call carries the revisions it moved, and since
ADR 0028 the scenario's own faults carry theirs. ADR 0033 put all of that on the results
screen as the card called **Business state — verified, not claimed**, whose whole point is
that an agent's reply saying it changed the address is not evidence that the address changed.

The card was half of that. It could say *that* an arm moved — `orders.apply_address_change ·
r0 → r1`, and a fingerprint that no longer matches its sibling's — and it could not say what
about the world was different. A revision counter is equally true of a redirected order and
of a corrected typo, and frame 9 shows the value on both sides: `Bordeaux — previous flat →
Home — 18 rue des Écoles, 69005 Lyon`.

ADR 0033 left it out deliberately, because it is a reading the backend did not serve and
that ADR added no endpoint on principle. This one adds the reading.

## Decision

### The diff is a difference between the bytes the fingerprint covers

Both sides are rendered through `sandbox_state_document` — the same codec the snapshot's
`sandbox-v2` envelope and the clone's `sandbox-state-v1` envelope are hashed from — and then
**normalized the way the hash normalizes**, because `canonical_json_bytes` applies NFC before
it hashes (ADR 0007). Two strings in different normalization forms hash identically, so a
walk that compared them as written would report a change the fingerprint says did not happen
— and would render it as `Écoles → Écoles`, a difference nobody can see. The walk is over the
resulting canonical documents rather than over the domain objects behind them.

That makes one property true by construction rather than by care: **an arm's diff is empty
exactly when its state fingerprint is still the one every sibling clone started at.** It is
the function's own doing rather than its callers': every production caller happens to decode
from bytes that were already normalized, so a normalization missing here would have been
latent rather than harmless, and a property that holds only because of where it is called
from is not held by construction at all.

A comparison written against `SandboxState` and `OrderFixturePayload` instead would be a
second opinion about what "changed" means, free to call an arm unmoved that the fingerprint
calls moved — and the card would then hold two readings of one arm that could disagree in
front of the operator.

### It walks the whole document, and has no list of fields worth watching

The card claims that nothing else moved. That claim is checkable only if nothing was excluded
from the check, so the walk descends everything the state document holds and reports every
leaf that differs.

It also means the day an order fixture gains an authored field, that field appears in the
diff with no change here — the rule ADR 0023 gave the conformance sweep, applied to a
projection: read the thing itself, never a list somebody has to keep current.

The walk is total over the canonical union (ADR 0007). Objects merge their keys; lists pair
by position and report the positions only one side has, because a canonical list is ordered
and its order is part of the state; absence descends, so a whole object arriving is every one
of its fields arriving against `null`. A value that is an object on one side and a scalar on
the other cannot come out of a codec whose shape is fixed, and is reported as one change over
the rendered subtree rather than descended into — under-reporting is the one failure a diff
must not have. `True == 1` in Python and both are canonical values, so a leaf is unchanged
only when it is the same value *of the same type*.

### Absent is not empty

`before` and `after` are the values rendered as text, and `null` means the field was not
there. An order that had no shipping address and now has one is a different fact from one
whose city was blanked, and the interface says "not set" rather than leaving a cell empty,
which would read as the same thing for both. It is the rule ADR 0032 applied to a
measurement, applied here to a field.

A key that is explicitly `null` and a key that is absent read the same to the walk, and that
is deliberate rather than overlooked: the codec has a fixed shape and always writes the key,
so the two cannot both occur for one field. Distinguishing them would be a rule about
documents this lab does not produce.

### Changes are grouped by the order they happened to, paired by identity

An order is what a customer quotes and an agent reads back, so the diff groups by order and
names each group by its reference. A flat list of `orders[1].document.shipping_address.city`
would make the reader do the grouping, and would make it by position.

The two states' orders are paired **by order id**, not by index. A run cannot add or remove
one today — `Sandbox.with_order` is the only writer, and it refuses to introduce an order or
move one to another customer — so the lists agree; pairing by position anyway would mean that
the day something can, every order after the change reads as rewritten instead of the one
that moved.

### What is outside the orders is kept, precisely because nothing can produce it

`other` carries changes outside every order: the customer the sandbox is for, and the
interaction reference the incident opened from. No write seam in this build can move either.

They are reported rather than dropped because that is the half of "no other state changed"
nothing else guarantees. An empty list is the check passing; a non-empty one is a finding
about the lab, and the interface raises it apart from the agent's writes rather than folding
it in with them (as an alert until the 2026-10-25 amendment; now a static line with the warning
glyph). A diff that silently ignored the region no writer touches would make the
card's claim unfalsifiable, which is the same thing as making it meaningless.

### It is projected, and it travels with the standing and the metrics

Nothing is stored. `ExperimentDetail` already resolves the snapshot's starting state and each
arm's current sandbox to serve an experiment, so the diff is a function of two documents that
are already in hand — no repository read, no table, no migration.

It is served on the run rather than through an endpoint of its own for the reason ADR 0029
gave the standing and ADR 0032 the metrics: the states are the backend's, and a client handed
both would be free to decide for itself what changed. One reading, computed where the
documents are.

## Deliberately not here

- **A synthesized sentence.** The frame's `Bordeaux — previous flat → Home — 18 rue des
  Écoles, 69005 Lyon` is rendered as the fields that moved, each with its own path. Composing
  an address into one line would be a presentation rule that knows what a shipping address
  is, and it would be wrong for the next field an order gains.
- **A diff between the two arms.** Each arm is read against the world *both* were cloned
  into, which is what makes the two columns comparable. An arm-to-arm difference would be a
  fifth reader with no common origin, and the comparison stays the operator's (ADR 0033).
  Narrowed by the 2026-10-25 amendment: the backend still serves no such diff, but the client
  now compares the two served diffs row by row.
- **Attributing a field to the write that moved it.** The writes are listed above the fields
  with the revisions they moved, which is what the record actually holds; claiming that a
  particular call changed a particular field would be an inference, and the one case where it
  matters — a fault and a tool moving one order — is exactly where the inference is weakest.
- **Diffing anything but a sandbox.** `canonical_changes` is general over canonical documents
  and could read two published versions of a definition apart. That is an authoring surface
  nobody has asked for; the function is where a future slice will find it.
- **Notes, tags, traces, replay, and fork provenance.** The rest of Milestone 5's sixth
  outcome. Nothing here stores anything, so none of them is blocked by this shape.

## Verification

- Projection tests (`test_state_diff.py`) cover the reading and the walk: an arm that wrote
  nothing reading as the world it started in, the redirect reading as the values on both
  sides with the order named by its reference, only the order that moved reported, a field
  that was not there absent rather than empty and one absent on both sides not a change at
  all, the diff empty exactly when the fingerprint has not moved, two states the fingerprint
  calls identical — a composed and a decomposed `É` — reading as unchanged rather than as
  `Écoles → Écoles`, a change outside the orders reported rather than dropped, and an order
  gained or lost paired by identity — plus the walk's own four rules: `True` is not `1`, a
  list pairs by position, a scalar where an object was is reported whole, and a subtree
  arriving is every leaf arriving.
- Contract tests (`test_experiment_api.py`) drive the real incident: the advanced arm reads
  back the stale Bordeaux copy replaced by the customer's default, the scenario's fault
  beside it in the same difference, nothing outside the orders, and the arm beside it still
  in the world it was cloned into.
- Frontend tests (`Experiments.test.tsx`) cover the card: the fields each write moved the
  world to, the fault's field in the same list, "no other state changed" shown when the
  check passes, "not set" for a field that was not there, and a change outside every order
  raised as an alert (a static line since the 2026-10-25 amendment, whose tests replace these).
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, as
  every slice since ADR 0026 has been: after driving both arms to the turn cap, the operator
  reads each arm's order by its reference, the city it moved from and to, the fulfilment the
  scenario's fault advanced, and the sentence that says nothing else did.

## Migration

None. The diff is computed from documents the experiment already reads, so no table changes,
no fingerprint moves, and every experiment started before this slice reads its own history
back with the same detail as one started after it.

## Amendment — 2026-10-25

The results read the diff as a difference rather than as a list. Each arm opens on one summary
line per order — its paths grouped by their first segment, a list counted by the entries it
gained — and every path stays on the page behind a disclosure, so the diff is as exhaustive as
it was.

This narrows *A diff between the two arms* above. The backend still serves only each arm's diff
against the world both were cloned into, and no arm-to-arm reading; but the client now compares
the served values row by row. Where the arms changed the same paths it sets them side by side
and judges each row *Same*, *Difference* or *Not compared*, and the rows that differ are shown
above the disclosure. Where the paths differ it compares nothing, keeps a column per arm, and
names the paths only one arm changed. The comparison is the client's reading of two served
documents, made by two rules, and it is no longer the operator's alone.

Two kinds of value are shown for each arm and not compared, because each arm mints its own:

- **A moment the run's own clock wrote**: a canonical instant (the shape `canonical_timestamp`
  writes) on a field one of the run's two writers stamps from its clock — an event's
  `occurred_at`, `fulfilment.shipped_at` (`advance_fulfilment`) and
  `shipping_address.selected_at` (`apply_address_change`).
- **An address change's event name**: `address-change-` and twelve hex digits of a
  confirmation that hashes the arm's own state fingerprint (`confirmation_of`), when every arm's
  value has that shape. A fault's event is named after the fault and is the same in every arm,
  so two different names at one index, or two arms whose events sit in a different order, read
  as a difference.

The limits are stated rather than hidden. The clock-written fields are a list the client keeps by
hand, and it fails loud: a third writer that stamps a clock elsewhere reads as a difference until
it is named, and a date somebody chose is never set aside for looking like one. Within the list,
a moment *is* set aside even if it meant something — two arms that shipped at materially
different times read alike — which is why the sentence above the table counts what it set aside
("apart from 4 timestamps and 1 event identifier") rather than claiming the arms are the same,
and why both values stay in the table. Absent against present is always a difference.

A change outside every order is a static line with the warning glyph rather than an alert. It
is on the record when the page loads and nothing announces it changing; it stays outside the
orders' summary, in the error ink and the glyph, so it is still not folded in with the agent's
writes.

Frontend tests (`Experiments.test.tsx`) cover the summary, the groups, the arms side by side with
a differing value marked and visible on load, the moments and event name left unmarked with both
values shown and counted in the sentence, a different fault's event and a reordered history
marked, a timestamp the clock did not write marked, a moment against an absent field marked, one
field counted as one, a single arm with no comparison, the disclosure holding every path, the
column per arm with the paths only one arm changed named, and no alert on load.
