# Adding an agent framework

The lab runs two frameworks behind `SupportAgentRuntime` plus the declared control policy
(ADR 0026, ADR 0041). The rules below are what adding the second one actually took, plus what
running the two of them against one incident then found (ADR 0042); follow them when a roadmap
slice authorizes another.

1. Document the provider/model, local credentials, deterministic test double, and optional smoke-test
   policy before adding the SDK. Prefer a provider and model the lab already runs: a framework
   comparison that also changes the provider confounds itself.
2. Create `infrastructure/agents/<framework>/` and keep SDK imports local to that package. The
   isolation test sweeps a declared list of SDK packages against a declared list of allowed
   modules — add both, and note that the provider client an SDK speaks through counts as an SDK.
3. Implement `SupportAgentRuntime` — the port an experiment arm runs through (ADR 0026) — without
   expanding the contract to mirror a proprietary API. `AgentAdapter` is the POC's conversation
   port and is not what a new framework implements.
4. Derive the tool schema from `tool_json_schema`, which renders `sandbox_tool_contracts`, rather
   than writing one for this SDK. Every framework that speaks JSON Schema is handed the same
   document, so "both arms were offered the same tools" stays a property rather than a
   resemblance. If the SDK offers a *strict* schema dialect, check what it rewrites before
   enabling it: OpenAI's makes every property required, which advertises the lab's optional
   arguments as mandatory and changes what one arm is asked.
5. Render the tool *result* with `tool_result_text` and return the text, rather than handing the
   SDK the document and letting it serialize. Every SDK has its own rule and they disagree:
   Pydantic AI writes insertion-ordered JSON, and the OpenAI Agents SDK falls through to
   `str(output)` — a Python repr, so one arm's model read `{"applied":false}` where the other's
   read `{'applied': False}` (ADR 0042). Both are text an SDK passes along untouched, so one
   rendering makes "both arms were shown the same answers" a property in the same way the schema
   makes it one for the questions. Expect it to move an existing arm's model input as well as
   the new one's: sorted canonical text is not what either SDK was producing.
6. Map the arm's thread onto the SDK's message shape, and translate the SDK's failures into the
   runtime's classified errors. Never reach past the supplied invoker: it is bound to one arm and
   one actor, and it is what records the evidence.
7. Check what the SDK does with an exception a tool raises. One of them re-raises it as its own
   error type with the original on `__cause__`, which turns the lab's spent tool budget — a
   finding about the configuration — into a framework fault unless the adapter unwraps it. The
   lab's own errors must survive the framework they are raised inside.
8. Force serial tool execution, by whatever the SDK calls it. A write is guarded by the revision
   it was proposed against, and the recorded sequence is meant to be the order the agent asked.
9. Disable the SDK's own tracing. Several export spans carrying tool arguments and model output to
   a vendor endpoint by default. The lab records the three spans it opens itself and never sweeps
   a framework's instrumentation into the record, because it cannot promise the sanitization of an
   attribute it did not write.
10. Report usage through ADR 0032's neutral shape — the three counts every provider bills in, and
    nothing SDK-specific. A framework that does not meter itself reports `None`, which the record
    keeps as nothing. Never a zero: zero is what the control arm means.
11. Declare only the `AgentCapability` values a required suite actually exercises, and add the
    framework to `PROVEN_FRAMEWORKS` with the providers and models it is published for — the
    combinations an author may select and the live smoke tests are written against, which is
    what that half of an entry claims (ADR 0024, amended). Record in the ADR whether a live run
    has actually been made, and date it. A framework behind the runtime port alone declares fewer
    capabilities than the POC's conversation adapters do — the port answers with text, so nothing
    about it proves structured output.
12. Join the sweeps rather than adding tests beside them. `test_agent_runtimes.py`,
    `test_experiment_runs.py` and `test_live_model_runtimes.py` each assert their table against
    `PROVEN_FRAMEWORKS`, so a framework declared without an entry fails there rather than being
    quietly uncovered. Cover applicable success, transient-error/retry, business-refusal,
    confirmation, and resume paths with an injected offline model.
13. Check the judge anonymity sweep (`test_judge_independence.py`): it is parameterized from
    `PROVEN_FRAMEWORKS` and runs a real arm per framework, so its offline runtime registry needs
    the new one.
14. Emit the common OpenTelemetry spans and verify sensitive-data redaction.
15. Add the runtime to `create_support_agent_runtimes` and expose unavailability cleanly: a
    framework this process cannot run is refused when an arm is advanced, never recorded as a
    failed turn.
16. Document observed tradeoffs, limitations, transitive dependencies, and behavior in an ADR,
    including what the SDK does *differently* from the ones already here — the metering asymmetry
    between a tool-call allowance and a turn ceiling is the kind of thing a comparison needs
    written down.

A framework must not change the domain, public routes, stored session format, or UI. The Studio's
framework picker reads the capability catalog, so a new framework appears there without a
frontend change. If a capability is unavailable, the adapter declares it absent rather than
silently simulating it. A live-model call remains an opt-in smoke test and never replaces
deterministic evidence. Compare developer experience in a factual report covering glue code,
constraints, observability, and failures—never with a global score.
