# ADR 0021 — The versioned read tools: what an arm is allowed to ask

Status: accepted — 2026-08-25

Implements `docs/PLAN.md` Milestone 2's read-tool outcome, under ADR 0011's tool-first rule, the
field-sensitivity classification of ADR 0014, the canonical snapshot of ADR 0019, and the clone of
ADR 0020. Records the first published tool contract set, the `tool-result-v1` envelope, the rule
that decides what a tool may serve, the difference between a refusal and an error, and the entry of
the tool versions into the sandbox fingerprint.

ADR 0020 deferred exactly this: "Versioned read tools consume a sandbox and arrive with Milestone
2's tool outcome. They are the first reader of `state` through a tool contract."

## Context

An arm receives a customer message and a minimal resource reference — an origin kind plus at most
one identifier (ADR 0016, ADR 0019). Everything else it knows, it has to ask for. That is the whole
premise of ADR 0011's tool-first simulation: a prompt that embedded the order, the catalog, and the
policies would be testing prompt assembly rather than agent behavior, and two frameworks compared
that way would differ mostly in how much of the world was handed to them for free.

Until this slice the asking had nowhere to land. A snapshot froze the starting state, a clone made
it mutable per arm, and `SandboxService` opened a write seam — but nothing could read a sandbox
except an operator looking at a JSON projection of it. The `tool_contracts` section of
`fingerprint_sandbox_snapshot` has been present and deliberately empty since ADR 0019, waiting for a
tool set to name.

## Decision

### A tool reads an arm, not a shop

Every handler is given a resolved context and nothing else: the arm's own mutable commerce state,
plus the exact published shop, ticket, and customer-profile versions its snapshot pinned. No tool
accepts a shop, a definition, a version, or a fingerprint as an argument.

Two properties follow from that shape rather than from a rule anybody has to enforce. An arm cannot
address a world other than its own, so ADR 0020's isolation extends to the readers automatically —
a write in one arm is invisible to the tools of the arm beside it. And a historical run stays
explainable: the tools answer from the pinned versions however far the authoring surface has moved
on since, so a policy edited today does not retroactively change what an agent could read last week.

### The eight tools, and why these

One tool per question the wrong-address incident actually makes an arm ask, and none beyond it —
ADR 0011's "add concrete capability before generalizing a speculative abstraction", applied to the
tool surface:

| Tool | Answers |
| --- | --- |
| `interaction.read_context` | Where the conversation started, and the ticket thread it belongs to |
| `catalog.search_products` | Which products match a handle, title, or category |
| `catalog.read_product` | One product: options, variants, availability, prices, reviews |
| `customer.read_profile` | The customer's account facts and saved addresses |
| `orders.list_orders` | The orders this customer holds in this shop |
| `orders.read_order` | One order: lines, totals, payment, fulfilment, address, events |
| `support.search_knowledge` | Which policies, guidelines, or FAQ entries mention something |
| `support.read_document` | One support document in full |

A search and a read sit beside each other wherever a collection is large enough that an agent has to
find something before it can quote it. The three document collections are served through one
uniform record — a policy's title and body, a guideline's title and body, and an FAQ entry's
question and answer are the same two ideas under different names — addressed by the reference
grammar a scenario already uses (`policy:shipping`), so an objective's read-check and a tool lookup
name the same document the same way (ADR 0017, ADR 0018).

`interaction.read_context` resolves an order-page origin to the order *reference* beside the
identifier the snapshot froze. That is what makes the milestone's acceptance criterion true with no
prompt copy: "this order" or "this product" is an identifier in the starting state and a second tool
call away from being a document.

Tone-of-voice guidelines are deliberately not readable. They configure how an agent speaks and reach
it through its published agent configuration (Milestone 3), not as knowledge it looks up.

### What a tool may never serve

The visibility rule is not new; it was written down in ADR 0014 and had no reader until now. A
`CUSTOMER_ONLY` field is "simulation-side content the support agent must never see". The support
agent is exactly who reads a tool result, so **no projection reads a `CUSTOMER_ONLY` field** — not
the behavioral persona, not the profile's hidden facts, not a scenario's hidden facts.

`SENSITIVE` is a different rule and must not be confused with it: those are synthetic personal data
that may never reach a log line, a span, or an error message, and serving them to the agent is the
entire point of a support simulation. An address, an account note, and a message body appear in full.

The exclusion is structural — a projection that never reads a field cannot leak it — and it is also
swept: one test runs every tool against an arm whose persona and hidden facts carry marker strings
and asserts that none of them appears in any canonical result.

No projection carries a definition version, a content fingerprint, a shop identifier, or the arm's
revision either. An agent reads the world, not the machinery that froze it.

### A refusal is a value; an unknown tool is not

`docs/api-and-schema-conventions.md` requires a tool result to distinguish domain success, refusal,
and technical failure. The three are kept apart by what they say about who was wrong:

- **`success`** — the tool answered.
- **`refused`** — the tool understood the question and declined it. "This customer holds no order
  NS-00000" is a fact about the world that an agent has to reason about, so it comes back as a
  result rather than as an exception, and over HTTP as a 200 rather than a 404.
- **`failed`** — the lab broke. The *result* carries no message, deliberately: an exception's text
  would put internals into a transcript that an agent, a judge, and a trace can all read. A handler
  that raises fails its call instead of ending a run, and the outcome makes it legible as the lab's
  fault rather than as agent misbehavior.

  A failure the operator cannot see would be the opposite mistake, so the service logs the tool that
  broke and the exception type that broke it. It logs neither the message nor the traceback:
  `AGENTS.md` forbids logging raw customer content and nothing can promise an arbitrary exception's
  text carries none, which is the same reason the sanitized spans record an error as `error.type`
  and never as what it said. Eight small pure handlers and a type name are enough to locate a bug;
  a message that might quote an address is not worth the exception to the rule.

**Argument mistakes are refusals**, which is the less obvious half. In a run the arguments are model
output; an agent that misnames its own argument, sends both `order_reference` and `order_id`, or
sends neither must be able to read what it did and try again. Blank text counts as absent for the
same reason: an argument filled with an empty string is a model declining to answer it, and treating
it as a value would send the handler looking for an order called `""`.

**An unknown tool name or version is an error, not a refusal.** It is a contract mistake rather than
a question about the world: a framework adapter offers a run only the tools it registered, so a name
that reaches the service came from a client reading a contract that no longer says what it thinks.
It answers 404 `tool_not_found`.

There is no `not_permitted` refusal. A sandbox holds exactly one customer's whole order set
(ADR 0019), so "not one of theirs" and "no such order" are the same answer here; authorization
refusals arrive with the address-change action, which is the first operation with permissions to
enforce.

### `tool-result-v1`

```
canonical_schema_version   "tool-result-v1"
tool, version              which contract answered
arguments                  the ones the handler actually saw, trimmed, absent ones dropped
outcome                    success | refused | failed
data                       the tool's own canonical document, or null
refusal                    code and message, or null
```

Every handler answers with a `CanonicalValue` document, so the same call against an unmoved arm
produces the same bytes. That is what Milestone 5's evidence will rest on; this slice only has to
make it true, and a test asserts it.

The HTTP envelope is that document plus its provenance, and a test asserts exactly that equality, so
the rendering a client reads and the rendering Milestone 5 will hash cannot drift apart field by
field.

**The arm's revision is outside the document**, and travels beside it in the HTTP envelope. A
revision is where the arm stood when it answered rather than part of the answer — the same reasoning
that keeps a label and a revision out of a clone's own fingerprint (ADR 0020). It is published
because it is the token the next writer presents: the safe address-change action reads through a
tool and writes against the revision that read saw.

### The tool contracts enter the sandbox fingerprint

`SANDBOX_TOOL_CONTRACT_VERSIONS` is no longer empty; it is the registry's name-to-version map.

An arm that can read the shop's policies begins in a different world from one that cannot, so the
published tool set is part of a snapshot's identity rather than a property of the runtime that calls
it. The consequence is deliberate and needs no migration: a snapshot **is** its fingerprint
(ADR 0019), so re-materializing a scenario now produces a new snapshot beside the old one, and
snapshots frozen before this slice remain readable and remain identified by exactly what they froze.

The declarations live in `sandbox_tool_contracts`, apart from the handlers in `sandbox_tools`, for
one reason: the fingerprint reads the declaration, and importing the implementations would drag the
handlers, their repositories, and the sandbox they run against into the materializer. A registry
check at import refuses a declared tool with no handler, so a published contract that nothing
answers cannot ship.

### Arguments are text, described in the lab's own vocabulary

Every argument is a string, of kind `text`, `uuid`, or `enum`. The lab has no numeric or nested tool
argument yet, and a string-only argument space keeps the canonical serialization of a call trivial.

The published contract describes arguments as a typed table rather than as JSON Schema. A framework
adapter generates whatever dialect its SDK wants from that table when Milestone 3 needs one, and the
Studio renders a field from the same description — one source of truth instead of a schema authored
twice and drifting.

### Public contract

`GET /tools` publishes the contract set itself, because a tool contract is versioned public API in
its own right and because a snapshot fingerprints itself against exactly this list. It carries a
version per name rather than one version for the set: a tool is versioned individually and one of
them can move alone.

`POST /shops/{shop_id}/sandboxes/{sandbox_id}/tool-calls` runs one tool against one arm. It is a
POST because a call carries structured arguments, not because it changes anything — every tool here
is a read, and the sandbox still has no public writer.

The tool's payload travels as an opaque canonical document. Its shape belongs to that tool's own
versioned contract; restating eight payload schemas in the OpenAPI envelope would create a second
source of truth that drifts the first time one tool moves.

### The Studio surface

Frame set: none — the design direction has no tool frame, so the console lives on the snapshot page
beside the arms it reads, under the shell's resource conventions.

Selecting an arm opens a console that runs any published tool against it and shows the outcome, the
result document, and the revision the read happened at. It exists because this is where a sandbox
stops being a fingerprint and becomes a world someone can interrogate: an author can check that the
stale address, the shipping policy, and the ticket thread are all reachable — and that the persona
and the hidden facts are not — before any agent is pointed at it.

## Deliberately not here

- **The safe address-change action.** It is the next outcome of this milestone and the first public
  writer, and it is what will map `SandboxRevisionConflictError` onto the contract.
- **Recording tool calls as evidence.** A result is canonical so that it *can* be recorded, but the
  normalized event stream that says which arm called what, when, and in what order is run evidence
  and belongs with the runner (Milestone 4).
- **Exposing the tools to a framework.** An agent configuration selects tools, and configurations
  arrive in Milestone 3. The adapter that registers them derives its schema from the published
  argument table.
- **Per-tool authorization.** Every tool here is a read over one customer's own world. Permissions
  become meaningful when a support identity's role can withhold one (Milestone 3) and when a write
  can be refused (the next slice).
- **Pagination.** The searches cap their results and report both the total match count and whether
  they truncated, so a capped list never reads as a complete one. A shop large enough to need
  cursors does not exist yet.

## Verification

- Tool tests (`test_sandbox_tools.py`) cover each tool's answer, the two-call chain that resolves a
  product-page origin without a prompt copy, the sweep proving no tool discloses a `CUSTOMER_ONLY`
  value, the refusals for an unknown product, an unknown order, both order arguments, neither, an
  unparseable identifier, an undeclared argument, and a value outside an enum's choices, the blank
  argument read as absent, a write in one arm being invisible to the tools of the other, a tool
  reading the pinned version rather than the draft that moved on, the canonical result repeating
  byte for byte, the HTTP envelope equalling the canonical document plus its two provenance fields,
  the unknown tool and unknown version raising rather than refusing, and a broken handler failing
  without describing itself in the result *or* in the log while still naming its tool and its
  exception type there.
- Materialization tests assert that a snapshot records the tool set it was frozen against.
- Contract tests (`test_sandbox_tool_api.py`) cover the published tool set and its argument tables,
  a successful call reporting the arm's revision and fingerprint, the interaction reference resolved
  through a second call, a refusal answering 200, an unknown tool and an unknown version answering
  404, an arm of another shop answering 404, and the customer tool withholding the simulation side.
- Frontend tests (`Snapshots.test.tsx`) cover the console sending the call the contract describes,
  rendering a refusal as an answer rather than as a failure, asking a required enum to be chosen
  rather than offering to leave it open, and dropping an in-flight result whose tool is no longer
  the selected one.
