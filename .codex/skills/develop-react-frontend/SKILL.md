---
name: develop-react-frontend
description: Implement or review the React/Vite frontend of Agent Framework Capability Lab with assistant-ui, Tailwind, shadcn/ui, versioned backend contracts, MSW, Vitest, and focused Playwright coverage. Use for playground UI, chat presentation, frontend API adapters, component tests, or essential browser flows in this project.
---

# Develop the React frontend

1. Read `docs/frontend-backend-boundaries.md` and the relevant OpenAPI v1 contract.
2. Keep business authorization, durable memory, confirmations and agent SDK behavior on the
   backend. Put network mapping in `src/api` and view state near the consuming feature.
3. Use assistant-ui as a replaceable presentation/runtime adapter. Do not expose framework-specific
   events to shared components.
4. Prefer existing shadcn/ui primitives and Tailwind tokens; preserve keyboard navigation, labels,
   focus, loading, empty and error states.
5. Test visible behavior with React Testing Library. Use MSW when HTTP participates. Add Playwright
   only for an essential human journey.
6. Update shared/versioned contracts in the same change; never hand-maintain a divergent response
   type.
7. Run targeted Vitest, then `pnpm lint`, `pnpm typecheck`, and `pnpm build`. Run E2E only when its
   covered journey changes.

Before starting Vite, check port 5173 and reuse a healthy existing server. Do not stop or restart a
developer's process without an identified reason.

Ports 8001-8004 and 5174-5177 belong to Playwright, which starts and stops every one of them
itself: the suite runs a whole stack per worker so that no two workers share a database. Never
reuse or serve from them; anything found listening there is a leftover to remove, not a stack to
adopt.
