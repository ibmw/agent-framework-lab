# ADR 0068 — A pinned version opens the draft that produced it

Status: accepted — 2026-09-27

Amendment: 2026-10-28 — ADR 0080 takes the figures off the arm card. The results' summary row
keeps the arm, its configuration chip, its count and its standing; the figures are rows of
*Usage*, read beside the other arm's, with "Tokens, in and out" among them and a retry above
zero still in the error ink. *An arm's card carries four figures* below is the record of what
the card drew until then.

Amendment: 2026-10-28 — ADR 0080 draws the results' provenance as a sheet section. Each pinned
version is a link that is its row's value rather than a chip — the scenario and its fixtures in
one row, the blocks by their published names in another, each arm's versions in its column — and
it opens the same address this record gives it. The live bench's card still draws the chips,
none of them a link.

The results screen names every version a run pinned: each arm's agent configuration, the
scenario, and the sandbox inputs (the shop, the ticket, the customer, the support identity, the
blocks). None of those names led anywhere. The prototype draws each arm's card under the
results header with its configuration and version (`Workspace.dc.html` :2566), and the slice's
evidence is that a reviewer reading a finished experiment clicks that version and lands on "the
draft that produced it". Two things were open: which page that is, and what the arm's card
shows beside it. This records both.

## Decision

### A version chip opens the editor of its definition's draft

A published version is immutable and, except for the shop's, has no page of its own. Every
editor in the workspace shows the draft, and every published version of a definition was cut
from that one draft, so the editor is the nearest page to the version a run pinned. What the
reviewer lands on is exactly this: the current draft, and the editor's chips naming the
**latest** published version and whether the draft still matches it. It is not the pinned
version. When the run pinned the latest one and the draft still matches it, the page reads as
that version; when the run pinned v2 of a configuration now at v5, nothing on the page mentions
v2, and the chip's `title` ("Open Atlas, whose draft published v2") is the only place the pinned
number travels with the reader. A version chip therefore opens `/lab/agent-configurations/:id` for an
arm, `/shops/:shopId/scenarios/:id` for the scenario, and the matching editor for each sandbox
input (`lib/versionLinks.ts`, one entry per member of the contract's definition-type union).

The shop is the exception, because it does have a page per published version
(`/shops/:shopId/versions/:version`), and a page that shows the pinned version itself beats one
that shows the draft it came from. A shop-scoped definition is addressed under the shop the run
was made in, which is the shop every one of its pins resolved in.

The experiment record carries a pin's type as a free string (`ResolvedDefinitionSchema`), so a
type the lab adds before the table does stays the plain chip it was rather than a link to
nowhere; and every link the table can produce is swept against the route tree, so none of them
lands on the catch-all that sends an unknown address to the shops index.

Rejected: a read-only page per published version for every definition. It would be the precise
answer, and it is a new surface per definition type with a new read behind each — which is a
slice of its own, not a link.

### An arm's card carries four figures, and two more when they say something

The frame's card holds the arm, its configuration and version, "5 of 6 objectives met", and a
strip of figures: turns, tokens, tools and time on both arms, then cost on one and "1 retry", in
red, on the other. All of them are on `ExperimentRunSchema.metrics`, the payload the
*Quantitative* table already reads, so nothing new is requested:

| Figure | Source | Drawn |
| --- | --- | --- |
| Turns | `metrics.turns` | always |
| Tokens | `usage.input_tokens + usage.output_tokens` | when `usage` is not null; "≥" when `metered_attempts < attempts` |
| Tool calls | `metrics.tool_calls` | always |
| Time | `metrics.duration_ms` | when not null; "≥" when `measured_attempts < attempts` |
| Retries | `metrics.retries` | when above zero, in the error ink |
| Cost | `metrics.estimated_cost` | when priced; "≥" as tokens |

A null is a measurement nobody took, so it is left off rather than written as zero — the table
below the tabs still says "not reported" in its row. The objectives figure is the arm's own
`met of decided`, in Georgia, and in one ink on both cards where the frame paints one green and
one amber: two arms driven to different depths hold different denominators, and a colour would
be the verdict the screen refuses to draw.

## Deliberately not here

- **The editor naming the pinned version.** The landing page does not say "you came here from a
  run that pinned v2; the latest is v5". The editor would need to read the version from the
  address and say it beside its version chips — new editor behaviour, left for the slice that
  also decides whether a per-version view is built.

- A chip on the history row's arms. History names the version each arm ran and the newer one
  published since; linking those is the same decision, and the plan asked it of the results.
- The live bench's provenance chips, which are the same strip; a run in progress is not what a
  reviewer reads.

## Verification

- `lib/versionLinks.test.ts`: every definition type the contract names is linked, every link
  resolves to a route the app renders rather than to the catch-all, the configuration opens its
  editor and the shop its version page, a shop-scoped definition is addressed under the run's
  shop, and an unknown type is not linked.
- `Experiments.test.tsx`: the four figures from the metrics, the unmeasured ones left off and the
  retry marked, the configuration chip on each arm opening its editor, and every provenance chip
  linked with the scenario pinned once.
- `tests/e2e/experiment-start.spec.ts`: on a finished run, the reviewer presses the arm's
  configuration version, whose `title` names the pinned version, and lands on that
  configuration's editor. The editor's header names the pinned version there only because in
  that journey the pinned version is the latest one.
