# ADR 0066 — An editor's header holds its actions in reach

Status: accepted, amended by ADR 0073 (the ticket editor is its own page) — 2026-09-27

Settles `docs/PLAN-UX.md` Slice 25: `PageHeader` sticks on every editor, as the create page's
header already did (`Workspace.dc.html` :207, :387, :483, :890, :1197, :1328, :1638, :1746). It
builds on ADR 0063, whose `PublishReasons` says why Publish is refused, and on the create page
(`form-decisions.md` 2b).

Records seven decisions: which headers stick; that what the header's actions report sticks with
them; that the header holds at the pane's edge rather than inside its padding; that the pane
keeps what it scrolls into view clear of the header, the tour's steps included; that the header
holds only while it takes a third of the pane or less; that the document itself never scrolls;
and that an edited draft is not called identical to the last version.

## Context

On the product editor's six cards an operator who added a review at the foot of the page had to
scroll back past five cards to press Save; on the agent configuration editor the same was true
of Publish, and of the lines saying why it would not go, which sat under the header and scrolled
away with it. The prototype pins the header of every page that edits or creates one thing, on
the canvas `#f6f6f7` over a `1px solid #e1e3e5` rule. The create pages already did
(`components/CreatePage.tsx`); the editors did not.

## Decisions

**Which headers stick.** (Amended by ADR 0073: the ticket editor is its own page, pinned through
`PageHeader` like the others, and `stickyInsetHeaderClasses` is gone.) Every page that edits or
creates one object pins its header; index
and overview pages do not, even where they carry the shop draft's Save. `PageHeader` takes
`sticky`, and eleven surfaces pass it: the product, order, customer, document, scenario, agent
configuration, judge, block (objective and mutation) and support identity editors, and the
shop's two setup pages, *Shop details* and *Tone of voice*, which edit the shop's one set of
details and its one set of voices. The ticket editor is the twelfth: it edits one ticket but is
not its page — it sits in the Tickets page's second column, beside the list, under a page header
("Tickets") that scrolls away — so its own header takes the same mechanism in
`stickyInsetHeaderClasses`, which keeps it to its column instead of pulling it out to the pane's
edges. A sticky box is held within its parent, and its parent is the thread's column, so what
holds is narrower than for the other editors: Save and Publish stay in reach down the thread
column, and at 2xl and wider (1536px), where the context panel stands beside that column, down
the whole page. Below 2xl the context panel stacks under the column, and once the page is
scrolled past the thread the header goes with it — at 1366×620 Save is 736px above the top of
the pane at the foot of the page. That case is a follow-up: meeting it means restructuring the
page, which this slice does not do. The ten create pages pin theirs through `CreatePage`.

The prototype draws the two setup pages unpinned (:1893, :1993) — its own rule is the back arrow —
and this departs from it: they edit one object, their Save is in the header, and Shop details
runs to more than two screens. The Products and Documents tables and the shop overview carry the
shop draft's Save in their header and stay unpinned: they are lists and a summary, and the slice
is scoped to editors. So do the shop version, the bench setup, the live bench, the results,
history, the lab settings and the glossary; a *not found* state keeps the plain header.
`tests/e2e/sticky-header.spec.ts` visits all 43 surfaces that draw a page header, and the ticket
editor beside them.

**What the actions report sticks with them.** `PageHeader` takes `reasons`, drawn right-aligned
directly under the actions and inside the header. Every sticky editor puts there what its Save
and Publish say about themselves — the failure (`role="alert"`), the version a publish froze
(`role="status"`), and `PublishReasons` — rather than at the top of the flow. A press made at the
foot of a long page used to fail in silence for a sighted operator, the alert printed a screen
above them; now the press and its outcome are pinned together, which is ADR 0063's *says why in
the place the press was refused*. The lines, by editor:

| Editor | Failure | Publish outcome | Refusals |
|---|---|---|---|
| Product, order, document | the shop draft's (or the order's) save error | — | — |
| Shop details, tone of voice | the shop draft's save error | — | — |
| Customer, scenario, agent configuration, judge, block, support identity | the editor's error (and a resource read's, where the editor has one) | *Published version N…* | `PublishReasons` |
| Ticket | the editor's error | *Published version N…* | `PublishReasons` |

The scenario editor's *resources failed to load* line, with its Retry, is not an outcome of a
press and stays in the flow. When nothing is to be said the row draws nothing:
`PublishReasons` renders nothing, and the row hides itself while empty, so the title keeps the
prototype's 5px to its description. The row is one component, `HeaderReport`, which the create
page's refusal and failure lines use too.

The row is **bounded at a quarter of the viewport** and scrolls within that. Its lines are few
and short — at most one failure, one published version and four publish reasons, about 20px
each — but the failure is the lab's own sentence, whose length the client does not control, and
the row is the one part of the header the pinning rule below does not measure; unbounded, it
would be the letterbox arrived at another way. A scrolling row is reachable from the keyboard in
the browsers the lab supports, which focus a scroll container with no focusable content.

**One mechanism, shared.** The create page's classes and this header's are one constant,
`stickyHeaderClasses`, and one ref callback, `clearStickyHeader`, in `lib/stickyHeader.ts`.

**It holds at the pane's edge.** The scrolling element is `main` (`AppShell`), which pads its
content `py-5`, and a sticky box is held inside its scroll container's padding: at `top: 0` the
header stopped 20px below the top bar and the page scrolled past visibly above it. That was
already true of every create page. The header sticks at `-top-5`, and its `-mt-5` resting pull
applies only where it is the pane's first child, so a workspace's own error line above it is not
drawn over. No ancestor between `main` and the header sets `overflow`, which would defeat
`sticky` silently; the browser test measures the stuck position rather than the class.

**What it covers is scrolled clear of it.** A header pinned over the pane hides whatever the
browser reveals underneath it — a field reached by Shift+Tab, a tour step — which WCAG 2.2's
2.4.11 *Focus Not Obscured* refuses. `clearStickyHeader` sets the pane's `scroll-padding-top` to
the header's **whole** height, report row included, plus 8px for the focus ring, follows it as it
changes, and gives the pane back when the header goes. There are no in-page anchor links.

`driver.js` 1.8.0 does not honour the padding on its own: it scrolls a step into view only when
the element is outside the *window*, and then centres it in the window — an element under the
pinned header is inside the window, and a step taller than the room under the header is centred
with its top beneath it. So the tour's `onHighlightStarted` does two things. It first calls
`scrollIntoView({ block: "nearest" })`, which the padding governs, so a step that fits is on
screen and the library leaves it alone. Then, in a microtask — after the library's own scroll,
which it makes synchronously straight after the hook, and before the frame it draws its stage in —
it aligns a step whose top is still under the header to the header's foot with
`scrollIntoView({ block: "start" })`. Both scrolls land before a paint, so the reader sees one
jump.

**It holds only while its name and actions take a third of the pane or less.** An editor's
header wraps where the pane is narrow, and pinned in a short or narrow pane it leaves the page a
letterbox: 52–59% of the pane on seven editors at 390×844. `clearStickyHeader` decides on the
header's **steady height** — its whole height less every report row (`data-sticky-report`) and
the gap before it, so the name, the chips, the actions and the description — against the pane's
`clientHeight`. At a third or less the header is pinned (`data-pinned="true"`, which is what
makes it `sticky`) and its report row rides along; above a third it scrolls away with the page
and asks for no clearance (WCAG 1.4.10 *Reflow*).

The report row is left out because it grows exactly when a press fails. Decided on the whole
header, a failed Save at the foot of the objective block editor at 1366×620 took the header from
166 to 189.5px against a limit of 188, unpinned it, and carried the failure and Save off screen
together; a two-line failure did the same to the agent configuration and support identity
editors at 1280×720. The report row also comes and goes ("Checking the draft…", a line under
Publish), and a header decided on it would flap near the limit. The cost is that a pinned header
can cover more than a third while it has something to report — the agent configuration editor at
960×540 is 206 of 484px with its three lines under Publish — and never more than a third plus the
row's quarter of the viewport.

A third, because the measured desktop headers take 11–25% of a 720px window and the letterboxed
ones 36% and more.

It is decided when the header mounts and again whenever the **pane** changes size — a resized
window, a zoom, the rail collapsing — and at no other time. The header's own height is observed
only to keep the clearance equal to it. The reason is that the header's height follows the
editor's state even without a report row: going dirty swaps "All changes saved" for Discard and
Save, which wraps the actions row on a narrow pane (97 to 141px on most editors), and a save swaps
it back. Decided again on that, the customer editor at 960×420 pinned while clean and let go on
the first keystroke, and at 390×844 a successful save let go of it. The accepted consequence is
the other way round: a header that grows after it was pinned — dirty, a report row, a chip that
arrives with the preview after the header mounted — stays pinned until the pane is resized, and
is then decided again on whatever it is. Nothing the operator does inside the page flips the
pin; the only thing that does is the pane changing, and pinning cannot flip itself, because a
sticky box and a static one take the same room in the flow and the pane is the same height
either way. Until it has been measured the header is not pinned. This replaces a
`min-height: 32rem` media query, which measured the window rather than the header.

**The document never scrolls.** The shell owns the viewport and only its panes scroll. `main`
is `relative`, because every `sr-only` line is absolutely positioned and, with no positioned
ancestor, was laid out against the document — making it taller than the window on a long page,
so that any `scrollIntoView` slid the whole shell, top bar and pinned header with it, up the
screen.

**An edited draft is not "identical".** `PublishReasons` no longer says "The draft is identical
to vN" while the draft is dirty: that sentence is about the saved draft, and beside "Save the
draft first" it described something the operator was no longer looking at.

## Layering

`z-10`: above the page it scrolls over, below the top bar (`z-20`) and its shop menu, the
unsaved-changes dialog (`z-50`, fixed) and the tour overlay (`driver.js`, z-index in the
thousands). No dropdown or toast is positioned inside the pane.

## Consequences

- `tests/e2e/sticky-header.spec.ts` carries the slice evidence — Save pressed by pointer at its
  on-screen position at the foot of the reviews card — a failed Save and a failed and a
  successful Publish reported in view, a failed Save inside the pinned header on every one of the
  twelve editors, a failure that does not unpin the header at 1366×620 and 1280×720, a first
  keystroke that does not unpin it at 1100×420, the ticket editor's Save in reach at 1600px, the
  Shift+Tab clearance on an editor and a create page, the third-of-the-pane rule at 390×844 and
  960×540, a tour step under the header and one taller than the room under it, the document that
  never scrolls, and the 43-surface enumeration with the ticket editor. `tour-anchors` still finds
  `data-tour="page-name"` on every toured surface.
- The first-keystroke case was measured at 960×420 until every editor's header took its way back
  above the title. The customer editor's clean header is now more than a third of that pane, so
  the case moved to 1100×420, where the premise holds on both sides.
- A new editor passes `sticky`, puts its outcome lines in `reasons`, and joins the sweep's list.
