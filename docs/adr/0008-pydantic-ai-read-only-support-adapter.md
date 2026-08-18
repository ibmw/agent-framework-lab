# ADR 0008 — Pydantic AI read-only support adapter

Status: accepted — 2026-08-18

## Context

Milestone 2 needs the first real framework integration without exposing SDK messages, tools,
memory, output models, or failures through the public contract. Required evidence must remain
offline and repeatable, while a credentialed developer can opt into one supported live model.

## Decision

The lab implements Pydantic AI under `infrastructure/agents/pydantic_ai/` and maps its agent,
`RunContext`, tools, model history, structured output, test model, and provider errors to the common
application types. Composition selects OpenAI Responses with `gpt-5-mini` only when
`AGENT_LAB_OPENAI_API_KEY` is configured; tests compose Pydantic AI's `TestModel`. The fake remains
the credential-free local fallback.

Conversation persistence stores neutral turns: user and assistant text, the lab's structured
result, versioned tool activity, and a trace ID. On resume, the Pydantic adapter reconstructs SDK
message history at its boundary. It does not persist SDK serialization or provider response IDs.

Common tracing wraps every adapter outside the framework packages. Only an allowlisted set of
framework, scenario, outcome, attempt, tool name/version, and HMAC-pseudonymized identifiers is
exported. Native Pydantic AI prompt instrumentation is not enabled because its richer payloads do
not satisfy the lab's content-minimization rule.

## Observed behavior and limitations

- Pydantic AI maps the three scoped Python functions to JSON-schema tools with little glue; the
  main mapping cost is converting neutral history and structured outputs.
- `TestModel` calls tools deterministically on a new conversation but treats any prior model
  response as sufficient to proceed to output. Resume evidence therefore proves history mapping
  and valid structured output, while first-turn evidence proves all three tool calls.
- M2 advertises tool calls, conversation memory, session resume, structured output, and common
  tracing. At M2 completion, durable cross-session memory, confirmations, and retries were visibly
  absent; ADR 0009 records their later Milestone 3 addition.
- Pydantic AI validation and provider exceptions are normalized into validation, provider, or
  transient application failures. Provider retry policy is not advertised as a capability yet.
- The HTTP API is turn-based rather than token-streaming. This keeps persistence and idempotency
  explicit; streaming can be considered under a later versioned contract.
