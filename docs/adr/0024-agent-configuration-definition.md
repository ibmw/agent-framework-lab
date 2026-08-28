# ADR 0024 — The agent configuration: the support agent as a versioned input

Status: accepted — 2026-08-28

Implements `docs/PLAN.md` Milestone 3's first three outcomes — draft/published agent configurations,
validation against proven adapter capabilities, and the separation of deterministic from live-model
tests — under the definition lifecycle of ADR 0012, the permission model of ADR 0014, the tool
contract set of ADR 0021, and the write protocol of ADR 0022. Records the
`agent-configuration-payload-v1` schema, the closed prompt-variable table and why customer, order,
and ticket facts are in it but never injectable, the proven-capability catalog and why it is declared
apart from the adapters, the publish gate that reaches outside the payload, the permission a write
tool now declares on its contract, and the preview resolution that travels with the gate.

ADR 0022 deferred exactly this: "An agent configuration selects tools, and configurations arrive in
Milestone 3. The adapter that registers them reads `effect` to know which need the two-step." ADR
0012 anticipated it earlier still, listing `agent_configuration` among the definition types and
fixing its one reference — exactly one support identity — before any of it was built.

## Context

Everything an experiment will compare is now a published version except the thing being compared.
A scenario freezes into a snapshot, a snapshot clones into arms, and an arm answers ten versioned
tools. The agent that works the arm, meanwhile, is composition-time configuration: `AgentRegistry`
picks a framework from an environment variable, the prompt is a string literal inside the adapter,
and the tool set is whatever the adapter happened to register. None of that can be published, pinned,
or read back to explain a past result — which is the whole point of the lab.

Milestone 3's acceptance criteria are that one published configuration can be selected for several
experiments, and that framework, model, prompt, tools, and architecture are explicit versioned inputs
rather than hidden composition defaults. This slice makes them that.

## Decision

### `agent-configuration-payload-v1`

A configuration holds everything that can change an agent's behavior and therefore has to be an
explicit input: `name`, `description`, `framework_id`, `architecture`, `support_identity_id`,
`prompt`, `tone_of_voice`, `tools`, `memory`, and a `model` of provider, model ID, temperature, and
tool-round limit. It is shop-independent (ADR 0012), and it names exactly one support identity, which
the codec derives as the payload's single definition reference — one source for the fact, as ADR 0012
requires.

Two smaller decisions inside it:

- **Temperature is a decimal, carried as a decimal string.** ADR 0007 admits no binary float into a
  canonical document, and this payload is fingerprinted like every other. It follows `Money` exactly:
  a `Decimal` in the domain with a `canonical_temperature` rendering.
- **The enabled tools are a set, normalized on construction.** Ticking the same boxes in a different
  order is the same configuration and must reach the same fingerprint, so the payload sorts them
  rather than leaving authoring order in the hash. This is a deliberate departure from the authored
  order that a support identity's permissions or a shop's guidelines keep, where the order is content
  a human reads back.

There is no field-sensitivity classification, for the same reason a support identity has none: every
leaf is operational. A configuration carries no synthetic personal data and no customer-only content
— and, by the rule below, structurally cannot.

### The prompt is a template over a closed table

`{{shop.name}}` stays a token until an experiment starts. That is what lets one configuration be run
against two shops and still be the same versioned input, and it is why the preview resolves rather
than rewrites.

The variables a prompt may name are a fixed table in the domain, in three groups. `shop.*` and
`support_identity.*` are injectable. `customer.*`, `order.*`, and `ticket.*` are **declared and never
injectable** — they appear in the table, in the editor's menu, and in the publish gate's vocabulary,
and a prompt that names one is refused with the reason:

> customer, order, and ticket facts are discovered through tools by design; how an agent discovers
> them is part of what an experiment compares.

Declaring them rather than omitting them is the point. An author who wants the customer's name will
look for it; finding it greyed out with the reason attached teaches the model of the lab, where
silence would only look like an oversight. And the rule protects the experiment itself: a prompt that
pre-injects the order ID erases the difference between an agent that found the order and one that was
handed it, which is precisely the difference a comparison exists to measure.

An unknown variable is an error too. The alternative — leaving it to resolve to nothing at run time —
would ship a prompt with a hole in it to a live model.

### Proven capability is a declaration, not the adapter registry

`agent_capabilities.py` declares, per framework, the architectures, providers, models, and
`AgentCapability` set the lab has actually run. It is deliberately not `AgentRegistry`:

- the registry answers *can this process run it right now*, which depends on an API key and an
  environment;
- the catalog answers *may an author publish it at all*, which must not change with the machine the
  Studio happens to run on.

A test asserts the two agree on capabilities, so a catalog that drifts from its adapters fails
loudly rather than misleading an author. This is the same shape as ADR 0021's separation of the tool
declarations from the handlers, and for the same reason: the gate reads a table, not an object graph.

A provider outside the framework's proven set is an **error** — nothing in the lab could execute it.
An unlisted *model* of a proven provider is a **warning** that names what has actually been
exercised: the lab cannot run every model of a provider it supports, and refusing one would be a
stronger claim than the evidence carries. Memory is checked the same way: `durable` memory asks for
`DURABLE_MEMORY`, which neither adapter proves, so publishing it is refused today and will stop
being refused on the day an adapter proves it — with no change to this rule.

### The gate reaches outside the payload

Three of the publish-gate rules are the surrounding world's answers rather than the content's, so
`AgentConfigurationService` overrides `_validate` the way `ScenarioService` does (ADR 0018):

- what the lab has proven the framework can do;
- whether every enabled tool is one the lab actually publishes; and
- whether the referenced support identity's **latest published version** grants what an enabled write
  needs.

The last one is the substantive addition. An agent bound to `orders.propose_address_change` under an
identity without `change_shipping_address` would be refused at its first call — a run whose failure
is a configuration mistake rather than agent behavior, and therefore evidence about nothing. The gate
knows that before the run starts, so it says so. The mirror case is only a warning: an identity
permitted to move an order, in a configuration with no tool that could, is a plausible deliberate
choice.

An unpublished support identity is reported as a gate error rather than left to explode inside
`_pin`, so the author reads it in the preview beside everything else.

### A write tool declares the permission it needs

`tool_without_permission` needs a tool-to-permission map, and until now only
`sandbox_actions.py` knew one, as a literal. `ToolContract` now carries `required_permission`,
declared where a write is declared, and the runtime reads the declaration instead of its literal. Two
callers ask the same question — the runtime refusing an unauthorized call, and the gate refusing a
configuration that could only ever produce one — and they now read one table. A read declares none:
ADR 0021 scopes a tool to one arm, so reading needs no permission to withhold.

It joins the published listing for the same reason ADR 0023 gave: the listing is the declaration
table rendered, and an adapter or a picker that had to infer the permission would be inferring
something the lab already knows. The snapshot fingerprint is unaffected — it hashes name to version
and nothing else — so no starting state moves and no migration follows.

### The preview resolves; it does not resolve *into* the draft

Beside the gate travels a resolution: every variable with what a chosen preview shop and the
identity's published version resolve it to, the effective tone-of-voice guideline, the versions a
publication would pin, and every published tool with whether this configuration enables it and
whether the identity could use it. It is `ScenarioService.resolve` applied one level up, and it
travels with the gate for the reason ADR 0018 gave: the two answer one question together.

Resolution reads **published versions only**. Publishing pins the latest published version of every
reference, so a preview computed from a draft would show an author values no experiment could ever
see.

The preview shop is a query parameter rather than a path segment, and the resolved values never enter
the payload. A configuration that stored what it resolved to would have quietly become a per-shop
artifact — the opposite of the thing that makes it reusable.

### A new draft can look, and cannot touch

Creating a configuration enables every read tool and no write. A draft with no tools would be refused
by its own gate before the author had written a word, and a draft that could redirect an order before
anyone chose to let it would invert the safety model the write tools were built on. The lab's own
starting model and framework come from the catalog, not the domain: which model is reasonable is lab
policy, and policy belongs beside the record of what the lab has proven.

### Persistence and the Studio surface

No migration. `agent_configuration` has been in both definition tables' type constraints since ADR
0012's schema landed, and the payload is stored as one canonical document by the same generic
repository every other definition uses. Only a codec and a factory are new.

The editor implements frame 5: identity, a markdown prompt whose tokens render as chips carrying
`name: resolved value`, a grouped variable panel with the non-injectable group disabled and its reason
stated, a selectable preview context, tone of voice, per-tool bindings marked with the permission a
write needs, and the model and runtime card — inside the shell's existing draft/published chip,
publish-gate, and change-summary conventions. The sidebar's inert "Agent configurations" entry becomes
the real section.

## Deliberately not here

- **The participant-driver port and its human implementation.** Milestone 3's remaining outcomes.
  They have no caller until the Milestone 4 runner, and a port designed against a hypothetical caller
  is a guess; the next slice delivers them with the runner that uses them.
- **Evolving `AgentAdapter`.** Same reason, and ADR 0011's rule: the port moves when a requirement is
  proven by the target scenario, not when a payload field is added that one day implies it.
- **Executing a configuration.** Nothing yet reads a published version and runs an agent from it.
  This slice makes the input; Milestone 4 consumes it.
- **Resolving the prompt for real.** The preview resolves for an author. The resolved prompt a run
  pins is run evidence, and it belongs with the runner that produces it.
- **A tone-of-voice override checked against a shop.** ADR 0012 puts that check at experiment setup,
  because the target shop is not known until then. The gate warns and says where the check happens.
- **A second architecture.** `AgentArchitecture` has one member. Adding one before an implementation
  exists would let an author publish a configuration nothing can run — the failure this whole slice
  is about preventing.
- **Per-tool read authorization.** Still deferred, still for the reason ADR 0021 gave.

## Verification

- Domain tests (`test_agent_configuration_domain.py`) cover the invariants a configuration cannot be
  built without, the temperature range and its two-digit limit, the tool-round bounds, the prompt
  length, the tone selection that cannot be both a default and an override, the variable scanner's
  names and spans, the unknown variable, the tool-discovered fact and the reason it carries, the
  empty prompt, the prompt that resolves nothing warning rather than failing, the agent bound to no
  tool, the override that warns about experiment setup, the set-valued tool selection reaching one
  fingerprint from two authoring orders, and the change summary naming the tools, memory, and runtime
  settings that moved.
- Payload tests (`test_agent_configuration_payload.py`) cover the canonical document, the decimal
  string that keeps a float out of the hash, the round trip, the fingerprint moving with content, the
  refused schema token, and the corrupted identifier and temperature naming their paths.
- Capability tests (`test_agent_capabilities.py`) cover the catalog agreeing with the registered
  adapters, the unproven framework, the unproven provider, the unexercised model warning, the memory
  mode no adapter has proven, and the two combinations that report nothing.
- Service tests (`test_agent_configurations.py`) cover the read-only starting draft, the derived
  support-identity reference and its moves, the identity that does not exist, the complete
  publication and the version it pins, the unrunnable framework, the unpublished tool, the write the
  identity may never use, the permission with no tool that warns, the unpublished identity, the
  preview resolving against a chosen shop and against none, the tool-discovered facts that resolve to
  nothing anywhere, the variables the prompt actually names, the versions a publication would pin,
  the write marked unusable, the frozen version surviving both its own draft and its identity moving
  on, the index row, and the resource lists a picker is filled from.
- Contract tests (`test_agent_configuration_api.py`) cover the created draft's defaults, the identity
  that does not exist, the decimal temperature over the wire and the two ways it is refused, the
  preview's gate and resolution together, the write marked unusable, the publication that pins the
  identity version and the frozen version surviving an edit, the unrunnable framework and the
  unusable write reported as findings, the tool-discovered fact refused, the index and version
  listings, the published resources, and the strict contract's refusal of an unknown field.
- Tool tests (`test_sandbox_tool_api.py`, `test_sandbox_tool_conformance.py`) cover the published
  listing carrying each write's required permission argument for argument, every write declaring one
  and no read declaring any, and — swept from the declaration rather than from a list — every write
  refusing an actor that lacks the permission it names.
- Frontend tests (`AgentConfigurations.test.tsx`) cover the index's framework, model, and publication
  state, each variable rendered as a chip with its resolved value, the tool-discovered fact's reason
  and its disabled insert control, insertion at the caret, the write marked unusable, the resolution
  read with a shop where the gate is read without one, and the save-then-publish sequence.
- The Playwright journey (`agent-configuration.spec.ts`) is the slice's acceptance evidence: an
  author publishes a shop and a read-only identity, creates a configuration that can read every tool
  and move none, is refused for injecting a customer fact, is refused for enabling a write the
  identity may never make, reads the prompt resolved chip by chip against the shop, publishes, and
  watches the draft move on while v1 keeps what it froze.
- No new live-model test. The catalog is checked against adapter declarations, not against a
  provider, so the whole gate runs offline; the existing `live_model` marker still separates the one
  suite that does not.
