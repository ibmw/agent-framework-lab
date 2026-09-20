# ADR 0056 — The workspace holds the listings its rail counts

Status: accepted — 2026-09-20

Puts a figure beside every rail entry that has a listing behind it, and decides where that figure
comes from. The two shells — `ShopWorkspace` and `LabWorkspace` — read each listing once and hand
the same answer to the rail and to the index that renders it, so a count and a table are one
object rather than two reads that can drift.

Records four decisions. That the listings are **held at the shell** rather than replaced by a new
`GET /shops/{id}/counts` read, which is a measurement and is reported below. That a count reaches
a screen reader as the entry's **description** and never as part of its name, which is what lets
the figure sit inside the link at all. That the **collapsed strip draws no figure and still says
one**. And that a surface which changes what a listing holds **refreshes that listing**, which is
the whole of the cache's invalidation rule.

## Context

`docs/design-direction.md`'s *Navigation and chrome* ended the rail's bullet with "Counts per
entry: *planned*, Slice 11", and the prototype draws the figures: right-aligned, 12px, the row's
own ink where you are standing and `admin-muted` everywhere else (`Workspace.dc.html` :110, :113;
the README's *Navigation rail*).

The rule they have to observe is already written, for the chip row, under *Lists and counts*: "the
count is of the whole list, … the row is absent while the listing is in flight or failed, and a
figure the payload lacks is not faked". A rail is not a filter, but the honesty is the same, and a
rail that said `0` while a listing was still in the air would be saying something false on every
screen in the application rather than on one.

**This puts listing reads back on the shell, and the last ADR to touch them took them off.**
ADR 0045 deleted `deriveSetupPath`, "the ten listing reads behind it, and the band that rendered
them", and ADR 0044 recorded the same deletion as voiding its own projected-progress section. It
is worth being exact about what is and is not returning. What those two refused is a surface that
*derives a judgement* — how far this lab has walked a chain, what it still lacks, which step comes
next — from listings the operator never asked about. Nothing here derives anything: a count is the
length of the list the entry opens, said in the entry that opens it, and the product-direction
rule those ADRs left standing is exactly that "the only readiness the workspace reports is what a
listing says". The reads are back; the reading is not.

Until now every index read its own listing on mount. Nothing else read it, so nothing could
disagree with it. A figure on the chrome changes that: the rail is drawn on every screen, and a
second read of the same route — taken at a different moment, from a different component — is a
second answer that will eventually differ from the table beneath it. `docs/PLAN-UX.md` says so in
as many words: "so a count and a table cannot disagree".

## Path A or Path B, by measurement

The plan left one thing open: hold the four shop listings at the shell (Path A), or add an
additive `GET /shops/{id}/counts` read and hold nothing (Path B), and "decide by measuring".

Measured against a locally seeded shop grown to a realistic size — **201 orders, 51 customers, 41
tickets, 21 scenarios** — served by this build's API over SQLite on the developer's own machine:

| Read | Bytes | Server time |
| --- | --- | --- |
| `GET /shops/{id}/orders` | 78 788 | 10.8 ms |
| `GET /customer-profiles?shop_id={id}` | 16 642 | 3.8 ms |
| `GET /shops/{id}/tickets` | 20 660 | 4.7 ms |
| `GET /shops/{id}/scenarios` | 10 606 | 5.6 ms |
| **The four together, in parallel** | **126 696** | **25.5 ms median wall clock** (23.3–30.1 over ten runs) |

The shop's draft, which the shell already reads and from which products, documents and tone
guidelines are counted, is 8 618 bytes and costs nothing new. The lab's six reads together are
**4 713 bytes** — `/experiments?page_size=1` 2 151, `/agent-configurations` 734,
`/objective-blocks` 939, `/mutation-blocks` 317, `/judge-configurations` 295,
`/support-identities` 277 — which is not a number anything turns on.

What that buys and costs:

- **Requests at the shell.** Five per shop in shop mode — the four above and the
  support-identity library the shop rail's own entry points at (277 bytes), **126 973 bytes**
  together — and six in lab mode. They are issued when the shell mounts and again only when
  something changes what one of them holds.
- **When that is paid.** Once per `ShopWorkspace` mount: a hard reload, a deep link or a change of
  shop. Navigating *within* a shop re-reads nothing at all, which is where the old arrangement
  paid a listing per index visit.
- **What the index then re-fetches.** The four indexes used to make eight reads between them,
  because Orders also read the customers, Tickets' create form read them again and Scenarios read
  the tickets — 197 282 bytes for a walk through all four. They now make one: the cross-shop
  profile list the Customers page's attach control offers, 16 642 bytes. A walk through the four
  went from **8 reads and 197 282 bytes to 6 reads and 143 615 bytes**, and walking back through
  any of them costs nothing.
- **What it costs.** A screen that is not an index — a product editor, the overview — pays
  126 973 bytes on arrival that it did not pay before. On a local lab that is 25 ms, and it is
  not paid again while the operator stays in that shop.
- **A counts read would have saved** those 126 KB and returned about 120 bytes.

So: **Path A**. Path B would add a route to `packages/contracts/openapi/v1/openapi.yaml` — a
versioned public contract, with its backend, its consumer, its generated types and a test that its
figures equal the listings' — to save 127 KB paid once per shop on an application that runs on the
operator's own machine. That is the reason, and it is sufficient on its own.

The tidier-sounding argument — that Path B would put the count and the table on two different
reads — is deliberately **not** the reason, because this slice accepts exactly that for history,
whose index reads one narrowed page while the rail reads the lab's total. One read is what makes
the two agree where it is available; it is not a principle this slice can claim to hold without
exception.

The figure scales linearly at roughly **392 bytes per order**, which is the term that dominates.
A shop holding about **2 500 order fixtures** would push the bundle past a megabyte; that is the
point at which Path B is worth measuring again, and this is the sentence that names it.

## The count is the entry's description, never its name

`nav[aria-label="Shop workspace"]` and the name of every row in it are what eleven Playwright
specs, every tour anchor and every component suite reach this application by, and
`docs/PLAN-UX.md` requires that a rail entry's accessible name stay the label alone.

A visible figure inside the link joins the accessible name by default, because a name computed
from contents takes every descendant's text. Two of the ways out are worse:

- **`aria-hidden` on the figure alone** keeps the name right and tells a screen-reader user
  nothing. The figure is information, not decoration — it is the one thing on the row that is not
  already in the word beside it — and hiding it is dropping it.
- **`title=`** is refused by *The form language*: "`title=` is never the only carrier".

What ships is three things together. The digits are drawn inside the link and marked
`aria-hidden`, so they are the eye's alone. The link is named by `aria-labelledby` pointing at
its own label span, which fixes the name to the label whatever the row comes to contain rather
than leaving it to be recomputed from the contents each time something is added. And the phrase
a reader hears — "12 orders", the noun spelled out and singular at one, because "12" alone after
a link name could be a version as easily as a quantity — is an `sr-only` span **outside** the
link, referenced by `aria-describedby`.

Outside, and not inside, because a screen reader in browse mode reads a link's own contents as
well as its description: a phrase inside the link would be heard twice. `sr-only` is out of flow,
so the span is not one of the rail's grid rows either.

## The collapsed strip draws no figure and still says one

The prototype's 52px strip is a centred glyph in a 36px row and draws no count
(`Workspace.dc.html` :127–:140); there is no column to right-align one into. The strip therefore
draws none.

It keeps the description. Collapsing is a statement about how much room the operator wants on
screen — ADR 0044 made it a browser preference for exactly that reason — and a description takes
no room. A reader who cannot see the rail hears the same figures in both states, which is the
only reading under which the preference is about width rather than about content.

## A surface that changes a listing refreshes it

The cache's whole invalidation rule, and the reason the evidence for this slice is "creating an
order makes it thirteen without a reload":

- Every index's create calls that listing's `refresh`, which is the read the rail is drawn from.
- Every editor whose index prints the row it is changing declares `afterSave` on its
  `DefinitionGuard` — on the editor and not on the button, for the reason `DefinitionGuard`
  already gives: the navigation prompt saves the draft too — and refreshes again after a publish,
  because the index prints the version that was just frozen. `OrderEditorPage`, which is not a
  definition editor, refreshes after its save and after its delete.
- The bench refreshes history's total when an experiment starts, and the history index refreshes
  it after a replay or a fork. Those three are the only writes that change how many experiments
  the lab has run.

A refresh that fails leaves the rows that are on screen where they are and reports itself through
the listing's own error, which is what every index already showed. The count is then withheld —
the chip row's rule, applied to the same state.

Products, a shop's documents and its tone guidelines are not listings at all: they are counted off
the draft `ShopWorkspace` already holds, so the figure and the page that edits them are the same
object and an unsaved edit moves the rail immediately.

**"Documents" is policies plus FAQ entries, and that is a departure.** The prototype's figure is
over one `DOCUMENTS` fixture holding policies, support guidelines and FAQ entries together; the
shop's guidelines live on `/setup/support`, which the rail does not name, so counting them here
would put rows in the figure that the page it opens does not draw — the disagreement this whole
slice is about. It is recorded in `docs/design-direction.md`'s departures table, and Slice 16,
which merges the three lists into one *Documents* table on this very page, carries the line that
moves the figure with them and ends the departure.

## Deliberately not here

- **`GET /shops/{id}/counts`.** Measured above and not taken. No contract moves and this slice
  carries no backend.
- **A count on the bench.** The prototype draws "1 live" there. It is a tally of running arms in
  one shop rather than the length of anything this shell reads, and a figure the payload lacks is
  not faked.
- **Revalidating a listing whenever its index mounts.** That would be today's request count plus
  the shell's, and it would make "held once per shop" false while buying nothing that the refresh
  rule above does not already buy.
- **A general-purpose client cache.** Two hooks over `useState` in two shells, with no library and
  no new dependency, are what two rails need. `docs/PLAN-UX.md` forbids a new UI dependency and
  nothing here wants one.
- **Anything about what a listing contains.** No index changes what it lists, what it filters by
  or what it prints. This slice changes where the rows come from.

## Consequences

Nine index surfaces stop reading a listing and read the shell's instead — Orders, Customers,
Tickets, Scenarios, Support identities, Agent configurations, Judges and the two block libraries
— and History takes its rail figure from the shell while keeping its own narrowed page. Products,
a shop's documents and its tone guidelines are counted off the draft and read nothing new. Seven
editors refresh the listing whose index prints the row they changed. So a create, a save, a
publish and a delete now move the chrome as well as the table. Two shells hold five and six reads
respectively, which is the cost measured above.

**Nothing watches the re-measure trigger.** The ~2 500-order figure above is a note to whoever
next finds the shell slow, not a guard: no test asserts a payload size and no surface reports one,
so a lab that grows past it will feel slow before anything says why. Naming it is the whole of
what is in place.

Every suite that renders a page inside either shell now sees those reads. `src/test/shell.ts`
declares empty answers for them, appended **last** to each `setupServer(…)` so that a suite
serving its own rows for one of those routes keeps serving them, and it also holds the two helpers
a suite uses to assert that a rail's figure and its table are one answer.

`docs/design-direction.md`'s rail bullet stops calling counts planned, and its departures table
gains two rows: the bench's missing figure, and what *Policies & FAQ* counts until Slice 16 merges
its three lists.

## Verification

- `shell/AppShell.test.tsx` holds the rail entry: the figure drawn right-aligned, muted on a row
  you are not standing on and in the row's own ink on the one you are; a zero drawn; nothing at
  all drawn and nothing described while the listing is in flight or failed; no figure on Overview,
  Shop details or the bench; the accessible name still the label alone with the figure as the
  entry's description, singular at one; every figure the lab's rail draws; and the collapsed strip
  drawing none while still describing it.
- One index suite per listing asserts that the rail's figure and the rows beneath it are the same
  number: `Orders`, `Customers`, `Tickets`, `Scenarios`, `SupportIdentities`,
  `AgentConfigurations`, `JudgeConfigurations`, `Blocks` (both libraries), `History` — and
  `App.test.tsx` for the three the draft supplies. An agreement between two reads of one fixture
  is true by construction, so **two of them exercise the write**: `Orders` and `Scenarios` create
  a row and assert the figure moves with the table and without a reload, and `App.test.tsx` adds
  a tone guideline to the draft and asserts the same. `History` asserts the other half of the
  rule, that the figure stays the lab's total while the table is narrowed to one shop.
- `Orders.test.tsx` holds the shop change: a refresh held open across a change of shop must not
  write the shop that was left onto the rail of the shop on screen.
- No contract test, because no contract moved.
