# ADR 0006 — τ³-inspired scenario design

Status: accepted — 2026-08-16

The lab uses τ³-bench Retail as inspiration for e-commerce vocabulary, policies, tool shapes,
fixtures, and scenario structure. Scenarios and policy sets are adapted, owned, and versioned
locally so the first human demo remains reproducible and independent of an external runtime,
package, dataset download, or evaluation harness.

This preserves a recognizable retail problem space without coupling domain rules or agent adapters
to τ³-bench. Deeper dataset or harness integration remains a later decision, made only after the
interactive scenarios and shared contracts are stable.
