---
name: integrate-agent-framework
description: Add or assess an agent framework adapter in Agent Framework Capability Lab while preserving the common AgentAdapter contract and producing test evidence for tools, memory, session resume, structured output, confirmations, retries, validation, and OpenTelemetry traces. Use when integrating Pydantic AI, Vercel AI SDK, or another framework into this lab.
---

# Integrate an agent framework

1. Read `docs/architecture.md`, `docs/adding-agent-framework.md`, `docs/observability.md`, and ADR
   0002 before changing code.
2. Create only `infrastructure/agents/<framework>/`; keep SDK imports inside that adapter.
3. Implement the application `AgentAdapter` as written. Map proprietary messages, tools, memory and
   structured outputs at the boundary instead of leaking them into routes or UI.
4. Reuse versioned lab tool contracts. Enforce business validation in application/domain and require
   explicit confirmation plus idempotency for modifying actions.
5. Advertise a capability only when an integration test demonstrates success and relevant failure,
   retry or resume behavior. Record unsupported or difficult capabilities explicitly.
6. Emit the common OpenTelemetry spans. Allowlist attributes, pseudonymize identifiers, and never
   export secrets, raw personal data, prompts or unrestricted tool payloads.
7. Wire framework selection only in composition. Verify that existing adapters and the playground
   contract remain unchanged.
8. Add a short ADR describing glue code, limitations and observed behavior; do not produce a global
   framework score.

Do not add Temporal, PostgreSQL or an automated simulator merely to complete an adapter.
