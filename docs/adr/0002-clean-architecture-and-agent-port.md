# ADR 0002 — Clean architecture and agent port

Status: accepted — 2026-08-16

The domain and application remain framework-independent. Repositories and `AgentAdapter` are
application ports implemented under infrastructure. This choice adds a small mapping cost but lets
the lab compare Pydantic AI and Vercel AI SDK without rewriting the playground or e-commerce rules.
