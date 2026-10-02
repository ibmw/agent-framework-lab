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

Advancing an experiment arm records a span tree beside the record as well as emitting one
(ADR 0037). Three kinds are recorded, and only the three the lab itself opens: the whole
advance, the framework's turn inside it, and each tool call. A framework's own instrumentation
is never captured into the store — the lab cannot promise the sanitization of an attribute it
did not write — so a model call inside an SDK's loop reaches an exporter if one is configured
and reaches the record as the measurable gap between two recorded spans, never as a bar the
lab invented. An SDK that *exports* its own spans to a vendor endpoint by default is switched
off rather than ignored, at the moment composition decides it runs here: ignoring it would
leave tool arguments and model output leaving the process by a path the lab does not control
(ADR 0041).

A stored span has no attribute column. It carries a span and trace identifier, its parent, its
kind, its offset from the start of the attempt, its duration, and the `(run, ordinal, attempt,
sequence)` that names the recorded call it timed; which tool that was and what it answered are
joined from the tool events rather than copied onto the span. That is what keeps a trace from
becoming the way synthetic customer content leaves the lab: every column is a hex identifier,
a small integer, or a value from a closed enum. The offset draws a bar and orders nothing —
a trace is listed by the coordinates the agent's own calls are numbered by, because a clock
can be stepped backwards and the record must not say two things about one attempt.

The **exported** span carries a written allowlist rather than a filtered one: the lab's
identifiers pseudonymized, the arm's *position* rather than the label an operator typed for
it, the turn, the framework, and the published tool name and version. No free-form string
leaves the process, a span's name is decided from its kind rather than passed in as text, and
an exception's message is never recorded — only its type.

An uploaded image is logged by its hash, its type and its size, and nothing else. Its original
file name is a label the operator chose and may say anything, so it is never logged, never a span
attribute and never echoed in an error body; it reaches only the image's own record and the
listing that names it (ADR 0076).

For local POC visualization, start `infra/phoenix/compose.yaml`, set
`AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces`, and open
`http://localhost:6006`. The HTTP endpoint must include `/v1/traces`. Leaving the setting unset
keeps the application functional with an in-process no-export tracer.

Whether that setting is configured is reported on the lab's own settings surface, as a boolean and
never as an address: `GET /api/v1/lab-status` serves no endpoint, because a collector URL is a place
a deployment can put a token and a route that serves one serves that token the day somebody does.
It reports what this process reads the setting as rather than what the variable holds — a blank
value installs no exporter, and the read-out says so. The surface shows the Phoenix path above when
nothing is configured, so the way to a local collector is readable from the application rather than
only from this file, and it reports the allowlist as covering the spans the lab itself opens, which
is the only sanitization this project is in a position to promise (ADR 0044).
