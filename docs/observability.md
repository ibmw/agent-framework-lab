# Observability

OpenTelemetry is the common internal format. Every request and future agent execution propagates the
same trace context. Domain spans use stable names and record at least the scenario version,
framework ID, tool name/version, outcome, attempt, and duration.

Never record secrets, tokens, cookies, authorization headers, full addresses, raw email addresses,
unsanitized free-form content, or complete tool payloads. The span processor must apply an attribute
allowlist and pseudonymize customer/session identifiers before export. Structured logging follows
the same rule and carries `request_id`/`trace_id`.

Instrumentation depends on an application interface or remains in infrastructure. The domain
creates no span. Phoenix is a replaceable local consumer: no domain rule or test depends on its
availability. The application continues to work when export is disabled.
