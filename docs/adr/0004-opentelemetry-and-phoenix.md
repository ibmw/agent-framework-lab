# ADR 0004 — Common OpenTelemetry, local Phoenix

Status: accepted — 2026-08-16

OpenTelemetry provides portable traces across frameworks. Phoenix will be a local viewer rather
than a business dependency. Attributes pass through an allowlist and identifiers are pseudonymized
before export so changing observability tools affects neither the agent nor the domain.
