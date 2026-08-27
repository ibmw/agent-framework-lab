# ADR 0022 — The safe address change: the first thing an arm may do

Status: accepted — 2026-08-27

Implements `docs/PLAN.md` Milestone 2's address-change outcome, under ADR 0011's tool-first rule,
the permission model of ADR 0014, the frozen-address-copy rule of ADR 0015, the clone and its
optimistic-concurrency seam from ADR 0020, and the tool contract set of ADR 0021. Records the two
write tools, where authorization comes from, the confirmation that is also the idempotency key, the
revision a proposal writes against, and why a conflict is a refusal rather than a 409.

ADR 0021 deferred exactly this: "The safe address-change action. It is the next outcome of this
milestone and the first public writer, and it is what will map `SandboxRevisionConflictError` onto
the contract." ADR 0020 deferred the writer before that, and ADR 0015 wrote the fulfilment rule this
enforces before either.

## Context

Every tool the lab published until now answers a question. That was the right order — an arm that
cannot read cannot sensibly write — but it leaves the milestone's central claim untested: the
wrong-address incident is only an incident because something can be *done* about it, and the
acceptance criterion says "backend rules reject unsafe or stale address changes regardless of model
output". A rule nothing can call is not a rule that has been proven to reject anything.

`SandboxService.apply_order_change` has existed since ADR 0020 with no caller, deliberately: "a
general 'write any order' endpoint published ahead of them would be a hole no authorization rule
guards, and it would be rewritten by the slice that finally has an actor to authorize." This is that
slice.

## Decision

### One mutation, and it is a reselection

An arm may change where one order ships, and nothing else. The new address is **chosen from the
customer's address book**, never typed in — `FrozenShippingAddress` requires the entry it was copied
from, so ADR 0015's rule for the order editor is enforced by the same type rather than by a second
check that could disagree with the first. `freeze_address` is now the one function that makes such a
copy, shared by the Studio editor and the run-time change.

The rules live in `domain/address_change.py` as pure functions of the order and the address book
around it, which is what makes the acceptance criterion a property of the domain rather than a
promise the tool layer makes. Three of them refuse, and each answers a different question:

- **Too late** — a fully fulfilled order cannot be redirected (`ADDRESS_CHANGEABLE_STATUSES`, which
  ADR 0015 wrote against exactly this future caller). A partly fulfilled one still can: the rest of
  the parcel has somewhere to go.
- **Over** — a refunded order has no destination left to argue about.
- **Nothing to change** — reselecting the address the order already ships to is refused rather than
  quietly applied, because applying it would append history saying something happened when nothing
  did. The comparison is against the *frozen copy*, not the entry's identity: an order that froze
  `home` before the entry was edited genuinely moves when `home` is reselected, and that is a real
  change.

Applying writes the address **and** the `ADDRESS_UPDATED` event together, never one without the
other. The event is not decoration: it is the history an agent reads back through
`orders.read_order`, the deterministic evidence Milestone 5 will evaluate, and the only thing
distinguishing an order that was redirected from one authored at its destination in the first place.

### Propose, then apply

Two tools rather than one, and the split is the whole safety model:

| Tool | Does |
| --- | --- |
| `orders.propose_address_change` | Resolves the change, refuses what the world does not allow, names the result by its content. Moves nothing. |
| `orders.apply_address_change` | Presents that name back, and does it once. |

A single `change_shipping_address` tool was rejected. `docs/api-and-schema-conventions.md` requires a
data-modifying tool to accept "an idempotency key and verifiable prior confirmation", and a one-shot
tool has nowhere to put either: the agent would have to invent a key, and there would be nothing to
verify consent against. The two-step also matches what the incident is actually about — an agent that
redirects a parcel without first reading back where it currently goes is the behavior an evaluation
wants to be able to see.

### The confirmation is the change's name, and also its idempotency key

A confirmation is `sha256` over three things and no more: the order, the address-book entry, and the
**state fingerprint** of the arm the change was worked out against. The first two are *what* would
change; the third is the world it was computed in, so a proposal made before the arm moved can never
be mistaken for the same proposal made after.

The arm's identifier is **deliberately absent** from the hash. Two arms of one experiment that
propose the same change against the same starting state produce the same name and the same bytes,
which is the comparability Milestone 5 reads as evidence. They stay isolated all the same, because a
proposal is stored per arm and looked up per arm: the name minted in one arm is not a proposal in the
arm beside it, and applying it there is refused as never confirmed.

Naming a proposal by its content rather than by a fresh identifier buys three things at once:

- **Proposing is idempotent and repeatable.** The same call against an unmoved arm computes the name
  already stored and answers with identical bytes — so ADR 0021's canonical-result rule survives the
  arrival of a write tool, for the half of it that changes nothing.
- **Consent is bound to the exact command.** Any different order, entry, or world is a different
  name; there is no way to confirm one change and apply another.
- **The confirmation *is* the idempotency key.** A proposal applies exactly once; presenting it again
  returns the result the first apply recorded, writes nothing, and leaves the revision where it is.

That last point is a deliberate reading of the convention rather than a departure from it. The
convention requires a data-modifying tool to accept an idempotency key; this one does — the lab
issues it instead of letting the caller choose. In a run the caller is model output, and a model that
reused one key for two genuinely different changes would collapse them into one write. A key derived
from the change cannot do that.

This is a **binding value, not a secret**, exactly as ADR 0009 recorded for the POC's cancellation
token. Its job is to prove which change was consented to, not to authenticate whoever presents it.
Authenticating the caller is the actor's job, below.

The proposal row is therefore both the consent record and the idempotency record, because those are
the same question asked twice: which exact change is this, and has it already happened?

**What the confirmation does not cover is the revision**, and that gap has to be closed where the row
is written. The hash describes the world; the revision counts writes. An arm that changes and changes
back sits at a higher revision holding the bytes it had before, so a re-proposal computes the name
already stored — against a revision the write would now lose to. Left alone, that proposal could
never be applied and the conflict refusal would tell the agent to propose again, minting the same
name and finding the same stale row: a legitimate change made permanently unappliable, reading as an
agent failing to recover from something it cannot recover from.

So recording a proposal moves an **unapplied** row to the revision the incoming proposal was computed
against. An identical confirmation is proof that the world is byte-identical, so only the counter has
moved and only the counter is refreshed. An **applied** row is returned exactly as recorded: it is
history, its result is what a replay must answer with, and re-opening it against a newer revision
would offer a second application of a change that already happened.

Two proposals of the same change racing each other are the same story one level down. Both read
nothing, both insert, and the primary key admits one — so the loser reads the winner rather than
raising, because the row that won says exactly what the loser's own proposal said. An uncaught
integrity error would become a `failed` outcome, which this module defines as never the agent's fault
and never a thing to retry; recording a proposal is the only write a propose makes, which is what
makes the rollback that recovers the session safe.

### The actor is in the envelope, never in the arguments

A write runs under one published support-identity version, presented beside the arguments rather
than among them. **Arguments are model output**, and an agent that could name its own actor would be
choosing its own permissions.

Both steps check `SupportPermission.CHANGE_SHIPPING_ADDRESS`, and the check runs *before* anything is
resolved — so an identity that may not redirect an order cannot learn from the wording of a refusal
whether the order exists or where it currently ships. This is where the permission enumeration
ADR 0014 wrote finally decides something; until this slice no permission had a write to withhold.

Where the actor comes from moves later without this contract changing: today the Studio console
offers the published identities and the operator picks one; from Milestone 3 the run resolves it from
its published agent configuration. The tool never learns the difference.

A write called with **no** actor is an error (422 `tool_actor_required`), not a refusal, by the same
rule that makes an unknown tool name a 404: the actor is not model output, so getting it wrong is a
client that built the call badly rather than an agent asking something the world declines.

Reads still take no actor. Every read published here is over the arm's own customer, and per-tool
read authorization arrives with agent configurations — ADR 0021's deferral stands.

### The revision a proposal writes against

A proposal records the revision it was computed at, and the apply writes against exactly that. There
is no revision argument, because the revision is not something a model should be asked to echo:
ADR 0021 already published it beside every read result as "the token the next writer presents", and
the proposal is what carries it from the read to the write.

An arm that moved in between refuses. That is not an edge case here — it is the point of the
scenario, whose recipe binds a `concurrent-entity-mutation` fault to the very order being redirected
(ADR 0018). The agent proposes against a world, the fault moves that world, and the write it
computed no longer applies.

The apply **re-plans** rather than replaying the stored proposal: between the two steps the world may
have made the change unsafe, and the rules — not a document written earlier — decide whether it is
still allowed.

### A conflict is a refusal, not a 409

`docs/api-and-schema-conventions.md` says to use 409 for a stale command version, and the definition
-authoring commands do. A stale *tool call* answers 200 with `outcome: "refused"` and
`refusal.code: "conflict"` instead, for the reason ADR 0021 fixed: the HTTP status describes whether
the tool ran, and the outcome describes what it concluded.

The world moving under an agent is a fact the agent has to notice and recover from — it re-reads the
order and proposes against what it now says — exactly like an order reference that names nothing.
Reporting it as a transport failure would make the fault block's whole purpose read as the lab
breaking, and Milestone 5 would be reading a 409 out of a transport log rather than a refusal out of
the evidence stream.

`ToolRefusalCode` gains four members for the same reason: `not_permitted` (this actor may not),
`not_allowed` (nobody may, whoever asked — the two are different things for an agent to do something
about), `not_confirmed`, and `conflict`. `not_permitted` is the refusal ADR 0021 said would "arrive
with the address-change action".

### A published write that nothing dispatches cannot ship

The read side already refuses, at import, a declared read with no handler. That check pairs read
contracts with read handlers, so a newly declared *write* passes it without anything having agreed to
run it — and would fall into the apply branch and die on an argument it never declared, reporting a
published mutation as the lab breaking. The write dispatch carries the mirror check, so the next
mutation this protocol is reused for cannot be published before it is routed.

### Effect is declared, not inferred

Every contract now carries `effect: read | write`. It decides three things a caller must not have to
guess: whether the call needs an actor, whether an adapter has to route it through a confirmation
step, and whether two identical calls against an unmoved arm are guaranteed to answer with identical
bytes. A framework adapter reads it instead of keeping a list of tool names it knows to be dangerous.

Inside the lab it also decides which *shape* of handler runs. A read handler is a pure function of
the context and cannot move an arm even by mistake; a write handler is given the arm's record, the
actor, and the write seam. Dispatching on the declared effect rather than on the handler map means a
read tool is structurally never handed a writer, and an import-time check refuses a contract whose
declared effect nothing implements.

`SandboxToolContext` and the order lookup moved into `sandbox_tool_context` so a reader and a writer
resolve the same world the same way: `NS-10482` has to mean one order whether the agent is reading it
or redirecting it, and two copies of that lookup would be two chances for `orders.read_order` and
`orders.apply_address_change` to disagree about which order the customer is talking about.

### One endpoint, not two

`POST /shops/{shop_id}/sandboxes/{sandbox_id}/tool-calls` runs both kinds. A second endpoint for
writes was rejected: an agent calls tools, not routes, and splitting them would make the transport
carry a distinction the tool contract already publishes — with the adapter, the console, and the
fingerprint each having to learn it twice. What a write adds to the envelope is the `actor`.

The response's `sandbox_revision` and `state_fingerprint` describe where the arm stood when the call
*started*. For a read that is simply where it was; for a write it is the world the change was
computed against, which is the more useful of the two. A caller that needs the arm's new position
reads the arm.

### Persistence

One table, `sandbox_action_proposals`, keyed by the arm plus the confirmation — both halves
load-bearing, for the reasons above. `applied_at`, `applied_revision`, and `result` are written
together or not at all, and a check constraint says so rather than leaving it to the one code path
that writes them: a row applied with no result to replay is a row nothing could answer an idempotent
retry from.

Closing a proposal predicates on the row still being open, in the statement, for the same reason
ADR 0020 put the revision predicate there: a read-then-write in the service can be overtaken between
the two, and only the statement can decide which of two applies wrote the result.

### The tool contracts move the sandbox fingerprint again

`TOOL_CONTRACT_VERSIONS` now names ten tools. An arm that can redirect an order begins in a different
world from one that can only look at it, so — exactly as in ADR 0021 — adding the write tools changes
the fingerprint of every starting state materialized from now on. That is the correct answer rather
than a migration: a snapshot *is* its fingerprint (ADR 0019), and snapshots frozen before this slice
remain readable and remain identified by what they froze.

### The Studio surface

Frame set: none — the design direction has no tool frame, so the write lives in the console ADR 0021
put beside the arms, under the shell's resource conventions.

Selecting a write tool adds an acting-identity picker, offering only identities with a published
version: a draft can grant itself another permission a moment later, so it can never act. A
successful proposal offers "Apply this change", carrying the confirmation the proposal answered with
— so what is applied is exactly what was proposed rather than anything retyped in between, and the
two steps are as visible to the operator as they will be in a transcript. A write that succeeds tells
the arms table to reload, because the revision and fingerprint it shows have just moved.

## Deliberately not here

- **Any second mutation.** Cancellation, refunds, and discounts have permissions in the enumeration
  and no tool, because no scenario needs one yet (ADR 0011's "add concrete capability before
  generalizing a speculative abstraction"). The propose/apply protocol is the reusable part; the next
  mutation reuses it rather than inventing its own.
- **Recording the change as run evidence.** A result is canonical so that it *can* be recorded, and
  the order event is state either way — but the normalized stream that says which arm called what,
  when, and in what order belongs with the runner (Milestone 4).
- **Read authorization.** Still Milestone 3, still for the reason ADR 0021 gave.
- **Expiring a proposal.** A proposal is already bound to the world it was computed in, so a stale one
  cannot apply. A time limit would be a second, weaker version of a guard that already holds.
- **Exposing the write to a framework.** An agent configuration selects tools, and configurations
  arrive in Milestone 3. The adapter that registers them reads `effect` to know which need the
  two-step.

## Verification

- Domain tests (`test_address_change_domain.py`) cover the redirect a paid unfulfilled order allows,
  the address nobody has, the shipped order that is too late, the partly shipped one that is not, the
  refunded order, the reselection that changes nothing, the edited entry that genuinely does, the
  address and event written together, the order the change was applied to left alone, and everything
  an order is identified or priced by staying untouched.
- Service tests (`test_sandbox_address_change.py`) cover a change staying appliable when the arm
  returns to a state it left, an applied proposal keeping the revision it recorded, two proposals
  racing one name reading the winner rather than failing, the proposal showing both addresses and
  moving nothing, proposing twice answering identical bytes, two arms agreeing on a change's name, a
  confirmation minted in one arm refusing in the other, the domain refusals mapped to `not_found` and
  `not_allowed`, an order named either way reaching the same proposal, both order arguments and
  neither, the unpermitted identity refused before anything is resolved and unable to apply what
  another proposed, the missing actor and the unpublished actor version raising rather than refusing,
  reads still needing no actor, the apply redirecting the order and advancing the arm, the history it
  writes, the unproposed and the invented confirmation, applying twice moving the arm once and
  writing no second event, the conflict when the arm moved in between with the arm left where the
  other writer put it, the change re-proposed against the world as it now is, and a change applied in
  one arm invisible to the arm beside it and to the snapshot both came from.
- Contract tests (`test_sandbox_tool_api.py`) cover the published set naming its two write tools,
  the propose-then-apply pair over HTTP with the arm's revision moving once, the replayed apply, the
  unpermitted identity refusing at 200, the missing actor answering 422, the change that is no longer
  a change, and two competing proposals where the loser is refused as a conflict at 200 with the arm
  left where the winning write put it.
- Migration tests prove the proposal table's non-negative revision and its open-or-closed rule, and
  place it with the definition tables' migration fate.
- Frontend tests (`Snapshots.test.tsx`) cover the actor travelling beside the arguments rather than
  among them, no write leaving the console until an operator has said who is acting, only published
  identities being offered, a read asking for no identity, the apply
  carrying the proposal's own confirmation and the arms table moving with it, no second application
  being offered once a change is applied, and a conflict rendered as a refusal rather than an error.
- The Playwright scenario journey now continues past cloning: it reads the order in one arm, proposes
  the change under a published identity, applies it, and reads back that the arm beside it still
  ships to the address the incident is about.
