# Observability

OpenTelemetry is the common internal format. Every request, experiment run, agent execution, and
evaluation propagates or links the appropriate trace context. Stable spans record the experiment
and run correlation, scenario and agent-configuration versions, framework and architecture IDs,
tool name/version, outcome, attempt, duration, and token/model usage when safely available.

Never record secrets, tokens, cookies, authorization headers, full addresses, raw email addresses,
unsanitized free-form content, complete tool payloads, or LLM-judge inputs. The span processor must
apply an attribute allowlist and pseudonymize customer, experiment, run, and session identifiers
before export. Structured logging follows the same rule and carries `request_id`/`trace_id`.

For authored definitions the allowlist is derived, not hand-maintained. Each payload that carries
synthetic personal or simulation-only content classifies **every leaf of its canonical document**
as sensitive, customer-only, or operational, and exposes a `telemetry_attributes` projection built
only from the operational fields and from counts. A test asserts the classification covers the
document exactly, so a newly authored field fails the suite until someone decides whether it may
leave the authoring surface. `customer_profile.FIELD_SENSITIVITY` is the first such classification
(ADR 0014); domain validation messages and change summaries likewise name the failing field rather
than echoing its value.

Instrumentation depends on an application interface or remains in infrastructure. The domain
creates no span. Phoenix is a replaceable local consumer: no domain rule or test depends on its
availability. The application continues to work when export is disabled.

For local POC visualization, start `infra/phoenix/compose.yaml`, set
`AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces`, and open
`http://localhost:6006`. The HTTP endpoint must include `/v1/traces`. Leaving the setting unset
keeps the application functional with an in-process no-export tracer.
