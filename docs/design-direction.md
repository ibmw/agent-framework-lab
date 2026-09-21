# Design direction

Status: current — 2026-09-21. The design rules that govern `apps/web`, stated once as rules a slice
is checked against. Values are not restated here: a measurement or a colour that is built lives
in the code that draws it (`styles.css` for tokens, `lib/ui.ts` for class sets and glyph tables,
`shell/AppShell.tsx` for the chrome), and one that is not yet built lives in its slice in
`docs/PLAN-UX.md`. How each rule was reached is `docs/history/design-direction.md`; the
exploration the direction came from is `docs/history/design-brief.md`. ADR 0050 says the
guidance conventions *are* sections of this document; they are, under *The form language*.

## Principles

Carried forward from the brief; they outrank any measurement below.

- **Evidence before opinion.** The conversation is shown beside tools, arguments, confirmations,
  state changes, errors, traces and objective results. Comparison is never an unexplained score,
  and no surface declares the fewest tokens or the shortest conversation the winner.
- **Three evidence layers, kept distinct**: deterministic, LLM-judged, quantitative. Efficiency
  is read only beside a successful outcome.
- **Progressive technical depth.** Outcome, then timeline, then trace, then project-owned source,
  without losing run context.
- **Reproducibility is visible.** Published versions, fingerprints, configuration and judge
  versions, replay and fork relationships are reachable without dominating every screen.
- **Tool-first is legible.** What the agent was handed and what it discovered through tools are
  told apart on screen.
- **Honest comparison.** Two arms start from equivalent snapshots; where operator input diverged
  is recorded and shown, never smoothed over.
- **Extensible without feeling unbounded.** Editors grow by optional sections and typed
  attributes, never into one mega-form or a JSON editor.
- **Status is never colour alone**: a glyph or a word always accompanies it. WCAG 2.2 AA
  contrast; every workflow keyboard-reachable.
- **Desktop first, usable narrower.** Every row and card row wraps; nothing is fixed width except
  the rail, the ticket side panels and the settings column cap. No narrow-width treatment of the
  live comparison is drawn.
- **Dense is fine, decorative is not.** No dashboard metrics for their own sake, no oversized
  status cards, realistic content rather than placeholder text.
- **Every state is designed for**: empty, draft with findings, published and immutable, tool in
  flight or refused or in conflict, exact-action confirmation, linked and split input, one arm
  waiting, objective passed or failed or pending, judge queued or failed or rerun, a historical
  run with newer versions available, an unsupported capability.

## Direction

**Direction A, the studio-first workbench**, with three strengths taken from the other candidates:
director's notes on the live bench, an objectives matrix on the bench and the results, and bench
zoning where the split conversation takes the width. The Studio is a **shop-scoped admin
workspace** in a neutral light admin language — persistent resource navigation, index tables
with status pills, resource detail pages — with the lab's pine and paper identity in the top bar,
the accents and the display type. Tickets use the three-pane helpdesk anatomy and author
*history*, never live replies. The scenario editor composes shared block libraries. The prompt
editor renders markdown with inline variable chips and a grouped insert menu whose customer,
order and ticket facts are visibly non-injectable.

## Authority — what a UI slice cites

The **whole-workspace prototype** handed over on 19 September 2026 is the authority for
everything that crosses screens. It lives under `tmp/design-frames/`, which is not versioned on
purpose: its values belong in the code, and this document does not copy them either.

| File | Role |
| --- | --- |
| `Workspace.html`, `Workspace.dc.html` | The design, and its markup; a `Frames:` line cites a line number of the `.dc.html` |
| `README.md` | The handoff: chrome, screens, the form pattern, interactions, tokens, type, radii, glyphs |
| `form-decisions.md` | The locked form language, variant 2 of every component, and why |
| `DEPRECADED/*.dc.html` | The eighteen per-screen frames of 23 August; still cite a surface's composition where the prototype is silent |

Where they disagree, in this order:

| Rule | Decides |
| --- | --- |
| 1. The prototype supersedes a frame | wherever the two disagree |
| 2. README silent, prototype specific | the prototype governs; the README summarises and is not a ceiling |
| 3. README states a value, prototype draws another, same role | the README wins — one value against one value, never a context; a distinction the prototype draws consistently across a class is a rule the README summarised away, and rule 2 hands it to the prototype. Flattening such a class because one component serves it is a **departure**, recorded with the prototype's rule |
| 4. A README value under a heading that scopes itself | is stated for that role only; outside it, rule 2 |
| 5. Keeping what the codebase has | is licensed by an explicit release in the handoff, a repository rule that outranks a mockup (accessible names specs click; a value that already is a token), or another slice owning the decision. "The handoff is silent" is not a licence |

Every departure is written in one sentence in the slice's record. **The primitive ships with its
first consumer**: a component, token or preference no page uses is not a slice. **Lab-level
surfaces** (`/settings`, `/glossary`) are frameless and built from the existing chrome.

## Departures from the handoff, in force

Each is a deliberate difference between what the code draws and what the handoff states, with
the rule that licensed it. A slice that touches one revisits it; none is an oversight.

| What | Handoff | Built | Why |
| --- | --- | --- | --- |
| Primary token | redefine `lab-accent` to pine | new `lab-primary`; the clay stays on trace bars, the review star, a ticket's emphasis and the armed seed | those four are not the refresh's to repaint |
| Page title | 22px bound name, 24px fixed label | one `PageHeader` at 24px, and `CreatePage`'s own header at the same size | one size for the workspace, no variant yet; rule 3 |
| Card title | sans on note cards, Georgia on table and section cards | one `Card`, Georgia 17px | same |
| Compact controls | 42/40px in sub-editors and filters | the one 44px control | no compact component exists to size |
| Filter chips on Tickets, the block libraries, Policies & FAQ | drawn | none until a table exists to filter | a chip whose figure the payload lacks is not faked; Slice 16 gives documents one |
| Model on the connection, masked key | drawn | neither | ADR 0052 |
| Setup checklist | drawn on Shop details | not built | ADR 0044, ADR 0045 |
| Preferences | seven rows | two now, a third read by `/` and written in Slice 18, a fourth with the confirm slice | a preference no surface reads is not a slice |
| Support identities in shop scope | drawn on both rails, filed under Shop scope | one lab address on both rails | there is one library; two routes rendering one list would make the mode depend on which door was used (ADR 0054) |
| Mode tabs on Settings | drawn — the prototype's settings is an overlay on a mode | absent | `/settings` is a route in neither mode, and tabs there would be the one place the mode is not the branch of the tree you stand in (ADR 0054); rule 5 |
| Shop badge | a per-shop ground and ink, or a logo | initials on `lab-ink` | the payload carries no logo and no colour pair to draw; Slice 28 is where a shop gets one |
| Count on the bench entry | "1 live" | nothing | a tally of running arms in one shop, not the length of any listing the shell reads; a figure the payload lacks is not faked (ADR 0056) |
| Count on *Policies & FAQ* | `DOCUMENTS.length` — policies, guidelines and FAQ entries on one screen | policies plus FAQ entries, the two lists that page draws | the support guidelines are a different route the rail does not name, and a figure counting rows the page does not show is the disagreement the count exists to prevent (ADR 0056). **Slice 16 merges the three into one table and moves the figure with them**, and this row ends there |
| Focus ring on the bar | `2px solid #1d6241` offset outward, as everywhere else | the bar's paper, inset on the two controls that are the bar's full height | pine on `#16332d` is 1.86:1, under WCAG 2.2's 3:1 for a focus indicator, and an outward offset puts half the ring off the bar; *Principles* outrank a measurement (ADR 0055) |
| The create page's side column | 312px of notes beside the form — *What happens next*, *In a hurry?*, *Summary*, *Soundness* | the one 790px column; the notes that carry a rule are cards in it, the rest are not drawn | `form-decisions.md`'s layout 2b sizes the *form*, and a second column of prose beside a create form that asks four questions is a column that mostly repeats the hints under them; a note computed from a form nothing has written yet (*Summary*, *Soundness*) is a figure the page lacks |
| An untitled product's heading | the bound title, empty | "Untitled product" | *New product* appends a product with no title, and an empty `<h1>` leaves the page — and the tour's first anchor — with nothing to read; *Principles*, every state is designed for |
| *Attach existing* on Customers | a secondary header button that opens nothing | the same button, opening one inline row with the profile picker | the prototype's attach is a fixture with no panel behind it, and an attach in this workspace has to ask which profile; the row is not the side card the slice removed — it is the one control the question needs |
| A judge's rubric at creation | the field, under "Can be left empty now, but the judge cannot be published until it is written" | required: Create is refused and the reason names the rubric | *A create form asks for what constrains the work that follows*, and a judge with no rubric constrains nothing. Not rule 5: the codebase did create a rubricless judge, so this changes what was there rather than keeping it. What licenses the change is that sentence together with the slice's own stated evidence, and the lab's `new_judge_configuration` is the corroboration rather than the licence — it defaults the model and the evidence because they have a proven right answer, and deliberately defaults no rubric |
| Three cards on the lab's create pages | Tools on New configuration, Evidence on New judge, and an Architecture row beside a Provider select | none of the three; the Provider is the prototype's own read-only variant of that row | *A create form asks for what constrains the work that follows **and names where the rest lives*** — the *Created as a draft* card on each page is where the rest is named: a new draft reads through every tool and writes through none, and enabling a write is the act the editor exists for; the judge's evidence starts at what the lab has proven and is changed there. The Architecture row is the one of the three rule 5 reaches, because `AgentArchitecture` has a single member and *a choice of one is not a choice* — which is also why the Provider is drawn as a value rather than as a select |
| Two hints on New scenario | "It does not have to be unique, but two scenarios with one name are hard to tell apart"; "Creating the scenario freezes the ticket at its current version" | a shop answers to one scenario of each name, and Create is refused by a name it already holds; and the hint splits the freeze — the ticket and the documents it suggests are fixed by creating, the ticket *version* is pinned by publishing the scenario | both sentences describe a lab that is not this one: `_require_free_name` refuses a duplicate at create and at replace, and `ScenarioResolution.ticket_version` reads the ticket's latest published version, which `publish_scenario` is what pins. *Every hint names the code that makes it true* (*The form language*), which is the same reading `lib/fieldRules.ts` already applies to the prototype's product Status and Shop slug rows |
| The composed objectives and mutations | the chips alone, under "Bindings are added in the editor once the scenario exists" | the chips, and an ordered list under them naming each composed template and the bindings to this shop it still owes | *A create form asks for what constrains the work that follows **and names where the rest lives*** — the same sentence that licensed the three cards above, and the list is where the rest is named. The plan asks for the templates *with a binding each*, and a binding cannot be made before the first write: every binding a scenario writes is to an object of its own shop, and the pickers that offer those read `ScenarioResourcesSchema`, which is addressed under a scenario that does not exist until Create is pressed. What composing *can* carry it does — the page reads each composed template's own draft, so the severity and the literal defaults its author chose ride in with the instance exactly as they do in the editor |
| The overview's heading | the shop's name, 26px | "Overview" | the plan's own first bullet for this page — "`ShopHomePage` becomes *Overview*" — which is the licence; the rest is why it reads well: every other page in this workspace names the page rather than the shop, the rail entry that opens this one already said *Overview*, and the switcher names the shop on every screen anyway |
| "4 scenarios and 18 experiments read this one" under the latest version | drawn on the timeline | "What a scenario resolves against today." | neither figure is in any payload this page holds — a scenario's listing row carries no pinned shop version and nothing counts experiments per version — and a figure the payload lacks is not faked (*Lists and counts*). What is drawn instead is the fact the lab does hold: `ScenarioResolution` pins whatever is published when it resolves |
| "or open the live one →" under *Run a comparison* | drawn | not drawn | "the live one" is a running experiment, and `ExperimentSummarySchema` carries no status; the same rule, and the same reason the bench entry carries no "1 live" |
| *Run a comparison*'s sentence | "Everything this needs is ready: <scenario> against shop <version>" | "A comparison runs **<scenario> v1** against shop **v3**.", or, where the listing holds no published scenario, "No scenario is published in this shop yet, and a comparison runs a published scenario." with a link to Scenarios | the prototype's four opening words are a verdict nothing reads: a comparison also needs two arms on published agent configurations, which `start_experiment` refuses without and which this page never lists, so a lab holding one and not the other would be told it was ready. That is the derived progress reading ADR 0044 and ADR 0045 removed, drawn smaller. What is built is the fact the one listing holds — which scenario, at which version, against which shop version — and it was decided before this slice (`docs/PLAN-UX.md`, *Decisions already taken*) |
| *Recent activity*'s three sentences | "Scenario … v1 published", "Ticket T-204 opened by Maya Laurent" | "… updated", on each listing's own `updated_at`; an experiment reads "started", on its `created_at` | a scenario's listing row carries no published-at and a ticket's `opened_at` is an instant in the fiction rather than in this workspace, so neither sentence has a clock that means it; *every hint names the code that makes it true*, read here about a sentence rather than a field |
| The rows of *What this shop holds* | the whole row is a click target, with a link inside it | the row, with the link as its one control | a nested link inside a clickable row is two controls a keyboard reaches as one; *Principles*, every workflow keyboard-reachable |

Two items the handoff names are not built and not refused: Georgia on the results' stat
numerals, and the `document` chip kind. Each lands with the surface that first draws it, which
is what the `open` button verb just did — it landed with the overview's grouped findings, the
first control in this workspace that leaves a surface for the entry it names.

## Navigation and chrome

The values are in `shell/AppShell.tsx`; the rules are these.

- **Two modes** (ADR 0054). *Shop fixture* with the shop's rail and *Experiment lab* with a rail
  of Bench, History and a Library. Lab routes live outside shop scope under `/lab`, the two
  surfaces that read one run carry its shop in the path, every old shop-scoped lab path
  redirects and carries its shop into the remembered-shop preference, and the lab keeps a
  current shop through the switcher, present in both modes — navigating in shop mode, setting
  the lab's shop in lab mode. A lab surface that needs a shop and has none says so and links to
  the shops index; it never guesses. `/` resolves through the *where the app opens* preference,
  defaulting to the remembered shop.
- **The rail** collapses to a strip whose rows keep their accessible names; the collapsed state
  is a browser preference and never a database row (ADR 0044), and it is one preference for both
  rails. It is hidden on the shops index and on Settings. `nav[aria-label="Shop workspace"]` is
  what every spec reaches it by and does not move; the lab's is
  `nav[aria-label="Experiment lab workspace"]`. The foot control's name, copy and tooltip are one
  string. **Each entry carries its listing's count** (ADR 0056), right-aligned and muted, under
  the rule *Lists and counts* states: the whole list, absent while the listing is in flight or
  failed, zero drawn, nothing faked. The workspace holds those listings — the shop's four and
  the lab's five, plus history's total — reads each once and hands it to the rail and to the
  index that renders it, and a surface that changes what one holds reads it again. An entry's
  accessible name stays the label alone and the figure is its description; the collapsed strip
  draws no figure and still says one.
- **The top bar** (ADR 0055) sits on a token of its own and carries four things. The identity at
  the left is the shop switcher wherever there is a shop to name and the app title otherwise,
  never both; the title returns to the shops index. The **switcher is a button opening a
  `menu`** — not a select — with roving focus, `Escape`, an outside press and a navigation all
  dismissing it, and the shop's badge is its initials until Slice 28 gives it a logo. The **mode
  tabs** are drawn in a mode and absent outside one. At the right, **one** *Show me around*
  mount resolves the surface's tour from the location and is absent where no tour exists, and
  **Settings** is a toggle: lit with a close glyph while its page is open, returning to the last
  location that was not `/settings` — a browser preference, never a row (ADR 0044) — and to the
  shops index when a browser remembers none.
- **Settings is three zones** told apart by surface: per-browser preferences, saved on change;
  the lab-wide model connection with explicit Save and Discard (ADR 0052); a collapsed read-only
  runtime zone with a "To change it:" line (ADR 0044's character). The seed is its own zone
  (ADR 0047). *Planned*, Slices 18 and 19.
- **Tours** (ADR 0045, 0046, 0049, 0055): one tour per surface, the same words everywhere,
  offered from one control in the bar that reads the surface's tour from the route; an overlay
  above the page, never in it; nothing starts unbidden, nothing is remembered, no tour crosses a
  screen, a popover explains and never performs; every step and every surface's route declared
  in one table and swept by Playwright against that surface.
- **Nothing about progress is stored and no surface reads it** (ADR 0044, ADR 0045). The
  overview's readiness card reads one listing and says one sentence: it names the shop's most
  recently edited published scenario, and the shop version it would resolve against, with a
  link to New experiment — or says none is published, with a link to Scenarios. **It names
  what a comparison would run and never says that one can run**, because whether one can is a
  verdict over gates this page does not read. That is *an empty state says why and links to
  the prerequisite*, and it is the only readiness any surface reports. The overview's four jump cards are counts
  under *Lists and counts* and judge nothing — a count is what a listing holds, and a
  readiness reading is a verdict about what it does not.

## Tokens, type and glyphs

The tokens are `apps/web/src/styles.css`; the class sets, the button and chip vocabularies and
their metrics are `apps/web/src/lib/ui.ts`. Rules:

- **Pine is the primary action; the warm red is destructive and nothing else.** Every button
  variant carries a hover and a `focus-visible` ring. A destructive control keeps its glyph and
  its verb; red is a second signal.
- **Georgia for display** (page and card titles, the thread subject, the bar's title); sans for
  UI; monospace for slugs, ids, model names and env vars. Entry-row titles, the per-arm run
  label and dialog titles stay sans.
- **A button names a verb and a chip names a kind, never an icon.** `buttonIcon` and
  `filterChipIcon` are two closed tables that stay apart: a chip's check means "the published
  ones", a button's means "save". Every glyph is `aria-hidden`; the word carries the meaning.
- **A colour one file uses is a literal, not a token.** A token is minted with its first
  consumer and named for its role.

## The form language

`form-decisions.md` chose variant 2 of every component; these are the choices as built.
Geometry and metrics are `Field`, `FieldGroup`, `fieldControlClasses`, `textAreaClasses` and
`searchFieldClasses`.

- **The row.** Label and hint share the left column, the control takes the right, both
  top-aligned, wrapping to stacked when narrow. A label is `for`/`id`-bound to a native control;
  a row over a chip group or custom widget is a `<fieldset>` named by `aria-labelledby`, never a
  dangling `for`. The index search box is its own class and shares no value with the form
  control.
- **Guidance lives under the field** (ADR 0050). The minority is marked: "(optional)", never a
  star. Placeholders are realistic examples. One carrier per job — tours explain a surface, hints
  explain a field — and `title=` is never the only carrier: a rule is one muted line in the
  control's accessible description. A rule about a set is a `FieldGroupHint` on the `<legend>`;
  where a rule names a derived value, a second line shows it. A row carries no hint unless the
  rule is true on that surface; every hint names the code that makes it true; a field never
  claims a severity its gate did not give; a mirrored gate sentence is the gate's, character for
  character, pinned from both ends in `lib/fieldRules.ts`.
- **Identifiers are derived, never asked first.** `DerivedIdField` follows its source until
  edited, resumes when emptied, previews as "Saved as `…`", refuses a taken value audibly, and
  stays closed while the list it derives from is loading. A saved entry's identifier is displayed
  and never asked; a SKU and a media reference are their own keys and say so.
- **No contract union reaches a reader in its wire spelling.** One table per union in
  `lib/enumLabels.ts`, keyed to the generated type and swept; free strings through
  `describeValue`. An explanation only where an operator could choose wrong, and only saying what
  the lab enforces. A status column is a `StatusPill`: glyph for the axis, word for the meaning.
- **Where a set comes from decides the control.** A contract union is a select. A register (a
  locale, a country) is a datalist that suggests and echoes the name. What the lab has proven
  follows the gate's severity: provider a select, model a datalist, tone override a datalist of
  *published* guidelines. A select still offers whatever the payload carries. The provider resets
  when it leaves its set; the model resets only when the provider moved; all else stands and is
  flagged. A choice of one is not a choice.
- **A list entered one value at a time is one control** (`ChipListField`): named remove
  buttons, duplicates refused and said, respelling previewed to the shape the gate wants.
- **A number field says what it accepts** and refuses at the save what a pattern cannot. A
  closed set of five is five named radios.
- **A create form asks for what constrains the work that follows** and names where the rest
  lives. Creation is a **page**, not a side card — `form-decisions.md` layout 2b, `CreatePage`:
  sticky header, back arrow, breadcrumb, the typed name as the title, Cancel, and a Create that
  is dashed and disabled with its reason until the form can submit — and it lands in the editor
  of what it made, refreshing the listing its rail counts on the way (ADR 0056). A create that
  is refused keeps the operator on the page with the reason under the button. A half-typed
  create form is not unsaved work and is not asked about (ADR 0051); **a create that takes
  two writes holds unsaved work from the moment the first one lands**, declares it under
  the same rule as any editor, and its running write stands down when the operator leaves. **A
  second write is sent only where the form asked for something the create request could not
  carry**, so the same page is a one-write create when it did not, and registers nothing.
  Built for the shop, the order, the profile, the identity, the scenario, the agent
  configuration, the judge and the two block libraries — every create the workspace has. **A
  product is the exception**: it is a row of the shop draft rather than a
  definition, so *New product* appends an empty one and opens its editor, and the handle it is
  addressed by is answered there. Ticket authoring stays inside the three-pane screen.
- **A finding links to the fix** (`form-decisions.md` 11.2). `IssueList` groups the gate's
  findings by the entry that is wrong, names that entry as its own surface names it, tallies
  each severity and carries one *Open* that lands on the editor and, where the path names one,
  the entry in view. One list serves the shop's overview and every editor's Publish gate card:
  the caller hands over the path-to-route map, and an editor hands over none, because there the
  entry that is wrong is a row of the page the reader is already standing on. A path the map
  does not name keeps its finding in the gate's own words and loses only its *Open*, and every
  gate code the domain raises is swept against the map (`lib/issueRoutes.test.ts`, reading
  `apps/api/src/capability_lab` the way ADR 0023 sweeps the tool registry).
- **Publishing the shop is read before it is done.** The overview's *Review N changes &
  publish* opens what becomes the next version — the gate's own change list, Publish, Keep
  editing, and what stays pinned until it is repointed — and only the Publish inside it writes.
  The published state says the version is immutable and links to New experiment. Every other
  definition still publishes on one press; a review is worth its second press where a draft
  spans a whole workspace rather than one form.
- **A saved row opens where it stands** (`EntryCard` edit mode): one payload builder per entry
  for the add form and the open row; one row open per list, siblings' Edit disabled with a line
  saying why and that an open row is not in the draft until Save; Cancel writes nothing; the row
  is a named form; a refusal one path makes the other makes too.
- **An editor says what is unsaved and asks before it is lost** (ADR 0051): *Discard changes*
  beside *Save draft* while dirty, "All changes saved" in a live region when not; one dialog
  with Save and leave, Discard and leave, Stay.
- **Removing is deliberate**: two presses, the confirm replacing the row and stating the whole
  consequence, the first press walkable back. *Planned*, Slice 21.
- **A blocked primary action says why**: dashed, disabled, the reason in `title` and inline; a
  validation message under the control, in its accessible description. `blockedButtonClasses`
  in `lib/ui.ts` is that weight — deliberately outside the button table, because every row of
  it is swept for a hover and a focus ring that a permanently disabled control can never show.
  The nine create pages wear it and nothing else does; Publish, Start, Save connection and
  Compose adopt it in Slice 22, which also puts the validation message on the `Field` row.

## Lists and counts

- **Counts live on the filter that produces them** (`FilterChips`): every chip filters, a zero
  chip is drawn and pressable, the count is of the whole list, the search narrows only rows, the
  row is absent while the listing is in flight or failed, and a figure the payload lacks is not
  faked.
- **The rail counts the same way** and from the same listing the index renders, held once by the
  workspace so the two cannot disagree (ADR 0056). Experiment history is the exception its
  submitted, URL-backed form already makes it: its index reads one narrowed page and the rail
  reads the lab's total beside it, because the count is of the whole list and the page never is.
- **Every index can be searched** (`SearchField`), in the card's header opposite the title with
  the chips beneath; a miss reads "No X matches this view". Experiment history keeps its
  submitted, URL-backed form.
- **Every header spans the content width** and holds the page's actions; sticky on a create
  page, and on the editors with Slice 25.

## Proposals, not decisions

The prototype proposes five browser preferences and a shop logo. Where the app opens and the
timestamp format earn a consumer and land with the settings zones; confirm-before-delete lands
with the confirm; auto-offered tours and table density are cut; the logo is the optional last
slice. The reasoning is in `docs/PLAN-UX.md`.
