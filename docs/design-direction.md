# Design direction

Status: current — 2026-09-20. The design rules that govern `apps/web`, stated once as rules a slice
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
| Forest hover | `#22544a` | `lab-ink-hover` `#215347` | pre-existing token, rule 5; revisit with the top bar (Slice 10) |
| Page title | 22px bound name, 24px fixed label | one `PageHeader` at 24px | one component, no variant yet; rule 3 |
| Card title | sans on note cards, Georgia on table and section cards | one `Card`, Georgia 17px | same |
| Compact controls | 42/40px in sub-editors and filters | the one 44px control | no compact component exists to size |
| Filter chips on Tickets, the block libraries, Policies & FAQ | drawn | none until a table exists to filter | a chip whose figure the payload lacks is not faked; Slice 16 gives documents one |
| Model on the connection, masked key | drawn | neither | ADR 0052 |
| Setup checklist | drawn on Shop details | not built | ADR 0044, ADR 0045 |
| Preferences | seven rows | two now, a third with the confirm slice | a preference no surface reads is not a slice |

Two items the handoff names are not built and not refused: Georgia on the results' stat
numerals, and the `open` button verb and `document` chip kind. Each lands with the surface that
first draws it.

## Navigation and chrome

The values are in `shell/AppShell.tsx`; the rules are these.

- **Two modes.** *Shop fixture* with the shop's rail and *Experiment lab* with a rail of Bench,
  History and a Library. Lab routes live outside shop scope, experiment pages carry their shop
  in the path, and the lab keeps a current shop through the switcher, present in both modes.
  *Planned*, Slice 9, under an ADR written first; until then the lab is a section of the shop's
  rail.
- **The rail** collapses to a strip whose rows keep their accessible names; the collapsed state
  is a browser preference and never a database row (ADR 0044). It is hidden on the shops index
  and on Settings. `nav[aria-label="Shop workspace"]` is what every spec reaches it by and does
  not move. The foot control's name, copy and tooltip are one string. Counts per entry:
  *planned*, Slice 11.
- **The top bar** carries the title, the shop switcher as a panel, the mode tabs, *Show me
  around* and *Settings*, lit while its page is open. *Planned*, Slice 10; today the switcher is
  a native select and the tour control sits in each page header.
- **Settings is three zones** told apart by surface: per-browser preferences, saved on change;
  the lab-wide model connection with explicit Save and Discard (ADR 0052); a collapsed read-only
  runtime zone with a "To change it:" line (ADR 0044's character). The seed is its own zone
  (ADR 0047). *Planned*, Slices 18 and 19.
- **Tours** (ADR 0045, 0046, 0049): one control per surface, the same words everywhere; an
  overlay above the page, never in it; nothing starts unbidden, nothing is remembered, no tour
  crosses a screen, a popover explains and never performs; every step declared in one table and
  swept by Playwright against its surface.
- **Nothing about progress is stored and no surface reads it** (ADR 0044, ADR 0045). The
  overview's readiness card reads one listing and says one sentence.

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
  lives. Creation is a **page**, not a side card — `form-decisions.md` layout 2b, sticky header,
  Cancel, a Create that is dashed and disabled with its reason until the form can submit — and
  lands in the editor. *Planned*, Slices 12 to 14.
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
  validation message under the control, in its accessible description. *Planned*, Slice 22.

## Lists and counts

- **Counts live on the filter that produces them** (`FilterChips`): every chip filters, a zero
  chip is drawn and pressable, the count is of the whole list, the search narrows only rows, the
  row is absent while the listing is in flight or failed, and a figure the payload lacks is not
  faked.
- **Every index can be searched** (`SearchField`), in the card's header opposite the title with
  the chips beneath; a miss reads "No X matches this view". Experiment history keeps its
  submitted, URL-backed form.
- **Every header spans the content width** and holds the page's actions; sticky on editor and
  create pages with Slice 25.

## Proposals, not decisions

The prototype proposes five browser preferences and a shop logo. Where the app opens and the
timestamp format earn a consumer and land with the settings zones; confirm-before-delete lands
with the confirm; auto-offered tours and table density are cut; the logo is the optional last
slice. The reasoning is in `docs/PLAN-UX.md`.
