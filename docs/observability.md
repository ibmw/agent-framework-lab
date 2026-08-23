# Observability

OpenTelemetry is the common internal format. Every request, experiment run, agent execution, and
evaluation propagates or links the appropriate trace context. Stable spans record the experiment
and run correlation, scenario and agent-configuration versions, framework and architecture IDs,
tool name/version, outcome, attempt, duration, and token/model usage when safely available.

Never record secrets, tokens, cookies, authorization headers, full addresses, raw email addresses,
unsanitized free-form content, complete tool payloads, or LLM-judge inputs. The span processor must
apply an attribute allowlist and pseudonymize customer, experiment, run, and session identifiers
before export. Structured logging follows the same rule and carries `request_id`/`trace_id`.

Instrumentation depends on an application interface or remains in infrastructure. The domain
creates no span. Phoenix is a replaceable local consumer: no domain rule or test depends on its
availability. The application continues to work when export is disabled.

For local POC visualization, start `infra/phoenix/compose.yaml`, set
`AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces`, and open
`http://localhost:6006`. The HTTP endpoint must include `/v1/traces`. Leaving the setting unset
keeps the application functional with an in-process no-export tracer.
