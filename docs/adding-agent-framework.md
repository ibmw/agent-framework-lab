# Adding an agent framework

1. Document the provider/model, local credentials, deterministic test double, and optional smoke-test
   policy before adding the SDK.
2. Create `infrastructure/agents/<framework>/` and keep SDK imports local to that package.
3. Implement `AgentAdapter` without expanding the contract to mirror a proprietary API.
4. Map tools, messages, memory, and structured outputs to the lab's versioned contracts.
5. Declare only the `AgentCapability` values proven by the shared conformance suite.
6. Test applicable success, transient-error/retry, business-refusal, confirmation, and resume paths
   with an injected offline model in the required suite.
7. Emit the common OpenTelemetry spans and verify sensitive-data redaction.
8. Add the adapter to the composition registry and expose unavailability cleanly.
9. Document observed tradeoffs, limitations, and behavior in an ADR.

A framework must not change the domain, public routes, stored session format, or UI. If a capability
is unavailable, the adapter declares it absent rather than silently simulating it. A live-model call
remains an opt-in smoke test and never replaces deterministic evidence. Compare developer experience
in a factual report covering glue code, constraints, observability, and failures—never with a global
score.
