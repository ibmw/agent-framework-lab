# ADR 0053 — A configuration names its provider; whether the lab can reach it is asked later

Status: accepted — 2026-09-19

Amendment: 2026-09-26 — "the same sentence belongs on experiment setup beside a disabled Start" is
extended to *every control that starts or derives an experiment*: setup's Start, and Replay and
Fork, on the results screen and on each history row. A replay or a fork runs its arms before it
answers — the derivation advances each arm as often as its source was advanced, in the one
transaction that starts it — so an arm naming a provider this lab cannot reach makes the whole
derivation answer 422 `agent_runtime_unavailable`, and nothing is stored — a control arm ahead of
the refusing one is still advanced first, and its spans are still exported. Each control is disabled
with the same sentence in `title` and in one muted line its `aria-describedby` names, drawn from the
same reachability read, which says nothing while it loads or when any read fails. The arms checked
are the ones the derivation would pin: the versions the source ran for a replay; for a fork, the
versions the operator has chosen in the results panel as the choice stands, or the newest
publications a history row's fork moves onto. The results screen reads a pinned arm's provider off
the experiment, which carries it; a history row, whose arms do not, and a fork arm moved onto
another version read the version itself. Two deliberate readings: an arm its source never advanced
is not advanced by the derivation either, so a derivation whose only unreachable arm is such an arm
succeeds here — and it is blocked anyway, because the run it produces holds an arm this lab cannot
advance, which is the state Start is blocked for. And no judge enters the check: a derivation starts
and drives its arms and scores nothing, so `judge_runtime_unavailable` is met only when somebody
scores the derived run, as for any other. It remains a note and never a finding: no gate sentence
and no `preview.issues` entry carries it.

Decides what `provider` on an agent configuration means once the lab's own connection becomes
editable (ADR 0052): that it stays authored rather than inherited, that publication and
reachability are two questions answered at two times by two authorities, and that an OpenAI-protocol
endpoint is a base URL rather than a new provider.

**It adds no field and no migration.** `docs/implementation-plan.md` scoped this as "additive
contract + migration + validation against the proven-framework table"; the field, the validation
and the editor's filtered select all already exist, and the first decision below is the correction.
What is genuinely undecided is where the *second* question is answered and what the editor may say
about it, which is the rest.

Written before the code, as `docs/implementation-plan.md` sequences it.

## Context

`ModelSettings.provider` has been part of the agent-configuration payload since ADR 0024, beside
`model_id`, `temperature` and `max_tool_rounds`, and it is pinned into every published version and
therefore into every run that names one. `capability_issues` in `agent_capabilities.py` validates
it against `PROVEN_FRAMEWORKS`, with the asymmetry ADR 0024 argued: a provider outside the
framework's proven set is an **error**, an unlisted model of a proven provider is a **warning**.
`judge_capability_issues` applies the same shape to `PROVEN_JUDGES` one port over. PLAN-UX Slice 6
shipped the editor's half — the provider select is filtered by the chosen framework's proven
providers, the model becomes a datalist of proven models, and changing the framework resets a value
that went off-list — and `lib/fieldRules.ts` mirrors the gate's three sentences with a test that
pins the copy to the Python that emits it.

So the table, the gate, the pin and the field are all in place, and none of them knows anything
about where this lab is currently pointed. That is deliberate and load-bearing:
`SupportAgentRuntimeRegistry`'s own docstring says why the catalog is kept apart from the registry
— *the catalog answers "may an author publish this", which must not change with the machine, while
this answers "can this process run it right now", which does.*

ADR 0052 makes the second answer movable at runtime. A lab can now be pointed at an endpoint, and
re-pointed while somebody is looking at the editor. That raises exactly one new question, and it is
not about the field: **what does the workspace owe an author who is about to publish a
configuration this lab cannot currently reach?**

## Decision

### The provider stays authored, and is never inherited from the connection

A configuration's provider is an experiment input, frozen at publication, and a run is explainable
years later because of it. If the field were inherited from the lab's connection, two arms compared
last month would describe themselves by where the lab points today, and a replay (ADR 0038) would
silently re-run somewhere else while claiming the same versions.

The same rule bars the softer version: **a new draft's default does not read the connection
either.** `DEFAULT_MODEL_SETTINGS` keeps naming the combination the lab has proven. A default taken
from the machine is a machine fact entering authored content at the one moment nobody is looking at
the field, and it would be indistinguishable afterwards from a choice.

### Publication and reachability are two questions, and this ADR moves neither authority

- **May this be published at all?** Answered by the publish gate from `PROVEN_FRAMEWORKS`, offline,
  identically on every machine. Unchanged.
- **Can this lab run it now?** Answered when an arm is advanced, by the registry composed from the
  resolved connection, as 422 `agent_runtime_unavailable` and never as a recorded turn — because a
  missing or mis-pointed credential is a fact about the installation, and writing it into a run's
  evidence would put the operator's machine into a comparison.

So, stated so that it does not have to be re-derived: **a configuration naming a provider the lab
is not currently pointed at is valid, publishable, and unrunnable here.** Publishing it is not a
mistake. An author may publish for a provider this lab will reach next week, and the version they
freeze is the same version anywhere else.

### The asymmetry is a standing rule, written down once

Error for an unproven **framework**, **architecture** or **provider**; warning for an unexercised
**model** within a proven provider; error for a **capability** the framework has not proven, which
is what memory modes and enabled tools consume. ADR 0024 argued each; this ADR records them as one
rule so the next reader who meets a field-level question answers it from here rather than from
taste.

The line the rule draws: the first three say *nothing in the lab could execute this*, which is a
statement about the lab's code. The fourth says *the lab has not exercised this combination*, which
an author may legitimately want to be the first to do — and the record will say which model ran, so
the evidence carries its own caveat. A refusal there would be a stronger claim than the evidence
supports.

### The editor says the lab cannot reach it, as a note and never as a finding

The workspace reads the provider ids the lab can currently reach — from ADR 0052's connection
resource — and says so beside the provider field when the chosen one is not among them:
*published configurations naming this provider cannot be advanced here until the lab has a
connection for it.* The same sentence belongs on experiment setup beside a disabled Start, on the
`PublishReasons` model, so that an operator meets it before composing a two-arm run rather than at
the first advance.

**It is not a publish-gate issue and must never enter `preview.issues`.** `preview` is the gate's
own answer about a draft, it is machine-independent by construction, and a machine fact inside it
would make two labs disagree about the same draft — which is the property that lets a version mean
the same thing wherever it is read.

It is also **not** one of the mirrored gate sentences. `lib/fieldRules.ts` holds copies of
sentences Python emits, pinned by `fieldRules.test.ts` to the modules that emit them; this sentence
has no Python original, because the gate does not and must not say it. It lives with the connection
vocabulary instead, and a test asserts it is absent from the pinned set — otherwise the next
reader will "fix" the missing original by adding one to the gate.

### An OpenAI-protocol endpoint is a base URL, not a new provider

This is the sentence that makes ADR 0052 and this one a single decision.

`openai` in `PROVEN_FRAMEWORKS` names the **protocol** the lab has proven both adapters against.
Ollama, vLLM, LM Studio, OpenRouter and Together answer that protocol, so pointing the lab at one
of them does not create a provider and does not make a configuration selectable that was not
selectable before. An author running a local Llama therefore selects provider `openai`, types the
model id the endpoint serves, and is warned — correctly — that the model is not one the lab
exercises. The run then records `openai`, the model, and the base URL it reached (ADR 0052), and
the three together are the truth. Provider alone would have named a vendor that was never called.

A **new provider id** — one that is not this protocol, such as an Anthropic-native or
Gemini-native seam — enters through `PROVEN_FRAMEWORKS` and nowhere else, which means an adapter in
this repository and a suite that keeps exercising it. Saving a connection is not evidence, and the
agreement test that keeps the catalog honest against the registry is the thing that would have to
be satisfied.

### The judge inherits all of it, unchanged

`JudgeModel.provider` against `PROVEN_JUDGES`, the same error-and-warning asymmetry, the same
refusal at scoring time with 422 `judge_runtime_unavailable` and never a recorded judgement, and
the same note in the judge editor from the same connection resource. Nothing here is special to the
agent side, and writing the rule twice in two ADRs is how the two surfaces drift.

## Deliberately not here

- **A new field, a contract change or a migration.** The field exists and is pinned by publication
  (ADR 0024). The correction is the deliverable.
- **Making an unreachable provider a publish error.** It would make a draft's validity depend on
  the machine reading it, which is the one thing the catalog/registry split exists to prevent.
- **A per-configuration base URL or key.** The endpoint is the lab's, the key is the lab's, and a
  configuration that carried either would be an authored input that is also a credential.
- **Selecting a *connection* on a configuration.** ADR 0052 holds one connection per provider, so
  there is nothing to select. If a second ever exists, the selector is an authored field and gets
  its own decision.
- **Inferring the provider from the endpoint.** A gateway serving four vendors behind one
  OpenAI-protocol URL would make that inference a guess, and the record would carry the guess.
- **Warning an author that the lab's *model* is not the one they typed.** The lab has no model;
  ADR 0052 keeps it off the connection for that reason.
- **Relaxing `AGENT_LAB_OPENAI_MODEL`'s typed literal.** It is the POC conversation routes' model,
  it is not what an experiment runs, and a slice that needs it loosened can say so.

## Consequences

Publishing gets no stricter and no looser. What changes is that an author can now be in a state the
lab could not previously produce — holding a valid configuration this installation cannot advance —
and the workspace names that state beside the provider field and beside every control that starts or
derives an experiment (the amendment above) instead of leaving it to the first 422.

The proven table keeps its meaning under a feature that could have eroded it: "proven" continues to
mean *there is an implementation here and a suite that exercises it*, not *somebody saved a URL*.

## Verification

- A table test over `capability_issues` and `judge_capability_issues` asserts the asymmetry
  member by member: unproven framework, architecture and provider are errors; an unexercised model
  of a proven provider is a warning that still publishes; an unproven capability behind a memory
  mode or an enabled tool is an error. These exist; this ADR pins them as the rule rather than as
  incidental coverage, and adds the publish-through assertion for the warning.
- The gate is asserted to be **unaffected by the lab's connection**: the same draft previews
  identically with a saved connection, with none, and with one for a different provider. That test
  is the guard on this ADR's central rule.
- An arm published against a provider the lab cannot reach is asserted to publish, and then to be
  refused at the advance with 422 `agent_runtime_unavailable` and no recorded turn. The judge's
  equivalent is asserted on the scoring path.
- `AgentConfigurations.test.tsx` and `JudgeConfigurations.test.tsx` assert the note appears beside
  the provider field when the lab holds no connection for it, disappears when one is saved, is in
  the control's accessible description, and does **not** appear in `PublishReasons` or anywhere the
  preview's issues are rendered.
- `fieldRules.test.ts` gains the negative: the unreachable-provider sentence is not in the mirrored
  set, and no Python module emits it.
- `ExperimentSetup` asserts the same sentence beside a disabled Start when a chosen arm's
  configuration names an unreachable provider.
- `make check` passes; `pnpm build` runs for the editor changes; no contract is regenerated,
  because none changes.

## Migration

None. No table, column, canonical document, fingerprint, tool contract, HTTP contract or
published-version semantics changes, and every configuration already published stays valid and
means what it meant.
