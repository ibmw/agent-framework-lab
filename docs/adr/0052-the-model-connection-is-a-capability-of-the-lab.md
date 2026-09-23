# ADR 0052 — The model connection is a capability of the lab, and the lab holds it

Status: accepted — 2026-09-19

Amendment: 2026-09-22 — three sentences below are narrowed by what implementing them showed.

**The qualification is conditional on the variable holding key material.** "None of them carries
a usable credential" is true of a copied database only while `AGENT_LAB_CREDENTIAL_KEY` cannot be
guessed. The key is derived with HKDF-SHA256, which is the right construction over high-entropy
input and is not a password KDF: one hash per candidate, no work factor, and — with no salt — a
derived key that is the same function of the same input on every installation. An operator who
sets a memorable phrase therefore keeps the *process* protection this decision describes and
loses the *file* protection, which is the half this ADR uses to justify storing a secret at all.
Nothing in the lab enforces it, and a length check was considered and refused for saying more
than it can check: it would admit thirty-two identical characters and refuse a 22-character
base64 of 16 random bytes. So the condition is documented where an operator meets it —
`.env.example` mints one with `openssl rand -base64 32` — and stated here. Accepting a phrase an
operator can remember means `Scrypt` or `PBKDF2HMAC` and a per-installation salt inside the
stored envelope, which is a change to the stored format and so a slice of its own. **An empty
or blank value is treated as unset**, because the alternative is not a weak key but no key at
all: the environment delivers `AGENT_LAB_CREDENTIAL_KEY=` as an empty string rather than as an
absence, and a cipher built on it would key every installation alike on a value anybody can
derive — while writing ciphertext that persuades the operator otherwise, which is the precise
shape of the theatre this decision refuses a default for.

**"`/settings` states which of the two is in force" is served as four answers rather than
two**, because the chain has four and two of them are the same run mode. `getLabStatus` gains
`connection_source`, whose members are the saved connection, the environment bootstrap,
neither — and `saved_unreadable`, a saved connection whose key will not decrypt. That fourth
member exists because the decision above accepts that `key_configured` reports a key's
*presence* and never its readability, which is right for a page that must say nothing about a
secret and becomes a lie the moment run mode is computed from the resolution: a credentialed
lab over a key that cannot be opened is one where every advance refuses. So the saved
connection still wins — falling through to the environment would send the environment's key to
the endpoint the operator pointed somewhere else, which is the split this decision refuses —
and it wins as an **offline** lab, with a source that names the remedy, which is to save the
key again. The two run modes stay exactly the two ADR 0044 published. Two smaller consequences
of the same chain: a saved connection carrying **no key at all** is in force and credentialed,
because a local endpoint needs none and that is the case this decision exists for; and such an
endpoint is still reached with a placeholder string, `UNCREDENTIALED_API_KEY`, because the
OpenAI client refuses to construct without a credential and refuses an empty one — it is a
constant in this repository's source, carries nothing about the operator or the environment,
and is the same value the connection test sends.

**"`http` only for loopback and private hosts" is implemented narrower than it reads**, in three
ways, all deliberate. The root of the first two is that a standard library's "private" means *in
IANA's special-purpose registry*, which is not the same set as *on the operator's own network*:
classifying all 24 entries of CPython's table, all but two are either genuinely local, already
rewritten as IPv4 before the rule sees them, or not globally reachable at all, and the two that
are special-purpose **and** carry a packet off the machine in the clear are subtracted here.
Link-local is one: `169.254.169.254` is the cloud instance-metadata address, `POST …/test`
makes a server-side call to what it is handed from an unauthenticated route, and nothing is
hosted on a link-local address on purpose. The IETF protocol assignments `2001::/23` are the
other, subtracted whole rather than by the teredo `/32` inside them: IANA marks seven blocks in
that range Globally Reachable — PCP, TURN and DNS-SD SRP anycast, AMT, AS112-v6, ORCHIDv2 and
DET — and teredo's own packets tunnel over UDP to an ordinarily public IPv4 relay, so any of
them would carry a typed key off the machine in plaintext, which is the single outcome this
rule exists to prevent. The block's two non-reachable members, IPv6 benchmarking and deprecated
ORCHID, are refused with them at no cost to anybody. And a *name* is
admitted only for `localhost` and `*.localhost`, because a name's privacy is knowable only by
resolving it and resolving would make a stored, run-pinned value depend on the DNS of the moment
it was saved — so `http://ollama.internal/v1`, a Compose service name and `http://gpu-box.lan`
are all refused, which is the commonest self-hosted spelling after `localhost` and is the real
cost of the rule. Every path out is unchanged in all three cases: https to any host, or an
address on the network the lab is actually on.

Moves the provider connection — which provider, at which base URL, under which key — out of the
process environment and into the lab's own database, editable from `/settings`, resolved at the
moment an arm is advanced rather than at start-up, and pinned onto the run that reached it.

Records seven decisions and one qualification. That a connection is a *capability of the lab*
rather than the stored operator state ADR 0044 refused, and that the half of 0044 which refused a
credential form is reversed while the half that refused a preferences table is not. That a
connection is keyed by the provider id the proven-framework table already uses, so the OpenAI
protocol's other endpoints — Ollama, vLLM, a gateway — are base URLs and not new providers. That
the record holds no model. That the key is encrypted at rest with a key the environment supplies
and is never served back in any form, not even masked. That the environment stays the bootstrap.
That composition moves from start-up to the request, so run mode stops being a property of the
process. And that a run pins the endpoint it reached, refusing an advance that would reach a
different one. The qualification is what encryption at rest here does and does not buy.

Written before the code, as `docs/implementation-plan.md` sequences it: this decision and ADR 0053
precede the milestone's contracts, migration and UI.

## Context

Everything about reaching a model is composed once, from the environment, and cannot be changed
without a shell and a restart. `Settings` (`infrastructure/config.py`) carries
`openai_api_key: SecretStr | None` and `openai_model: Literal["gpt-5-mini"]`, and **no base URL at
all** — the string that would let this lab talk to anything other than OpenAI's own endpoint has
never existed. `create_app` builds three registries from those settings and holds them for the
life of the process: the POC's `AgentRegistry`, `create_support_agent_runtimes` for experiment
arms, and `create_judge_runtimes` for scoring. Each registers its model-backed members only when
`settings.openai_api_key is not None`, which is why an offline lab can advance the deterministic
control and nothing else, and why an arm published against a framework this process cannot run is
refused at the advance with 422 `agent_runtime_unavailable` and never recorded as a turn.

ADR 0044 built `/settings` on top of that arrangement and made it a read-out: run mode, the
configured model name, trace export, and the proven-capability table. It refused a field for the
key "outright", and it refused a `lab_settings` table. The page still says so on screen — *set
`AGENT_LAB_OPENAI_API_KEY` and restart the API to change it.*

Three things have changed the shape of the question since.

The first is that the endpoint, not the SDK, is now what varies. Both experiment frameworks build
an OpenAI-protocol model (`create_openai_model`, `create_openai_agents_model`), and that protocol
is what Ollama, vLLM, LM Studio, OpenRouter and Together all answer. A lab that could set a base
URL could run an arm against a local model with no credential leaving the machine. A lab that
cannot set one is restricted to a single vendor's endpoint by the absence of one string.

The second is that the operator ADR 0044 was written for does not have the terminal. That ADR
placed `/settings` outside shop scope for the first-run reader's sake, and then gave that reader a
page whose answer to *this lab cannot reach a model* is a shell command and a restart.

The third is that the refusal's stated ground does not survive re-reading. ADR 0044 refused the
field because storing the key "would mean this application storing a provider secret in its own
database, which `docs/observability.md` forbids it from so much as recording". `observability.md`
forbids **recording secrets in spans and logs** — it is a rule about what leaves the process as
telemetry, and it is not a rule about what the lab may hold. The strong half of that sentence is
still right, and is kept whole below; the inference from it to the database was too wide.

## Decision

### A connection is a capability of the lab, which is not what ADR 0044 refused

ADR 0044 refused two distinct things under one argument, and they separate cleanly.

It refused a `lab_settings` table for **per-viewer view state** — the rail's collapsed default and
the last-visited shop — on two grounds: that it would put view state into the database whose every
other row is evidence an experiment pins, and that there is no user to key a preference to.
**That refusal stands untouched.** Those two preferences stay in `localStorage`, ADR 0046's note
about the stale `agent-lab.guide-mode` key stays true, and nothing here gives them a row.

It refused **a credential form**, on the observability reading corrected above. That refusal is
reversed. What survives from it, exactly and without softening, is the rule the reading was
reaching for: **the key is never logged, never traced, never served, never echoed in an error, and
never written to a canonical document.** ADR 0044's own narrow payload rule for `getLabStatus` —
no prefix, suffix, length or hash of a secret — is inherited rather than relaxed, and is applied
below to a key the operator typed themselves.

The distinction that lets both hold, and the sentence a later reader should find here: 0044 refused
to store **how far the operator had got and how they like their rail**, which is state about a
person the lab has no notion of; this stores **what the lab can reach**, which is a property of the
installation, the same kind of fact as the database URL. A connection is therefore also **not a
definition**: it has no draft, no published version, no canonical document and no fingerprint, and
it must never enter a resolution or sandbox fingerprint (ADR 0007, ADR 0005). A snapshot resolved
last week describes the same starting state today whatever the lab is now pointed at; a fingerprint
that moved when an endpoint moved would make every stored comparison unreadable for a reason that
has nothing to do with the experiment.

### One connection per provider, and a preset is an endpoint rather than a provider

The record is keyed by the provider id the lab already uses — the `providers` entries in
`PROVEN_FRAMEWORKS` and the `provider` of `PROVEN_JUDGES`. Today those are `openai` and `fake`, and
`fake` reaches nothing, so **a lab holds at most one connection**: the mock's "one connection per
lab" is true, and true for a reason that generalises rather than as a limit somebody imposed.

`openai` names **the protocol the lab has proven it can speak**, not the company. Ollama, vLLM,
OpenRouter and Together speak it; they are base URLs. They are therefore *not* new rows in
`PROVEN_FRAMEWORKS`, and saving a connection pointed at one proves nothing about the lab's ability
to run it — proving is what a suite does, and ADR 0053 keeps that door where it is. The presets the
mock draws (OpenAI, Ollama, vLLM, OpenRouter, Together, Custom) are a prefilled base URL and a
label. They live in the frontend (`lib/modelConnections.ts`), carry no contract change, and Custom
is the general case the other five are conveniences for.

This is what makes the record honest rather than merely permissive: a run against a local Llama
records provider `openai` **and the base URL it reached**, and the two together say what happened.
Provider alone would have been a lie.

### What the record holds, and the one field it refuses

`model_connections`: `provider_id` (primary key), `base_url`, the encrypted key and its
`key_added_at`, `created_at`, `updated_at`. And **no model.**

The model is authored content. Both runtime factories already say so where they construct a model
from a lambda — *the model comes from each arm's published configuration, not from this process:
what an experiment ran is an authored input (ADR 0024), and a runtime that substituted the
environment's model would make two arms unexplainable* — and a model on the connection would be
that substitution wearing a friendlier hat. This is a deliberate **departure from the mock**, which
puts a model on the connection. The consequence for `/settings` is that its "Configured model"
read-out is relabelled to what it actually is, the model the POC conversation routes would reach
for, so it cannot be read as the model an experiment runs.

`base_url` is validated at the door, and that validation is what makes the value safe to display
and to pin:

- `http` or `https` only; no userinfo, no query string, no fragment;
- `http` only for loopback and private hosts, so `http://localhost:11434/v1` is accepted and a
  plaintext key crossing the internet is not;

  > Narrowed by the amendment of 2026-09-22. Link-local is refused although the standard
  > library counts it as private, and among *names* only `localhost` is admitted. The
  > amendment says why, and what it costs.

- stored normalized, so two spellings of one endpoint compare equal when a run is pinned to it.

ADR 0044 refused to serve the OTLP endpoint because "a collector URL is a place a deployment can
put a token, and a route that serves it is a route that serves that token the day somebody does."
That reasoning is sound about a string nothing parses. It is answered here by **removing the place
the token could sit** rather than by hiding the value: a URL carrying userinfo or a query is
refused with 422 before it is stored. The OTLP endpoint is unchanged and still not served; it is
process configuration this application never parses, and the argument above does not reach it.

### The key is encrypted at rest, and no fact about it is ever served

The API gains `cryptography` as a dependency and stores the key under AES-GCM with a key derived
from `AGENT_LAB_CREDENTIAL_KEY`. **With no such variable set, saving a key is refused with 422**
and the environment bootstrap below keeps working. Deliberately unlike `telemetry_hash_salt`, which
carries a local development default, there is no default here: a shipped default encryption key is
encryption theatre, and theatre is worse than the plain refusal because somebody would believe it.

> Narrowed by the amendment of 2026-09-22. The first sentence below holds only while
> `AGENT_LAB_CREDENTIAL_KEY` carries key material rather than a memorable phrase, because HKDF
> is not a password KDF. The amendment says what a phrase costs and what accepting one would
> take.

What this buys, said plainly so that nobody has to infer it: a copy of `var/agent-lab.db`, a
backup, a file dropped into a bug report, a checkout shared between machines — none of them carries
a usable credential. What it does not buy: anything at all against someone who can run this process
or read its environment, which is the same person. Tenancy and authentication are still deferred
(`docs/decisions-and-next-step.md`), so the connection is exactly as protected as the API is, which
today means it is protected by the network it is bound to.

**The route serves no fact about the key.** Not the value, not a prefix or a suffix, not a length,
not a hash, not a mask. The response carries `key_configured: bool` and `key_added_at`. This is a
second **departure from the mock**, which serves a mask and an added-date, and it is ADR 0044's own
rule applied consistently to a key the operator typed instead of one the environment supplied: a
masked key is a fact about a secret, served over an unauthenticated route, to distinguish two keys
that an operator can distinguish by re-saving. The cost is named rather than hidden — an operator
who has forgotten which key is installed cannot tell from this page, and their path is to save the
one they mean.

### The environment stays the bootstrap

Per provider, in order: **the saved connection; else `AGENT_LAB_OPENAI_API_KEY` with the provider's
default base URL; else offline.** A saved connection wins.

This is what keeps a fresh checkout, CI and `make seed` working unattended — though the seed reads
neither, because it composes its own scripted runtimes offline and deliberately reaches no
provider. It is also what keeps the test environment's short-circuit ahead of everything:
`settings.environment == "test"` still selects the SDK doubles before any of this is consulted.

`/settings` states **which of the two is in force**, because a lab holding both a saved connection
and an environment key otherwise answers in a way neither one explains.

### Composition moves from start-up to the request

`create_app` calls `create_support_agent_runtimes(settings)` once. A connection that can change
while the process runs cannot be read there, so the three factories take a **resolved connection**
instead of `Settings`, and `create_app` holds a factory rather than a registry. All three move
together — including the POC's `AgentRegistry` — because a lab pointed at Ollama that still sent
the POC's conversations to OpenAI would be a split nobody would predict from the settings page.

Three consequences are worth writing down before they are discovered:

- **Run mode stops being a property of the process.** `getLabStatus`'s `run_mode` becomes a
  per-request answer computed from the resolution above. The offline qualification ADR 0044 placed
  on that page is unchanged in wording and in force; what changes is that it can now stop being
  true without a restart.
- **The injection points stay.** `create_app(agent_runtimes=…, judge_runtimes=…, agent_registry=…)`
  keeps accepting a registry and treats it as a fixed factory, so the suites that supply a failing
  runtime do not change.
- **A connection is read per advance, not per turn inside one.** One advance resolves once and
  runs to completion against what it resolved, so a save landing mid-advance cannot move the
  endpoint underneath a model call.

### A run pins the endpoint it reached, and refuses to be advanced against another

Two-thirds of the mock's "a recorded run keeps provider, base URL and model" is already true and
was true before this ADR: a run names `agent_configuration_id` and `agent_configuration_version`,
and an immutable published version carries the provider and the model. Saying which third is new
matters, because a reader who believes the whole sentence is new will add columns that duplicate
the version and can disagree with it.

The new third is the endpoint. `experiment_runs` gains `model_base_url`, nullable, written on the
first advance that reaches a provider; null means no provider was reached, which is the honest
record for the deterministic control. `experiment_judgements` gains the same column on the same
rule, because a judge reaches a provider too (ADR 0031).

**An advance that would reach a different endpoint than the one the run is pinned to is refused**
with 422, naming both. Half an arm produced against one endpoint and half against another is a
record nobody can read, and the lab's existing instinct here is right: an arm this process cannot
run correctly is refused at the advance and never recorded as a turn. The operator's path is the
one the lab already has — fork the experiment (ADR 0039) or start a new one — and the fork's
derivation record then says why there are two.

### Testing a connection is a question about a moment, and its answer is not stored

`POST /api/v1/model-connections/{provider}/test` takes the connection to test in its body — the
base URL and, optionally, a key, falling back to the saved one — so an operator can check what they
have typed before saving it. It makes one cheap call under a short timeout and answers a classified
outcome: `reachable`, `refused` (the endpoint answered and rejected the credential), or
`unreachable`, with the round trip in milliseconds.

It stores nothing. A reachability result is true of a moment, and a stored green tick would be read
as a promise the lab cannot keep. It **never echoes the upstream body**, only the classification
and the HTTP status class: a provider's error text is a string this lab did not write and cannot
promise the contents of, which is the same rule the tool results follow when they refuse to
describe a failure in the provider's words.

## Deliberately not here

- **A model on the connection.** The model is an authored input; see above.
- **Several connections per provider, or named connection profiles.** One key per provider is what
  a run needs to be explainable. A second would need a selector on the configuration, which is an
  authored field, which is ADR 0053's subject and not this one's.
- **A connection for a provider the proven table does not know.** A connection is where a key
  lives, not a claim that the lab can run something. ADR 0053 keeps that door.
- **A read route for the key, a mask, or a reveal control.** Above.
- **Rotating or versioning the encryption key.** Re-saving the key is the rotation path, and a
  lab holding one credential does not need a second mechanism to replace it.
- **Per-user credentials.** There is no user. Tenancy is deferred.
- **An editable OTLP endpoint.** ADR 0044's refusal stands. The validation argument that makes a
  provider base URL safe to serve does not transfer to a string the lab hands to an exporter and
  never parses.
- **A per-shop or per-experiment connection.** The connection is a property of the installation.
  What an experiment ran is its pinned versions plus the endpoint recorded on the run.
- **Anything else in `model_connections`.** It is not the settings table ADR 0044 refused, and it
  stops being that the moment a second unrelated column is added to it.

## Consequences

`/settings` gains its first setting that is not a browser preference (*The fast path* already
writes to the lab, as an action rather than a setting; ADR 0047), and the page's
character changes with it: ADR 0044 called it a surface that "reports composition and never edits
it", and that sentence is now true of three of its four cards instead of four. The qualification
belongs in that ADR's record when this lands.

Run mode becomes a question with a per-request answer, so a lab can go from offline to credentialed
while an operator is looking at it. The offline qualification's wording is unchanged; its
*duration* is now the operator's business.

The API takes a new dependency, `cryptography`, for exactly one purpose. It is the first secret the
lab stores rather than reads.

## Verification

- The connection round-trips: a saved connection is read back with its base URL and
  `key_configured`, and the response model is asserted to carry **no** field derived from the key —
  the same assertion shape ADR 0044 wrote for `getLabStatus`, extended to a key the operator
  supplied.
- Base URL validation is a table: userinfo, a query, a fragment, a non-HTTP scheme and plain `http`
  to a public host are each refused with 422 naming the field; `http://localhost:11434/v1` and an
  `https` public endpoint are accepted; two spellings of one endpoint normalize to one value.
- Saving a key with no `AGENT_LAB_CREDENTIAL_KEY` is refused with 422, and the refusal names the
  variable. With one set, the stored column is asserted **not** to contain the plaintext.
- Resolution is asserted in all four states: saved connection alone, environment alone, both (the
  saved one wins and the page says so), neither (offline). The test environment's short-circuit is
  asserted to precede all four.
- Run mode is asserted to change between two requests to one process when a connection is saved,
  which is the assertion that fails if composition stays at start-up.
- An advance against a run pinned to another endpoint is refused with 422 naming both, and no turn
  is recorded — the existing `agent_runtime_unavailable` assertions are the model. A first advance
  writes the endpoint; a control arm's stays null.
- The connection test is asserted to classify all three outcomes, to store nothing, and never to
  include the upstream body in its response.
- A sweep asserts no span, log line or error payload carries the key or the ciphertext, in the
  spirit of the telemetry allowlist tests.
- Contract tests cover the four new operations and their regenerated types; `make contracts` output
  is reviewed rather than accepted.
- `make check` passes; `pnpm build` runs for the settings page; the Playwright suite runs, and
  `workspace-shell` covers saving a connection and reading the page back.

## Migration

One table, `model_connections`, and one nullable column on each of `experiment_runs` and
`experiment_judgements` (`model_base_url`). Alembic revision `0021`, additive in both directions.

Existing rows keep a null endpoint, which is the truthful record: they were produced before the lab
knew where it was pointed. The results surface renders that as *endpoint not recorded* and
deliberately not as *offline*, because the two are different facts and only one of them is known.

No canonical document, fingerprint, tool contract or published-version semantics changes. A lab
that never opens `/settings` behaves exactly as it does today, on the environment alone.
