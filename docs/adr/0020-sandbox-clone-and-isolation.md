# ADR 0020 — The sandbox clone: copy the snapshot, isolate the arm

Status: accepted — 2026-08-25

Implements `docs/PLAN.md` Milestone 2's cloning outcome, under ADR 0011, the snapshot boundary of
ADR 0012, the order-fixture lifetime of ADR 0015, and the canonical snapshot of ADR 0019. Records
the `sandbox-state-v1` document, what a clone copies and what it only claims, the write seam a run's
tools mutate through, the optimistic-concurrency token that seam presents, and the three operations
that publish it.

ADR 0019 deferred exactly this: "Cloning a snapshot into two isolated arms is the next outcome. This
slice freezes one immutable starting state; cloning is what makes a mutable copy per arm."

## Context

A snapshot is immutable starting state shared by every arm of a comparison. That is what makes it
useful and what makes it unusable as run state: an experiment's whole claim is that both arms began
in the same world, and an arm that could write into the snapshot would be writing into the other
arm's world.

So a run needs a third thing beside the definitions and the snapshot: a copy of the starting state it
alone owns. `docs/architecture.md` has said since the direction reset that "each arm receives an
independently mutable clone with the same starting-state fingerprint"; this is the slice that makes
that sentence true.

## Decision

### The clone copies the state and pins the snapshot

ADR 0019's rule — pin what is immutable, copy what is not — decides this document too, one level up.
A snapshot **is** immutable, so a clone records `snapshot_fingerprint` and never a second copy of the
pins behind it. The frozen state inside the snapshot is what a run mutates, so the clone copies it
whole.

The copy is the isolation. There is no shared row, no reference back into the snapshot's document for
the mutable half, and no update path on `sandbox_snapshots` at all — so "one arm never mutates the
other" is a property of the storage layout rather than a rule something has to remember to enforce.

A consequence worth naming: a clone is readable without its snapshot, unlike a snapshot without its
pins. That asymmetry is not an inconsistency. The pins are immutable and can be resolved forever; the
state is the thing that moves, and an arm that had to resolve its own current state through another
row would be one join away from reading a world it has already left.

### Two fingerprints, and they say different things

`snapshot_fingerprint` is where this arm started and never moves. `state_fingerprint` is where it is
now and moves with every applied change.

Both clones of one snapshot answer with the same pair at revision 0, because they hash the same
bytes — that is the acceptance criterion "two sandbox clones begin with the same fingerprint", stated
as data an operator can read rather than as a claim a test makes privately. They stop agreeing the
moment one arm writes, which is what makes divergence visible without diffing two documents.

The fingerprint describes **state, not history**: two arms that make the same change agree again. That
is correct and deliberate. Which of them acted, when, and how many times is run evidence, and run
evidence arrives with the runner in Milestone 4.

### `sandbox-state-v1`

```
canonical_schema_version   "sandbox-state-v1"
snapshot_fingerprint       the starting state this arm claims
state                      the same section `sandbox-v2` carries, by the same codec
```

The `state` section is rendered and decoded by `sandbox_state_document` /
`sandbox_state_from_document` — the codec ADR 0019 already wrote — so a clone and the snapshot it came
from cannot describe an order two different ways. Sharing the codec rather than the schema token is
the point: the two documents mean different things and must fail loudly when confused, but the
commerce world inside them is one shape.

The **label and the revision are deliberately outside the document.** A label is operational naming
and a revision is a write counter; ADR 0012 keeps runtime identifiers and operational values out of
fingerprinted bytes, and two arms whose labels entered the hash would not start from the same
fingerprint — which is the one thing this slice exists to guarantee.

As with the snapshot decoder, the schema token is checked first, so a document of another version
says *that* rather than failing three levels down.

### The write seam exists; the public write does not

`Sandbox.with_order` is the whole of the mutable commerce surface, because an `order-fixture-v1`
document is the whole of the mutable commerce world a sandbox holds. Its rules are about identity
rather than content: a run changes what an order *says*, never which order it is (`reference` is what
the customer and the agent quote at each other) and never whose it is. An order the sandbox never
held cannot be introduced, because nothing in this milestone creates orders inside a run and a
silently-appearing order would be starting state no snapshot explains.

`SandboxService.apply_order_change` is that seam at the application boundary, and it is **not
reachable over HTTP**. The actors that mutate a sandbox are the versioned read tools and the safe
address-change action, and both are later outcomes of this milestone. A general "write any order"
endpoint published ahead of them would be a hole no authorization rule guards, and it would be
rewritten by the slice that finally has an actor to authorize.

The alternative — cloning with no write path at all — was rejected because it would not deliver the
outcome. "Independently mutable" is a claim about behavior; without a write, the revision column, the
concurrency guard, and the isolation itself are all untested assertions. What is deferred here is the
*caller*, not the capability.

### Optimistic concurrency belongs to the store

`revision` starts at zero and counts applied changes. A writer presents the revision it read; the
service refuses a stale one, and then the `UPDATE` refuses it again with the revision in its `WHERE`
clause.

Both checks are deliberate. The service's read-then-write can be overtaken between the two
statements, so only the statement can decide the race — the same reasoning ADR 0009 used for order
cancellation and ADR 0019 used for the snapshot fingerprint's unique constraint. The difference is
what the loser gets: a snapshot's loser gets the winner's row, because identical starting state is
one snapshot however many writers produced it, while a sandbox's loser gets
`SandboxRevisionConflictError`, because it computed its change against a world that no longer exists.

That error is application-only for now, with no HTTP handler, for the same reason there is no public
write: the slice that exposes a writer maps its refusal. It carries the losing writer's revision and
the one it can *see* — and `None` when it can see none, because the re-read that looks for the winner
runs inside the loser's own transaction and the transaction that overtook it may not be visible from
there. Reporting "moved to revision 0" against an expectation of 0 would be a sentence that cannot be
true; "no longer at revision 0" is what the store actually knows.

The `UPDATE` is executed through the session rather than the connection, so the ORM synchronizes any
instance of that row already loaded in the same unit of work. Through the connection the statement
bypasses the identity map, and a later read would answer with pre-update attributes for as long as
anything held that instance alive — which today is never, only because the repository leaks no models
and the identity map holds weak references. That is freshness by garbage collection, and a future
caller that loads the row earlier in a request would silently lose it.

### Cloning is not idempotent, and that is the point

Materializing the same starting state twice is one snapshot (ADR 0019). Cloning it twice is **two
arms**, which is what a paired experiment is made of. The two operations sit beside each other and
answer opposite ways on purpose, and the storage says so: `sandbox_snapshots` refuses a duplicate
fingerprint per shop, while `sandboxes` carries no uniqueness over `state_fingerprint` at all,
because two arms sharing bytes is the claim rather than a duplicate to collapse.

An arm is required to carry a label. It is the only thing distinguishing two rows that are otherwise
identical by construction, and defaulting it would leave an operator reading two indistinguishable
fingerprints with no way to say which is which. The label rule is the lab's one label rule, translated
into an application refusal because a name is operational rather than part of the state the domain
guards.

Labels are **not** unique per snapshot. Arms are identified by their ID, and Milestone 4's experiment
record is what will own naming across a pair; a uniqueness constraint invented here would be a rule
that slice has to remove.

### Persistence

One table, `sandboxes`, holding the canonical document. `snapshot_fingerprint` is read out of it and
`state_fingerprint` is the hash of it; both are columns so a shop's arms can be recognized without
decoding every row, never as a second source of truth. `revision` is the token the update predicates
on, and a check constraint keeps it non-negative.

A sandbox is not yet bound to a run, because runs do not exist until Milestone 4. It is bound to its
shop and its snapshot, which is everything this slice can honestly say about where it belongs.

### Public contract

Three operations, and their shape follows the snapshot's. `POST
/shops/{shop_id}/snapshots/{snapshot_id}/sandboxes` clones, because a sandbox is derived from a
snapshot and cannot exist without one. `GET /shops/{shop_id}/snapshots/{snapshot_id}/sandboxes` lists
the arms of one starting state. `GET /shops/{shop_id}/sandboxes/{sandbox_id}` reads one, addressed by
the shop, because a sandbox is shop-scoped state and its snapshot is provenance rather than a path a
client must remember.

The state travels as the **same projection a snapshot answers with**, reusing `SandboxStateSchema`, so
an operator compares an arm against the starting state it came from field by field rather than in two
shapes.

### The Studio surface

Frame set: none — the design direction has no sandbox frame, so the arms live on the snapshot page
under the shell's resource conventions, beside the snapshot they were cloned from.

The panel shows what the decision above makes worth showing: the arms of the selected snapshot, each
with its revision and its current-state fingerprint. Two freshly cloned arms display the same
fingerprint, which is the isolation claim made legible; an arm that has moved shows a different one
and a higher revision. There is no write control, because there is no public writer.

## Deliberately not here

- **Versioned read tools** consume a sandbox and arrive with Milestone 2's tool outcome. They are the
  first reader of `state` through a tool contract.
- **The safe address-change action** is the first public writer, and it maps
  `SandboxRevisionConflictError` when it arrives.
- **Binding a sandbox to a run or an experiment**: neither exists until Milestone 4, and a foreign
  key to a table nobody has designed is a guess, not a constraint.
- **Recording *what* changed in an arm.** The revision says how far an arm has moved; the normalized
  event stream that says what moved it is run evidence, and it belongs with the runner.
- **Resetting or deleting an arm**: an arm is the state a historical run is explained by, and no slice
  yet has a reason to remove one.

## Verification

- Domain tests (`test_sandbox_domain.py`) cover the revision starting at zero and advancing, the
  change leaving the value it was applied to alone, the frozen order ordering surviving a write, the
  refusal to introduce an order the sandbox never held, and the refusal to renumber an order or move
  it to another customer.
- Service tests (`test_sandbox_clone.py`) prove that a clone copies the snapshot's state and records
  where it started, that two arms of one snapshot begin at the same fingerprint, that cloning twice is
  two arms where materializing twice is one snapshot, that a write in one arm is invisible to the
  other arm and to the snapshot, that two arms making the same change agree again, that a stale
  revision is refused by the service and the losing writer refused by the store, that a write is
  visible to a reader holding the row it already loaded, that an unlabelled
  arm is refused, that one shop never reaches another's arm or clones another's snapshot, that a
  document of another schema version is refused by its token, and that the stored document is the
  fingerprinted one.
- Contract tests (`test_sandbox_api.py`) prove the three operations, the state answered in the
  snapshot's own projection, two arms starting together, shop scoping, the refused label, the unknown
  snapshot, and that no public write operation exists.
- Migration tests prove the table's non-negative revision and the deliberate *absence* of uniqueness
  over the state fingerprint, and place it with the definition tables' migration fate.
- Frontend tests (`Snapshots.test.tsx`) prove cloning two arms that read back with one fingerprint, an
  arm that has moved apart from the one beside it, the refusal to clone an arm with no label, and that
  a clone the server accepted stays reported as accepted when a later listing fails — the created arm
  comes from the response rather than a refetch.
- The Playwright scenario journey now continues past materialization: it clones two arms from the
  frozen snapshot and reads back the one fingerprint they share.
