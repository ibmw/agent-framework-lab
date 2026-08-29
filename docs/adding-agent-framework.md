# Adding an agent framework

Agent-framework expansion is deferred until the Simulation Studio domain and first target scenario
are stable. See `docs/product-direction.md`, ADR 0011, and the current `docs/PLAN.md`. The rules below
still apply when a roadmap slice authorizes another adapter.

1. Document the provider/model, local credentials, deterministic test double, and optional smoke-test
   policy before adding the SDK.
2. Create `infrastructure/agents/<framework>/` and keep SDK imports local to that package.
3. Implement `SupportAgentRuntime` — the port an experiment arm runs through (ADR 0026) — without
   expanding the contract to mirror a proprietary API. `AgentAdapter` is the POC's conversation
   port and is not what a new framework implements.
4. Derive the tool schema from `sandbox_tool_contracts` rather than authoring it, map the arm's
   thread onto the SDK's message shape, and translate the SDK's failures into the runtime's
   classified errors. Never reach past the supplied invoker: it is bound to one arm and one actor,
   and it is what records the evidence.
5. Declare only the `AgentCapability` values proven by the shared conformance suite, and add the
   framework to `PROVEN_FRAMEWORKS` with the providers and models it has actually been run against.
6. Test applicable success, transient-error/retry, business-refusal, confirmation, and resume paths
   with an injected offline model in the required suite.
7. Emit the common OpenTelemetry spans and verify sensitive-data redaction.
8. Add the runtime to `create_support_agent_runtimes` and expose unavailability cleanly: a
   framework this process cannot run is refused when an arm is advanced, never recorded as a
   failed turn.
9. Document observed tradeoffs, limitations, and behavior in an ADR.

A framework must not change the domain, public routes, stored session format, or UI. If a capability
is unavailable, the adapter declares it absent rather than silently simulating it. A live-model call
remains an opt-in smoke test and never replaces deterministic evidence. Compare developer experience
in a factual report covering glue code, constraints, observability, and failures—never with a global
score.
