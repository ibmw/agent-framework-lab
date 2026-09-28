# ADR 0073 — Tickets are an index, a create page and an editor

Status: accepted — 2026-09-29

Settles the Tickets slice of `docs/PLAN-UX.md` Milestone 9, the operator's "direction B" of
28 September 2026: the Tickets surface becomes the three templates every other definition
already is — an index, a create page that lands in the editor, and an editor on the 790/312 grid
with the gate card first. It **supersedes ADR 0016's *The helpdesk workspace*** — the three-pane
anatomy; that section's two paragraphs on the shell owning the viewport and the rail collapsing
only on request stand — and **amends ADR 0066's paragraph on the ticket editor** as the one
editor that is not its page. No backend, contract or payload moves.

## Context

**What the page was.** One route component, `TicketsPage`, answered at two addresses. Under a
page header reading "Tickets" and "N in this shop", a 262px column held the list — a status
select counting Open, Resolved and All, one link per ticket with the customer's initials, the
subject, the preview and the channel — and, at its foot, the *New ticket* form, submitted by
*Open ticket*. The second column held the ticket editor: a header of its own, pinned inside that
column through `stickyInsetHeaderClasses` (ADR 0066), the thread, a *Validation* card under it
and, from 2xl, a context panel beside the column with *Ticket details* — the incident's fields —
*Customer*, *Linked objects*, *Suggested documents* and *Other tickets from this customer*.
Opening `/tickets` replaced the address with the most recently updated ticket; a ref kept that
redirect from following a create with a second navigation, and the tour table declared
`:ticketId` as a second address of the index's tour so the bar did not lose it a frame after
loading. ADR 0066 recorded the consequence it could not fix: below 2xl the context panel stacked
under the column and the header let go of Save once the page scrolled past the thread.

**What the prototype and the README draw.** The prototype draws the helpdesk as three panes
(`Workspace.dc.html` :2170–2322): the list's head and rows (:2174–2193), a header over the
thread with the subject (:2200), the thread and its composer (:2243), and a 300px panel of the
customer (:2251), what is linked (:2267), the suggested documents (:2293) and *Used by*. The
README's screen table reads "Three-pane; header spans list + customer panel". Every other
definition in the workspace — the shop, the order, the customer, the scenario, the identity, the
agent configuration, the judge, the blocks — is an index, a create page and an editor.

**The directions the operator was shown**, on 28 September 2026:

- **A — the helpdesk, harmonized.** The three panes kept (a 276px list, the thread, a 316px
  context pane) on one full-height card, with the index's header and *New ticket*, search and
  chips on the list, the Publish gate first in the context pane, and a create page for *New
  ticket*. The best for flipping between tickets, and the least like every other editor.
- **B — an index and a form-first editor.** Tickets behave as Orders or Scenarios do: an index,
  then a pinned editor with 790px cards and the 312px panel. The most consistent; the thread
  becomes one card among four, and moving between tickets goes through the index.
- **C — an index and a conversation-first editor.** B's index, and an editor on the same
  template whose main column is the conversation, with the details, the customer, the links
  and the gate in the panel and a previous/next stepper in the header.

**The operator's decision.** B ("I prefer Ticket B version"), for consistency with every other
page — the reason the harmonization exists: "make sure the UX is the same and the user will not
be lost". A keeps the one layout no other surface has; C keeps the thread first at the price of
putting fields of the draft in the panel, which the editor template never does.

## Decisions

### Three routes, three templates

- `/shops/:shopId/tickets` — `TicketsPage`, the index.
- `/shops/:shopId/tickets/new` — `NewTicketPage`, a `CreatePage`. `new` is a static segment and
  outranks the identifier beside it, as it does under orders, customers and scenarios.
- `/shops/:shopId/tickets/:ticketId` — `TicketEditorRoute`, which keys the editor by the ticket,
  so moving to another of the customer's tickets is a new editor and nothing typed or armed on
  one — a composer's draft, a confirm — follows the operator to the next.

### The index

`PageHeader` "Tickets", one sentence saying what a ticket is, and *New ticket* with the create
glyph. One card titled "Raised in this shop" — added to *Index card titles* — with a
`SearchField` over the subject, the reference and the customer, and `FilterChips`: All,
Published, Never published, Open, Resolved. `TicketSummarySchema` carries
`latest_published_version` and `status`, and those are the subsets the listing can count; Open
and Resolved take the check — the `published` kind, which is the classifier's `ok` under the
README's "check = published/active" and which Orders' *Open* already takes — because the
prototype's own classifier (`filterKind`, :5568) gives it every label it does not otherwise
place. The table: the subject as the link with
the mono reference under it, the customer, the channel with "from <origin>" under it, the status
as `TicketStatusBadge` draws it, Published in the words the other indexes write, and Draft
updated.

The listing is the one the rail counts, held by the shop's shell (ADR 0056), so the All chip and
the rail's figure are one number and "N in this shop" goes. With no ticket the card says a ticket
is raised by a customer attached to this shop, and links to Customers when none is; a miss reads
"No ticket matches this view"; a failed listing says its failure and nothing else — no chips, no
search box and no empty sentence, because a listing that could not be read has not said the shop
holds nothing.

### Nothing redirects

The index no longer opens the newest ticket. The list is a table now and choosing is what an
index is for; the redirect was also what made the tour table name a second address and what the
create had to be guarded against. Both go with it: `TOURS.tickets` loses `alsoAt`, and the
create page navigates once.

### The create page

`CreatePage` asks what the lab fixes or asks at creation: Subject, Customer — the customers
attached to this shop only, already chosen when there is one (ADR 0064), and fixed at creation
(ADR 0016) — Channel, from the shop's own channels, and Reference, a `DerivedIdField` following
`nextReference("T", …)` under `TICKET_REFERENCE_RULE`, closed while the listing that decides
which reference is free is loading or a create's re-read is moving it, and left open and empty
when that listing failed. A *Created as a draft* card says the ticket is created with no message
and that the thread — the history and the first message every arm receives — is written in the
editor, where the gate names the first message until it is there.

Create is `CreatePage`'s `PrimaryAction`, named "Create ticket" as the other create pages name
theirs, and refused with one sentence in the order the operator meets the questions: the shop
still being read, no attached customer, no subject, no customer chosen, no reference, a taken
reference. A refused create stays on the page with the lab's sentence under the button. A create
that lands re-reads `listings.tickets` and navigates to the editor; a re-read that fails does not
turn the ticket that exists into a failed create. A half-typed ticket is not unsaved work and is
not asked about (ADR 0051). The route is one of `CREATE_ROUTES`, so it has no tour.

### The editor

The editor template, whole. A pinned `PageHeader` with the subject as its title ("Untitled
ticket" while it is emptied), the reference as a mono chip, the status, `VersionChips`,
`EditorSaveActions`, `PublishButton` and, beneath them, the failure, the published version
("A scenario built on this ticket freezes this exact version.") and `PublishReasons`. The way back
to Tickets is in `description`, where the other editors keep theirs until the header has a slot,
beside the channel, the origin with its product named by title (ADR 0067) and the draft
fingerprint.

The main column: **Incident** — Subject, Status, Channel, Opened from with its product or order,
on field rows, then Tags; **Conversation** — the prior history, the trigger divider and the
bubbles, each removal asked twice (ADR 0060), with the composer as the card's add form below its
rule, *Add a history message* and *Add to thread* keeping their names and *Add to thread* its
refusals (ADR 0063); **Linked orders**, with an order the shop can no longer resolve kept as a row
with its Unlink; **Suggested documents**, grouped by kind in the Documents table's order and
under its chips' names, with an unresolved suggestion kept removable by its kind and slug.

The side panel: `GateCard` "Publish gate" over `IssueList`, a frame and nothing more; **Customer**,
read-only, with the customer's other tickets in this shop inside it; and "What publishing
freezes", saying a scenario built on the ticket freezes a published version. Linked orders and
suggested documents are checkboxes over the draft, so they are main-column cards: the panel holds
no field of the draft.

A save — the button's or the navigation prompt's — re-reads the context and the listing the
index renders; a publish re-reads the listing, whose Published column moves.

### The thread still authors history

Unchanged from ADR 0016: the composer writes as the customer or as past support, never a live
reply, which happens on the bench, one independent thread per arm.

### ADR 0066, amended

The ticket editor is its own page, so its header is a `PageHeader` with `sticky` like the other
editors', held at the pane's edge and decided on a third of the pane; `stickyInsetHeaderClasses`
had no other consumer and is removed. The case ADR 0066 left as a follow-up is closed:
`sticky-header.spec.ts` presses nothing to scroll and finds Save in view at the foot of the
ticket at 1366×620, where it used to leave with the thread's column. The ticket editor and the
create page join that spec's surface table, as an editor and a create page.

### Tours

The `tickets` tour is the index's alone; the editor and the create page carry none, as no other
editor or create page does.

## Departures

- **The composition.** The prototype's three panes (:2170–2322) and the README's "Three-pane;
  header spans list + customer panel" are not built: the surface is an index, a create page and
  an editor, the operator's decision.
- **Chips on Tickets.** The prototype draws none; the four built besides All are the subsets the
  listing can count.
- **The thread's subject.** Georgia 19px in the prototype (:2200), drawn as the page title at
  `PageHeader`'s 24px — the *Page title* departure already in force.
- **The prototype's panel.** Its *Linked to this ticket* and *Scenario context* sections are
  main-column cards, because they hold fields of the draft; *Used by* stays undrawn, as ADR 0016
  left it.
- **Tags.** `ChipListField` is a fieldset with its own legend and hint and has no row
  arrangement, so the tags follow the Incident card's rows, as the customer's persona traits
  follow theirs.

## What changed for an operator, and for the specs

- *Open ticket* is *Create ticket*; a Create pressed before the listing answers is refused with
  its reason rather than answered by an alert after the press (ADR 0063).
- The cards are named for what they are: *Ticket thread* is *Conversation*, *Ticket details* is
  *Incident*, *Linked objects* is *Linked orders*, *Validation* is *Publish gate*, and *Other
  tickets from this customer* is a region inside *Customer*.
- A row of the index no longer draws the ticket's trigger preview (`TicketSummarySchema.preview`,
  the old list's third line): the table names the incident by its subject, as every index names
  a record by its title, and the first message is read in the Conversation card.
- The ticket's heading is its subject, with the reference in a chip beside it, where it read
  "T-204 · Wrong address concern".
- Moving between tickets goes through the index or the customer's other tickets: the list is not
  beside the editor any more. The unsaved-work prompt asks on either way out (ADR 0051).

`ticket-authoring`, `scenario-authoring` and `experiment-start` create the ticket through the
create page and reach its cards by their new names; `sticky-header` opens the ticket at its own
address — the fixture in `tests/e2e/support/lab.ts` now returns the ticket's id — and
`tour-anchors` no longer settles on an address the index replaced.

## Verification

- `Tickets.test.tsx`: the index's header, glyph and description; the chips, their counts and the
  rail's figure; a chip narrowing the table and back; the search over three fields leaving the
  counts alone; the row and its link; the empty state with and without its link to Customers; the
  miss; a failed listing alone; no redirect, and the index's tour. The create page at its own
  address with no tour; Create refused by subject then by customer, by a taken reference and
  while the shop is read; the one customer chosen; the hints; the shop's channels; the derived
  reference; the field closed while a create is in flight; landing in the editor with the listing
  the rail counts read again, in one navigation; a refused create kept on the page; a failed
  re-read that still opens the ticket; no prompt on leaving. The editor's pinned header, its
  cards and panel in order with no field in the panel, the freeze card, no tour; the thread, the
  composer as the card's add form and every guarantee the page held before — the confirms, a
  confirm not following to another ticket, the refusals, the unresolved rows, the origin picker,
  the tags, the save's payload, the prompt asked by the header's way back and by another
  ticket's link, the prompt's save re-reading the listing, the published notice
  and a refused publish.
- `App.test.tsx`: the route table and the eleven create routes against `CREATE_ROUTES`;
  `lib/tours.test.ts` and `TourLaunch.test.tsx`: the index's tour, none on the editor or the
  create page.
- Playwright: `ticket-authoring`, `scenario-authoring`, `experiment-start`, `sticky-header`,
  `workspace-shell` and `tour-anchors`.

## Consequences

- Milestone 9's next slices take the ticket editor with the others: the header's back slot, the
  card's description, the `EntryCard` lists and the add form's shared class set, which the
  Conversation card composes locally until that set moves to `lib/ui.ts`.
- The index's Published column becomes the publication pill with every other index's.
