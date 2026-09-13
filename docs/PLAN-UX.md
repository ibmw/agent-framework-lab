# UX plan — forms that guide the operator

Status: proposed — 2026-09-13

## Purpose and authority

`docs/PLAN.md` records what the lab holds; this plan records how the person authoring it is helped
along. It turns the workspace assessment of 13 September 2026 — every route under `apps/web/src`
read against one question, *what does the operator have to type, know or guess that the workspace
could do for them* — into slices that each fit one short-lived branch. The full backlog with file
and line references is the artifact "Lab Workspace UX Backlog":
https://claude.ai/code/artifact/99fd3d9f-1a9d-4399-bc89-80c12f4f150f.

The assessment found the same dozen defects repeated across thirty-three routes, and found that
the codebase already holds the right answer to most of them somewhere: the shop slug that follows
the name until edited, the block library's live "Saved as" preview, the order editor's two-step
delete confirm, the scenario editor's explained option lists, the judge editor's model datalist.
Every slice below generalises a pattern that exists rather than inventing one, and names where the
pattern is taken from.

This plan sits under `docs/PLAN.md`'s delivery rules and changes none of them. Read, in order,
`AGENTS.md`, `docs/product-direction.md`, `docs/architecture.md`, `docs/PLAN.md`'s delivery rules,
then this plan and the ADRs a slice names. UI work also reads `docs/design-direction.md`.

## What every slice observes

- **One branch, one slice.** Branch from an up-to-date `main`, land by fast-forward, delete the
  branch. The suggested branch name is given per slice.
- **The primitive ships with its first consumers.** A shared component that no page uses is not a
  slice. Each slice below names the component it adds and the pages that adopt it in the same
  branch; later slices extend adoption.
- **Behaviour tests first.** Vitest with React Testing Library for what the operator sees, MSW
  where HTTP participates. Playwright only where a covered journey changes; the "Checks" line of
  each slice names the specs it touches. `make check` and `pnpm build` pass before handoff.
- **No new UI dependency.** The primitives are built on the class sets in `lib/ui.ts` and the
  chrome in `components/WorkspaceChrome.tsx`, like everything else in the workspace.
- **No backend change unless the slice says so.** Two slices carry a small additive contract
  change; each ships the OpenAPI update, the backend and the consumer together, as
  `docs/PLAN.md` requires.
- **Standing decisions hold.** ADR 0044 refused a stored checklist and ADR 0045 removed the
  derived progress strip; ADR 0049 keeps the ten-step chain on each surface's tour. Nothing here
  stores progress or reintroduces a strip. Where a slice records a decision of its own — a
  convention, a router migration, a confirm policy — it writes an ADR.
- **Frames.** The product editor (frame 2c), experiment setup (7), live bench (8) and results (9)
  are in the eighteen-frame set and the slices that touch them name them. The shops index, the
  four shop-setup pages, the identity and judge listings and settings are frameless, as
  `docs/PLAN.md` already records, and stay built from the existing chrome.

## Vocabulary of the primitives this plan adds

| Primitive | What it is | Taken from |
| --- | --- | --- |
| `FieldHint` | One muted line under a control, tied to it by `aria-describedby`; the place a format rule or a consequence is written so it is read rather than hovered. | The radio-with-detail rows in the agent editor's memory modes and the judge editor's scopes. |
| `DerivedIdField` | An identifier that follows its source field until edited, is handed back when emptied, previews as "Saved as `…`", and refuses a value already taken. | `ShopsPage` slug ↔ name; `BlockLibraryPage` "Saved as"; `slugify` / `uniqueId` in `lib/entryIds.ts`. |
| `nextReference` | The next free business reference for a prefix (`NS-10483`, `T-2042`), prefilled and editable. | Sibling of `uniqueId`. |
| Label maps | One `label(value)` per enum, with an explanation where a select needs one. | `lib/orders.ts`, `lib/tickets.ts`, `readableTerm` in `lib/agents.ts`, `OUTCOMES` in `lib/evidence.ts`. |
| `ChipListField` | A list of short values entered one at a time, each a chip with a named remove button, duplicates refused inline. | Ticket tags (which normalise and label) and customer traits (which do not). |
| `EntryCard` edit mode | The saved row opens its fields in place with Save and Cancel. | Support-identity guidance rows, which already edit inline. |
| `ConfirmRemove` | The two-step inline confirm, or a transient "Removed X — Undo" status where the removal is local until Save. | `OrderEditorPage` line removal; the seed button's two-press confirm on settings. |
| `ActionStatus` | One `aria-live` line under a control that reports "Running Arm A… 1 of 2" and then "Done", with `aria-busy` on the affected card. | History's stale-listing dimming; the fork button's `aria-describedby` reason. |

## Sequencing

Slices 1, 3 and 4 depend on nothing and can proceed in parallel. Slice 2 builds on 1 (its
preview line is a `FieldHint`). Slices 5 and 6 build on 1 and 3. Slice 7 builds on 5 (edit mode
reuses the chip field). Slice 9 builds on 8 (a confirm and a discard share the router
migration's blocker). Slices 10 to 16 build on 1 and 3 only and are otherwise independent. The
order below is the recommended one because each slice leaves the next with less to write.

## Milestone 8 — Forms that guide the operator

### Goal

An operator who has never read this roadmap can create a shop, a product, a customer, an order, a
ticket, a scenario and an agent, and reach a two-arm run, without typing an identifier by hand,
without hovering to learn a format, without losing an edit to a stray click, and without meeting
a publish-gate error the form could have caught.

### Slice 1 — Guidance lives under the field

- [x] Add `FieldHint` and a required-field convention: the minority is marked, "(optional)" as the
  product editor already writes on price, and the convention is written once in
  `docs/design-direction.md`.
- [x] Rewrite every create form on it: Shops, Products, Customers, Orders, Tickets, Scenarios,
  Support identities, Agent configurations, Judges, the two block libraries. Each free-text field
  gets a placeholder that is a realistic example, and each `title=`-only rule on those forms moves
  into the hint.
- [x] Render a create form's error inside its card, keeping the page-level alert for load errors.
- [x] Record the guidance convention: tours explain a surface, hints explain a field, `title=` is
  never the only carrier of a rule.

Frames: none. The create forms are the frameless cards in the right column of each index.

Branch: `feat/field-hints`. Checks: Vitest per page asserting the hint is in the accessible
description of its control; no Playwright.

Slice evidence: an operator on the products page reads, under the handle field and before typing,
that a handle is lowercase with hyphens and is how tools address the product; under the shop's
slug, that it follows the name until edited. A create that fails shows why beside the button that
failed, not above a table they were not looking at. Every hint the page shows is in the control's
accessible description, so a reader without a pointer has the same rule.

### Slice 2 — Identifiers are derived, never asked first

- [ ] Add `DerivedIdField` and `nextReference`, with the shop create form's slug moved onto the
  component so its behaviour is the shared one.
- [ ] Products: Title first, then Category, then the handle derived from the title with a live
  "Saved as" preview; a handle already in the draft is refused before submit rather than merging
  two products into one editor.
- [ ] Product editor: option key from option name, attribute key from label, review ID derived
  from the author and shown only as an `EntryId` on the saved row.
- [ ] Shop details: payment and fulfilment IDs from their names. Policies, FAQ, support guidelines
  and tone: IDs from title, question or name, in that field order.
- [ ] Block editor: the parameter form asks for a label, previews the identifier it will save, and
  stops suggesting `doc_ref` as something to type.
- [ ] Orders and tickets: the reference is prefilled from the shop's existing references and
  editable; a duplicate is refused inline.

Frames: 2c (product editor).

Branch: `feat/derived-identifiers`. Checks: `lib/entryIds.test.ts` and a new `nextReference`
table; page tests for follow-until-edited, empty-to-resume, and collision on each form;
Playwright `shop-publication`, `order-fixture` and `ticket-authoring` type identifiers today and
change with the field order.

Slice evidence: an operator types "Alpine Shell Jacket" and watches `alpine-shell-jacket` appear
under it; they change it to `alpine-jacket`, then empty it, and the derivation returns. A second
product with the same title is offered `alpine-shell-jacket-2` and told why. An order form opens
with `NS-10483` already in it. Nowhere in the workspace is an ID field the first thing on a form.

### Slice 3 — Every enum has a name

- [ ] One label map per enum, sourced from the contract's union type so a new member fails a
  table test rather than rendering raw: product status, variant availability, attribute type,
  payment kind, policy kind, channel, permission, customer background kind, judge scope, sandbox
  definition type, tool outcome, and the order and ticket statuses that still leak through on
  linked-order rows and the version page.
- [ ] Selects that need it use the scenario editor's "label — explanation" option style;
  permissions read "Issue refund — refund an order in full or part".
- [ ] Status columns pair a glyph with the label, never colour alone, on the `StatusPill` model.
- [ ] Remove the five hand-written `.replace(/_/g, " ")` and route them through the maps.

Frames: none.

Branch: `feat/enum-labels`. Checks: one sweep test per map over the contract union, the pattern
`tours.test.ts` uses over `TOUR_IDS`; page tests that select by label; no Playwright unless a spec
selects an option by its visible text.

Slice evidence: nowhere in the workspace does an operator read `in_stock`, `gift_card` or
`bank_transfer`. A permission checkbox says what it grants. Adding a member to a contract enum
without a label fails `make check` naming the enum and the member.

### Slice 4 — A shop sells in several currencies from the start

- [ ] Extract the currency checkbox group from Shop details into one `CurrencyField` showing
  "EUR — Euro", with the group hint "Variants may only be priced in these; the first is the
  default", and use it on the create form with the locale's currency pre-ticked.
- [ ] Keep the locale-to-currency suggestion: it ticks the first currency until the operator
  chooses, on the same terms the slug follows the name.
- [ ] Show the channel group on the create form, or state in the footnote that the shop starts on
  chat and where to add email and phone.
- [ ] Echo the chosen locale's label under `LocaleField` so `en-GB` reads as a place.

Frames: none.

Branch: `feat/create-shop-currencies`. Checks: `Shops.test.tsx` for the multi-select payload and
the suggestion; Playwright `shop-publication` creates a shop and changes with the form.

Slice evidence: an operator creating a Swiss shop ticks CHF and EUR on the create form and is not
sent to Shop details to add the second. The request carries both, the first as the default, and a
variant priced in either passes the gate.

### Slice 5 — Chips, countries and numbers

- [ ] Add `ChipListField` and use it for option values, attribute choices, customer traits, ticket
  tags and escalation conditions, retiring the two hand-rolled versions.
- [ ] Add `CountryField`, a datalist of ISO codes with names on the `LocaleField` model, used in
  the customer address form and on existing address rows.
- [ ] Constrain numbers: price and shipping fee take `inputMode="decimal"` with a two-decimal
  pattern and a currency suffix; temperature takes a decimal pattern with its range as the hint
  and the "exact decimal" note moved under the field; seed takes an integer range hint and
  `step="1"`; review rating becomes a five-star radio group.
- [ ] Customer editor: identity email as `type="email"`, phone as `type="tel"`, background date
  defaulting to today rather than a fixed day.

Frames: 2c (product editor), 6b (customer editor).

Branch: `feat/typed-controls`. Checks: component tests for `ChipListField` (add, duplicate
refused, named remove) and `CountryField`; page tests for each adopting form; Playwright
`customer-publication` if it types a country.

Slice evidence: an operator adds "Ocean Blue" and "Charcoal" as two chips and cannot add "Ocean
Blue" twice; types "fr" in the country field and is offered France with its code; cannot save a
shipping fee of "abc" as zero. A screen reader announces "Remove Ocean Blue", not "×".

### Slice 6 — Closed sets the lab already knows

- [ ] Agent editor: provider becomes a select filtered by the chosen framework's proven providers;
  model becomes an input with the datalist of proven models, the judge editor's pattern; changing
  the framework resets or flags a value that went off-list.
- [ ] Agent editor: the tone override lists the preview shop's tone guidelines in a datalist and
  echoes the resolved label beside the field. This needs the preview-shop option payload to carry
  the shop's guideline IDs and names: an additive contract change shipped with its backend and
  this consumer.
- [ ] Judge editor: a provider change resets the model to the provider's first proven one.
- [ ] Products: category offers a datalist of categories already in the draft.
- [ ] Tool console: the acting identity defaults when exactly one is published; arguments carry
  `required` and a type from their declared kind, with humanised labels.

Frames: 5 (agent configuration).

Branch: `feat/closed-set-fields`. Checks: `AgentConfigurations.test.tsx` and
`JudgeConfigurations.test.tsx` for the filtered lists and the reset; a contract test for the
extended preview payload; Playwright `agent-configuration` if it types a provider or model.

Slice evidence: an operator choosing OpenAI Agents SDK is offered the providers and models the
settings page says are proven, and cannot publish a configuration naming one that is not without
being told so in the field. Choosing a tone override is choosing from the shop's own list, and the
name the run will resolve is shown beside the ID.

### Slice 7 — Every saved entry can be edited in place

- [ ] Give `EntryCard` an edit mode: the row's fields open inline with Save and Cancel, the
  identifier stays fixed and visible, and the payload written is the same one the add form would
  write.
- [ ] Adopt it on policies, FAQ, support guidelines, tone, payment methods and fulfilment methods;
  on product options, media, attributes and reviews; on variant SKU and option values; on
  customer background entries and hidden facts.
- [ ] Hidden-fact and guidance rows gain visible labels where they had only `aria-label`.

Frames: 2c (product editor), 6b (customer editor).

Branch: `feat/edit-in-place`. Checks: `EntryCard` tests for open, save, cancel; page tests that
edit one field of a saved entry and assert the saved payload changed only that field; Playwright
`shop-publication` if it edits a policy.

Slice evidence: an operator fixes one word in a three-paragraph returns policy by opening the
row, changing the word and pressing Save, and the draft's change summary reports one updated
field. Nothing in the workspace still asks them to remove and retype an entry to correct it.

### Slice 8 — Unsaved work is protected

- [ ] Move the app from `BrowserRouter` to `createBrowserRouter` and `RouterProvider`, with the
  existing route tree unchanged, because `useBlocker` is only available on a data router.
- [ ] Guard `dirty` once inside `useDefinitionEditor` with `beforeunload` and `useBlocker`, and
  in the order editor which tracks its own; a blocked navigation offers Save, Discard and Stay.
- [ ] Add a "Discard changes" action beside Save on every editor, which re-fetches the draft.
- [ ] Render the clean state as a status ("All changes saved") rather than a disabled accent
  button reading "Saved".
- [ ] Record the router migration, the guard's placement in the hook, and the three-way prompt in
  an ADR.

Frames: none.

Branch: `feat/unsaved-changes-guard`. Checks: `definitionEditor` tests for the blocker and the
discard; `App.test.tsx` for the route tree under the new router; the whole Playwright suite,
because every spec navigates and `workspace-shell` and `tour` cover the shell.

Slice evidence: an operator edits a product description, clicks Orders in the rail and is asked
whether to save, discard or stay; reloads the tab and the browser asks first. Pressing Discard
returns the draft to what the server holds. No spec in the suite drove a page through the new
prompt unintentionally, which is what running all of them proves.

### Slice 9 — Removing things is deliberate

- [ ] Add `ConfirmRemove`, the order editor's two-step inline confirm, and use it on every Remove
  that is not trivially re-added: addresses, background entries, hidden facts, guidance rows,
  escalation conditions, policies and the other setup entries, the ticket's trigger message,
  detaching a profile from the shop.
- [ ] Removing a product option that variants still choose says how many, and what happens to
  them.
- [ ] Add Delete and Duplicate to the product editor header, and a row action on the index;
  Delete confirms and names any order line that references one of the product's variants.
- [ ] Detaching a profile confirms and then returns to Customers rather than leaving the editor on
  a profile the shop no longer lists.

Frames: 2c (product editor), which draws Delete and Duplicate in its header.

Branch: `feat/deliberate-removal`. Checks: page tests that a Remove needs two presses and that
the first press can be cancelled; product delete and duplicate tests on the draft payload;
Playwright `shop-publication` if it removes an entry.

Slice evidence: an operator can delete a product for the first time since the catalog shipped,
and is told before doing so that order NS-10482 names one of its variants. Every Remove in the
workspace asks once, and the first press of every one can be walked back.

### Slice 10 — After create, open what you created

- [ ] Navigate into the new draft after every create that does not already: products, customers,
  orders, scenarios, support identities, agent configurations, judges, block templates. Tickets
  already does and is the model.
- [ ] Where the operator is better left on the list, show a `role="status"` line with a link to
  what was created.
- [ ] Empty states that disable a create say why, and link to the prerequisite: the attach form
  with nothing left to attach, the configuration select with nothing published.

Frames: none.

Branch: `feat/create-then-continue`. Checks: page tests asserting the navigation target after
create; Playwright specs that create and then click into the created item shorten by one step
and change accordingly.

Slice evidence: an operator presses "Add to draft" and is standing in the product editor with the
title they typed in its header. No footnote in the workspace tells them to go somewhere the button
did not take them.

### Slice 11 — Long-running actions report themselves

- [ ] Add `ActionStatus` and use it under the bench composer ("Running Arm A… 1 of 2, this can
  take a minute"), on advance, score, replay, fork and snapshot freeze, with `aria-busy` and
  dimming on the affected card.
- [ ] State that there is no cancel, rather than leaving the operator to wonder.
- [ ] Replay and Fork get a one-line description beside their buttons.
- [ ] Show the publish gate's loading state on Home ("Checking the draft…") where
  `PublishReasons` today renders nothing.

Frames: 8 (live bench), 9 (results).

Branch: `feat/action-status`. Checks: `ExperimentBench` tests for the status text while an arm
runs and after; results layout tests for replay and fork copy; Playwright `experiment-start` if
it waits on a run.

Slice evidence: an operator sends a customer turn to two arms and watches which arm is running,
how many are left, and when both are done, without the page changing only a button label.

### Slice 12 — The form says it before the gate does

- [ ] Fulfilment: max transit days must be at least min, inline.
- [ ] Variants: setting stock to zero while "in stock" flags the row or switches availability with
  a note; an active product with no priced variant is said on the add form.
- [ ] Orders: `paid_at` and `shipped_at` prefill from `placed_at` when the status moves and the
  field is empty, with the rule as a hint.
- [ ] Scenario editor: caps read "N of 12" in the card title and explain themselves when reached;
  the timing choice gains "At turn…" with a number input; free-text bindings carry a
  kind-specific hint; the template picker shows each template's statement and marks drafts as
  unpublishable.
- [ ] Block editor: the parameter description is on the add form with a hint that scenario authors
  read it; "Optional parameters need a default" sits beside the checkbox.
- [ ] Judge editor: reserved terms are highlighted in the rubric as they are typed, on the
  `ResolvedPrompt` chip model; the rubric is required and carries an example.
- [ ] Experiment setup: Start is disabled until a scenario, an arm and a name exist, with what is
  missing listed beside it on the `PublishReasons` model; a failed preview's error clears on the
  next success.

Frames: 2c, 4 (scenario editor), 7 (experiment setup).

Branch: `feat/inline-validation`. Checks: page tests per rule; Playwright `scenario-authoring`
and `experiment-start` if they bind a turn or press Start with something missing.

Slice evidence: an operator who types a minimum of 5 and a maximum of 3 transit days is told
under the field, not at the publish gate after a save. Start on the bench is grey until it can
work and says what it is waiting for.

### Slice 13 — Findings link to the fix and the next step is named

- [ ] `IssueList` maps each finding's path to the route and, where one exists, the entry that
  resolves it, and renders the finding as a link.
- [ ] After a publish and in every "nothing yet" empty state, print the step the chain says this
  unlocks, from `SETUP_CHAIN` in `lib/setupPath.ts`, with a link to that surface. Home's
  "No published version yet" state and its post-publish message are the first two.
- [ ] Record in an ADR that this is a link to what the gate already says and a sentence the chain
  already holds — not a reading of progress — so it stays inside ADR 0044, 0045 and 0049.

Frames: 1 (shop home).

Branch: `feat/findings-link-to-fix`. Checks: `IssueList` tests over every gate code the domain
raises, the sweep pattern; `ShopHome` tests for the next-step sentence; no Playwright.

Slice evidence: an operator whose draft is refused for a variant without a price clicks the
finding and lands on that product with the variant in view. Having published, they read that a
published shop unlocks customers and orders, with a link, and nothing was stored to say so.

### Slice 14 — Defaults, and the experiment setup as a sequence

- [ ] One rule for versions: default to the newest published, on arm configurations as the
  scenario and the fork picker already do.
- [ ] One rule for single choices: a select with exactly one candidate opens on it — the only
  scenario, the only published configuration, the only acting identity.
- [ ] Experiment setup: name at the top with a default derived from the scenario and the arms; the
  seed under the scenario with its meaning as a hint; "Scenario" as the one name for the card,
  the label and the option; the empty configuration state explains itself; recent experiments are
  links.
- [ ] Customers: locale defaults from the shop rather than `en-GB`; "customer since" defaults to
  today.

Frames: 7 (experiment setup).

Branch: `feat/sensible-defaults`. Checks: `ExperimentSetup` tests for both rules and the field
order; `Customers.test.tsx` for the locale; Playwright `experiment-start` changes with the
default arm version.

Slice evidence: an operator with one published scenario and one published configuration opens
the bench and finds both chosen at their newest version, a name proposed, and only Start left to
press.

### Slice 15 — Save stays in reach

- [ ] Make the workspace page header sticky within the scrolling main pane, so Save, Publish and
  the tour launch are in view at the foot of a six-card editor.
- [ ] Keep `PublishReasons` beside the sticky Publish where it is rendered in the header.

Frames: none; this is a behaviour of `PageHeader` on every surface.

Branch: `feat/sticky-actions`. Checks: `WorkspaceChrome` tests for the header's role and order;
Playwright `tour-anchors`, because the tour lights the page name in the header.

Slice evidence: an operator at the bottom of the product editor's reviews card presses Save
without scrolling, and the tour's first step still finds the page name where it expects it.

### Slice 16 — Consistency sweep

- [ ] One name per thing: "Scenario" not "Recipe"; "Bench" for the list and "Live bench" for a
  run; "Results" for the results page across History, the layout and its tabs; "Freeze" for
  snapshots throughout; "Never published" on every index.
- [ ] A non-interactive `chipClasses` in `lib/ui.ts` for the tool-call, attempt and fault chips
  on the bench and the timeline, which wear button classes today; their `title=` detail moves
  into visible text or links to the timeline.
- [ ] The objective matrix gains a visible legend and, outside compact mode, the evidence sentence
  under each cell; verdicts show statements and outcome labels.
- [ ] Results arm summaries link the configuration and scenario versions to their editors with
  the version chip, so a finding leads back to the recipe that produced it.
- [ ] History gains "Clear filters"; the search button moves to the end of the form.
- [ ] Ticket origin products and suggested documents show titles: the ticket context payload
  carries them, an additive contract change shipped with its backend and this consumer.
- [ ] `Fingerprint` offers a copy control and an `sr-only` full value.
- [ ] Settings: the Trace export card no longer clips its code spans.
- [ ] Card footers on the bench and results pages render through `GuideProse` so defined words
  link to `/glossary`, as ADR 0049 intends.

Frames: 3 (tickets), 8, 9, 9a, 10 (history).

Branch: `feat/naming-and-chips`, split further if the ticket contract change deserves its own
branch. Checks: page tests per item; a contract test for the ticket context payload; Playwright
`ticket-authoring` and `experiment-start` where copy they assert on changes.

Slice evidence: an operator reading a finished experiment clicks the configuration version in an
arm's summary and lands on the draft that produced it, with the version chip saying which one.
The same word means the same thing on every surface it appears on.

### Acceptance criteria

- No form in the workspace asks for an identifier before the name it derives from, and no
  identifier field is the first field on a form.
- No rule an operator must follow is carried only by `title=`; every hint is in its control's
  accessible description.
- No enum value from a contract union renders raw anywhere the operator reads it.
- No saved entry in any draft must be removed to be corrected.
- No navigation, reload or Remove discards an edit without asking once.
- Every create that has an editor ends in that editor.
- Every publish-gate finding links to where it is resolved, and nothing about progress is stored.
- A two-arm run can be reached from an empty database without typing an ID, a reference, a
  provider name or a currency code.

## Deliberately not here

- **A stored checklist or a progress strip.** Refused by ADR 0044 and removed by ADR 0045; Slice
  13 links to what the gate says and prints what the chain holds, and reads nothing else.
- **A component library.** The primitives are class sets and small components on the existing
  chrome; a dependency that brought its own form model would replace what every page already uses.
- **New frames.** Every surface a slice touches is either in the eighteen-frame set, which the
  slice names, or frameless by `docs/PLAN.md`'s existing record. No slice invents a layout.
- **Read-only version pages for configurations and scenarios.** Slice 16 links to the editor
  with the version chip; a frozen read-only view per definition, on the `ShopVersionPage` model,
  is worth its own slice in `docs/PLAN.md` if a review journey needs it.
- **Backend validation moved into the browser.** Slice 12 says what the gate will say, earlier;
  the gate stays the authority and the tests for it are unchanged.
