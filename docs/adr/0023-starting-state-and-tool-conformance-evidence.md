# ADR 0023 — What a starting state is worth: goldens and a registry-wide tool sweep

Status: accepted — 2026-08-27

Closes `docs/PLAN.md` Milestone 2's last outcome — "prove deterministic generation, canonical
serialization, and tool behavior with unit and integration tests" — and its two remaining acceptance
criteria: that an author can reproduce the same canonical snapshot from recorded inputs, and that
tool behavior holds across the published set rather than at the points somebody sampled. Builds on
the canonical hashing rule of ADR 0007, the envelope of ADR 0012, the `sandbox-v2` document of
ADR 0019, the `sandbox-state-v1` document of ADR 0020, and the tool contracts of ADR 0021 and
ADR 0022.

No production code changes. This is a decision about what the milestone's claims are checked
*against*, and it is recorded because the two mechanisms it introduces — a published fingerprint
constant and a sweep driven by the contract registry — constrain every slice after it.

## Context

Each slice of this milestone tested itself well, and each tested itself against the wrong-address
incident. That leaves two gaps neither a slice nor a reviewer would notice.

**Nothing pinned the bytes.** Every fingerprint in the lab is `sha256` of a canonical document, and
every test compared one computed fingerprint to another computed in the same process a moment later.
That proves the serializer is a function. It does not prove it is *this* function. A separator, a
sort flag, an `ensure_ascii`, or a JSON library swapped for a faster one would move every fingerprint
the lab has ever issued, and the whole suite would stay green, because both sides of every assertion
would move together. ADR 0019 makes a snapshot *be* its fingerprint; a silent change to what that
fingerprint is would silently redefine every historical starting state.

**Nothing held the tool set as a set.** ADR 0021 published eight tools and ADR 0022 published two
more, and the suites test them one at a time, by name, in hand-written lists. The invariants they
share — a read cannot move an arm, the same read twice is the same bytes, a call outside the contract
refuses instead of raising, a write runs under an actor or does not run, no result carries a
`CUSTOMER_ONLY` value — are properties of *every* tool, including the eleventh. Under a list, the
eleventh tool is conformant on the day someone remembers it.

## Decision

### A published fingerprint is a recorded constant

`test_sandbox_determinism.py` records three golden constants: the exact bytes the canonical
serializer writes for one small document covering every member of the canonical union, and the
`sandbox-v2` and `sandbox-state-v1` fingerprints of one fixed starting state.

**A golden owns its input.** The order fixture, the interaction, the pins, and the seed the goldens
are computed from are authored in that module and are deliberately *not* read from
`order_factories` or `workspace_factories`. A published identity that moved whenever an unrelated
suite wanted a different example would be worth nothing; the seed is deliberately not the workspace
seed, for the same reason.

**A golden failing is a question, not a chore.** When one of these constants fails, the answer is not
"paste the new value". It is: every snapshot frozen before this change is a different starting state
now. That is sometimes exactly right — ADR 0021 and ADR 0022 each moved the fingerprint on purpose,
by adding tools to it, and said so — and it must never happen without someone saying so. Updating the
constant is how they say it.

The large integer in the serializer golden is not decoration. A binary float cannot represent
`10000000000000000001`; a writer that ever routed a number through one would round it, and ADR 0007's
prohibition on floats would be violated by the serializer itself rather than by a caller.

### Reproducible means recomputable, not recognizable

Materializing the same recipe twice already returned the same snapshot, but by fingerprint lookup:
the second call recognized the first one's row. That proves the fingerprint is stable and says
nothing about whether it is computable — a stored answer cannot demonstrate reproduction.

So the test deletes the stored snapshots between the two freezes. The second materialization has
nothing to recognize and has to rebuild the document from the published versions it pins and the
orders it reads now. It produces the same fingerprint and the same document under a different row
identifier, at a later hour, which is the milestone's reproducibility criterion stated in the only
way that can fail.

### The sweep is the registry, and the table is checked against it

`test_sandbox_tool_conformance.py` parameterizes over `SANDBOX_TOOL_CONTRACTS`,
`READ_TOOL_CONTRACTS`, and `WRITE_TOOL_CONTRACTS` rather than over lists of names. What makes that
possible is `tool_call_factories.py`: one valid call per published tool, and a test asserting the
table's keys are exactly the published set. Declaring a tool without adding a call fails a test
instead of quietly shrinking every sweep that reads the table.

Two consequences are deliberate:

- **Applying a change cannot be tabulated.** A confirmation names one exact change to one exact arm
  (ADR 0022), so the table carries a stand-in that the helper resolves by proposing first. That is
  not a shortcut around the propose-then-apply rule — it *is* the rule, and running it is the only
  way a sweep reaches the apply handler at all.
- **The sweeps assert they are non-empty.** A parameterized test over a list that became empty
  reports as passing. That is the one way this suite could stop proving anything without anybody
  noticing, so the coverage test asserts each sweep has cases.

The write side gets the dual of "a read leaves the arm where it stood": no write moves the arm on
its way to refusing. A handler that wrote before it finished checking would leave an arm carrying
half a change the agent was told did not happen, and the agent's next read would describe a world
nothing in the transcript explains. What is deliberately *not* swept is the stronger form — that a
valid write moves the arm — because it is not true of every write by design: proposing resolves a
change and confirms nothing (ADR 0022). `ToolEffect.WRITE` says a tool *may* move the arm and needs
an actor, not that it will. What each write does when it succeeds stays tested per tool, where the
difference between the two is the point.

`test_no_read_tool_discloses_a_customer_only_value` is replaced by a registry-driven sweep over reads
*and* writes. The rule was always structural — no projection reads a `CUSTOMER_ONLY` field (ADR 0021)
— and the check now covers the contract set the rule applies to, rather than the eight calls that
existed when it was written.

### The declarations are checked as a public contract

Three unit checks hold the declaration table itself, because Milestone 3 will generate a framework's
JSON Schema from it:

- every argument is text with a description, and every enum lists unique choices — the string-only
  argument space ADR 0021 chose;
- every argument named `kind` offers exactly `ShopDocumentKind`, so a collection the shop grows and
  the contract does not is caught as knowledge nothing can read; and
- every published tool appears in `TOOL_CONTRACT_VERSIONS` at its own version, so a tool outside the
  fingerprint cannot let two different starting states agree.

At the HTTP boundary, the listing is checked argument-for-argument against the declarations. The
existing contract test still restates the published set by hand — that is what a contract test is for,
and a change should show up in a diff — while the new one proves the listing is that table *rendered*,
with no tool, argument, or choice list dropped on the way out.

## Consequences

- A serializer or envelope change now costs three constants and a deliberate answer to "is every
  historical starting state different now". That is the intended price.
- Adding a tool costs one entry in `tool_call_factories.py`, and in exchange the tool is held to
  every shared invariant from the moment it is declared.
- The golden inputs are a second copy of facts that also live in the shared factories. That
  duplication is deliberate and load-bearing; it must not be refactored away.

## Deliberately not here

- **A golden for the full envelope's bytes.** Only its digest is recorded. The bytes would embed a
  complete `order-fixture-v1` document, and a reviewer reading a 1.5 KB literal diff learns less than
  one reading a changed digest beside a changed schema.
- **Cross-process determinism.** The suite runs in one interpreter. Nothing in the canonical path
  reads process-local state — key order is sorted, strings are NFC-normalized, and no hash-seeded
  iteration reaches the document — and a subprocess harness would buy a stronger claim than the risk
  warrants today.
- **Tool authorization per read.** Reads still need no actor (ADR 0021), and the sweep records that
  as a current property rather than a permanent one; per-tool read permissions arrive with agent
  configurations in Milestone 3.

## Verification

- Unit tests (`test_sandbox_determinism.py`) cover the serializer's exact bytes, key-order
  independence, the two envelope fingerprints, and that one state's two documents are never mistaken
  for each other.
- Integration tests in the same module cover a forgotten snapshot recomputed rather than recognized,
  the freezing hour not entering the fingerprint, a snapshot named by the hash of the document it
  stored, the pinned tool table being the one this lab publishes, and two arms agreeing with the
  snapshot they came from.
- Conformance tests (`test_sandbox_tool_conformance.py`) sweep the published set for a valid call
  answered, a canonical result document, a read leaving the arm where it stood, a read repeating
  itself byte for byte, a read needing no actor, a write refusing to run without one, an undeclared
  argument refused with no write having moved the arm on the way, every required argument enforced,
  and no result serving a `CUSTOMER_ONLY` value. The undeclared argument's name is asserted absent
  from the contract before it is sent, so a tool that one day declares it fails saying the probe is
  stale rather than saying the tool stopped refusing.
- Contract tests (`test_sandbox_tool_api.py`) cover the published listing rendering every declared
  tool argument for argument.
