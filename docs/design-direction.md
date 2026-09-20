# Design direction

Status: current — 2026-09-20. This document holds the design decisions that govern `apps/web`
today, stated as rules a slice can be checked against. How each was reached — the census, the
alternatives, the departures — is `docs/design-direction-history.md`, which is the earlier
version of this document with every revision kept verbatim. A rule that changes is changed here
and its reasoning goes there. ADR 0050 says the guidance conventions *are* the sections of this
document rather than an ADR's restatement; that is still so, and the sections are below under
shorter names.

The forward plan that applies these rules is `docs/PLAN-UX.md`; the model decisions the direction
implied are ADRs 0012 to 0018 and are not restated.

## Direction

**Direction A, the studio-first workbench**, merged with three strengths of the other two
candidates: director's notes on the live bench (the scenario's hidden facts and persona guidance
as an operator-only card), an objectives matrix (one row per objective, one column per arm, with a
legend) on the bench and the results, and bench zoning (the split conversation takes the width
and the library rails do not persist into it). The exploration is `docs/design-brief.md`.

**Familiar admin ergonomics, no vendor's branding.** The Studio is a shop-scoped admin workspace
— persistent resource navigation, index tables with status pills, resource detail pages — in a
neutral light admin language, with the lab's pine and paper identity in the top bar, the accents
and the display type. Tickets use the three-pane helpdesk anatomy (list, thread, context panel)
and the thread authors *history*, never live replies. The scenario editor is a composition
surface over shared block libraries. The prompt editor renders markdown with inline variable
chips, a grouped insert menu whose customer, order and ticket facts are visibly non-injectable,
and a selectable preview context. Desktop is the operating environment; no narrow-width
treatment is drawn.

**Status is never conveyed by colour alone.** A status pairs a glyph or a word with its colour,
everywhere.

## Authority — what a UI slice cites

The **whole-workspace prototype** handed over on 19 September 2026 — `tmp/design-frames/
Workspace.html`, `Workspace.dc.html` for the markup, `README.md` as the handoff, and
`form-decisions.md` as the locked form language — is the authority for everything that crosses
screens: chrome, the form row, buttons and colour, list density, search, the tours' placement. It
is a design reference and not production code, recreated on the primitives the workspace has
(`styles.css` tokens, `lib/ui.ts` class sets, `components/WorkspaceChrome.tsx`,
`shell/AppShell.tsx`) with no new UI dependency. The eighteen per-screen frames under
`tmp/design-frames/DEPRECADED/` still describe a surface's composition where the prototype does
not contradict them, and a slice names them by number. `tmp/` is not under version control; if
it is missing, re-export from the canvas named in the history document.

A `Frames:` line names the prototype's line for the surface and the numbered frame for its
composition. Where authorities disagree, in this order:

1. **The prototype supersedes a frame** wherever the two disagree.
2. **Where the README is silent and the prototype is specific, the prototype governs.** The
   README summarises the prototype and is not a ceiling on it.
3. **Where the two conflict outright, the README wins** — one stated value for a role against one
   drawn value for the same role, as the chip hover was (`#f6f7f8` over `#f4f6f7`). The clause
   settles a value, never a context: a distinction the prototype draws *consistently across a
   class* of elements (a bound name at 22px against a fixed label at 24px; a sans note-card header
   against Georgia table and section cards; the eleven 38px search boxes against the ninety 44px
   form controls) is a rule the README summarised away, and rule 2 hands it to the prototype. A
   slice may flatten such a class because one component serves both and has no variant yet, but
   as a **departure**, with the prototype's rule written down so the variant can be added later.
4. **A README value under a heading that scopes itself is stated for that role only.** The
   `Inputs:` bullet under *The form pattern* decides a form row's control and nothing else; a
   control outside that scope is silence, and rule 2 applies.
5. **Three grounds license keeping what the codebase has**: an explicit release in the handoff
   (the *Assets* section frees the drawing of a glyph); a repository rule that outranks a mockup
   (an accessible name specs and tours click; a value that already is a token); or another slice
   owning the decision. "The handoff is silent" is not one of them.

Every departure is written in one sentence in the slice's record. **The primitive ships with its
first consumer**: a component, a token or a preference no page uses is not a slice.

**Lab-level surfaces are frameless.** `/settings` and `/glossary` belong to the lab rather than
to a shop and are built from the existing chrome, like the shops index, the four shop-setup pages
and the identity and judge listings. A lab-level page that needed a layout language of its own is
the signal that the set has to grow.

## Navigation and chrome

**Two modes.** The product's *Studio / Bench / History* navigation is realised as two modes in
the top bar — *Shop fixture* with the shop's rail (Overview, Products, Orders, Customers,
Tickets, Scenarios; *Shop setup*: Policies & FAQ, Support identities, Tone of voice, Shop
details) and *Experiment lab* with a rail of Bench, History and a *Library* (agent
configurations, judges, support identities, objective blocks, mutation blocks). Lab routes live
outside shop scope; experiment pages carry their shop in the path; the lab keeps a current shop
through the switcher, which is present in both modes. *Planned*: `docs/PLAN-UX.md` Slice 9, under
an ADR written before the code. Until it lands the lab is a section of the shop's rail.

**The rail.** 216px expanded, a 52px strip collapsed; 17px glyphs expanded and 19px in 36px rows
collapsed, one glyph per destination; section headings at 10.5px 700 `0.07em` uppercase
`#8c9196`, which become divider lines when collapsed; active row `#e8f0ed` / `#14352e` 700,
inactive ink `admin-ink-soft`, hover `#eceef0`; the foot control "Collapse menu" at 12.5px 650
above a 1px rule, its name, copy and tooltip one string, `aria-expanded` on it. A collapsed row
keeps its accessible name (`sr-only` label plus `title`). Hidden on the shops index and on
Settings. The collapsed state is the browser preference the Settings switch also writes
(`lib/preferences.ts`), never a database row (ADR 0044). `nav[aria-label="Shop workspace"]` is
what every spec reaches the rail by and does not move. Each entry carries its listing's count
(*planned*, Slice 11).

**The top bar.** 56px, `#16332d`. App title in Georgia 15px 700 returning to All shops; the shop
switcher as a button opening a 300px panel (current shop with a check, the others with their
version, "All shops"); the mode tabs at 13px 600, inactive `#a8c1b8`, active white with a 2px
underline; *Show me around* and *Settings* on the right, Settings lit with a close glyph while
its page is open. *Planned*: Slice 10. Today the switcher is a native `<select>` and the tour
control sits in each page header.

**Settings is three zones**, told apart by surface: editable per-browser preferences on white,
saved on change; the lab-wide model connection on white with explicit Save and Discard (the
visible half of ADR 0052); a collapsed read-only runtime zone in grey with a padlock and a "To
change it:" line naming the variable or file (ADR 0044's character, kept for what is still
composition). The seed action is a zone of its own below, because it is an action (ADR 0047).
*Planned*: Slices 18 and 19.

**Tours** (ADR 0045, 0046, 0049). A control per surface, the same subtle button saying *Show me
around*, whose accessible name says which screen it walks; an overlay (`driver.js`, skinned from
the tokens below) that dims the surface in the lab's pine, cuts one element out and explains it
in a paper popover with *Back*, *Next* and a step count. Nothing starts unbidden, nothing is
remembered, no tour crosses a screen, a popover explains a control and never performs its work,
and each tour ends where it started. Every step is declared in one table and a Playwright sweep
holds each anchor to exactly one visible element. The tour adds no frame: it is above the page,
not in it. The control moves from the page header to the top bar with Slice 10; the table does
not change.

**Nothing about progress is stored, and no surface reads it.** ADR 0044 refused a stored
checklist and ADR 0045 removed the derived progress band. The prototype's *Setup checklist* on
Shop details is the same reading drawn smaller and is refused; the overview's readiness card
reads one listing and says one sentence (`docs/PLAN-UX.md`, *Decisions the prototype forces*).

## Tokens, type and glyphs

The tokens live in `apps/web/src/styles.css`. The refresh changed one and added three; every
other value is the POC's.

| Role | Value | Token |
| --- | --- | --- |
| Page canvas · card · rail | `#f6f6f7` · `#ffffff` · `#f7f7f8` | `admin-canvas`, `admin-surface`, `admin-sidebar` |
| Card border · field border | `#e1e3e5` · `#c9cccf` | `admin-border`, `admin-field-border` (added; deliberately not a darkening of the card's) |
| Ink · ink soft · muted | `#202223` · `#42474c` · `#6d7175` | `admin-ink`, `admin-ink-soft`, `admin-muted` |
| **Primary action** | `#1d6241`, hover `#14452e` | `lab-primary`, `lab-primary-hover` (added) |
| Forest action | `#173c34`, hover `#215347` | `lab-ink`, `lab-ink-hover` |
| Destructive | `#9d3028`, hover `#86271f`; tint `#fbf1ee`, border `#d3a49b` | `lab-error`, `-hover`, `-tint`, `-border` |
| Clay accent | `#c2532d` | `lab-accent` — trace bars, the review star, a ticket's emphasis, the armed seed; **no longer any button's primary** |
| Selected chip | bg `#eaf5ed`, border `#b6d9c4`, ink `lab-primary`, hover `#ddeee3` | `admin-chip`, `-border`, `-hover` (added) |
| Published · draft pills | `#dff0e7` / `#0f5132` · `#ffe9a3` / `#5c4813` | `admin-published(-ink)`, `admin-draft(-ink)` |
| Focus | `0 0 0 3px rgb(29 98 65 / 20%)` on fields; `2px solid #1d6241` offset 2px on custom controls | in `focusRingClasses` |

**Pine is the primary action and the warm red is reserved for destructive.** The clay read as a
warning while sitting on *Save* and *Publish*, leaving no colour that meant "this one deletes".
Every button variant — primary, forest, destructive, white secondary, red-bordered secondary —
carries a hover and a `focus-visible` ring; the hovers are the README's *Interactions* table.
A destructive control keeps its trash glyph and its verb; red is a second signal.

**Type.** Georgia for display: page titles 24px 700 at `-0.015em` (`PageHeader`), card titles
17px 700 (`cardTitleClasses`), the ticket thread's subject 19px; the top bar's title 15px. Sans
for UI at 13–14.5px. `ui-monospace, Menlo` for slugs, ids, model names and env vars. Entry-row
titles, the per-arm run label and dialog titles stay sans. The prototype's 22px bound-name
title and its sans note-card header are flattened into one `PageHeader` and one `Card`, as a
recorded departure under rule 3.

**Radii and shadow.** 12px cards, 9px fields and primary buttons, 8px secondary buttons and
chips, 7px small chips and filter chips, 999px pills. Cards `0 1px 2px rgb(22 51 45 / 6%)`;
popovers `0 14px 34px rgb(12 30 25 / 22%)`.

**Glyphs are lucide, on two closed vocabularies in `lib/ui.ts`.** A button names a verb and
never an icon: `buttonIcon` maps create → plus, save → check, discard → counter-clockwise, edit,
delete, make default → star, start → play, rerun, fork → branch, publish → upload, results →
bars. A filter chip names a kind: `filterChipIcon` maps all → cube, published → check, draft →
dashed circle, attention → warning triangle, referenced → chain, unfulfilled → clock. A chip's
check means "the published ones" and a button's means "save", so the two tables stay apart.
Every glyph is `aria-hidden`; the word carries the meaning.

## The form language

`form-decisions.md` chose variant 2 of every component; the rules below are those choices as
built.

**The row** (`Field`, `FieldGroup`, beside `FieldHint`). Label and hint share a left column of
`1 1 210px` capped at 36ch; the control takes `2 1 330px`; both top-aligned; the row wraps to
stacked at narrow widths and rows are separated by a `#f1f2f3` rule. A label is `for`/`id`-bound
to a native control; a row that labels a chip group or a custom widget is a `<fieldset>` named
by `aria-labelledby`, never a dangling `for`. The shared control is `min-height: 44px`,
`10px 14px`, the field border, 9px, 14.5px; the text area keeps its own 14px, `11px 14px`, 1.6
leading; the compact 42/40px controls the prototype draws are flattened into the one control (a
recorded departure). The index search box is its own class — 38px, `#bdc7cf`, 8px, 13px, a
magnifier in a 36px left padding, `type="search"` with the native decoration refused — and
shares none of the form control's values.

**Guidance lives under the field** (ADR 0050). The minority is marked: "(optional)", never a
star, so a form of only required fields carries no marker. Each free-text field on a create form
has a placeholder that is a realistic example. Guidance has one carrier per job — tours explain
a surface, hints explain a field — and `title=` is never the only carrier of a rule: a format or
a consequence is one muted line under the label, in the control's accessible description. A
rule about a *set* is a `FieldGroupHint` named by the `<legend>`; where a rule names a value the
form derives, a second line shows that value where the rule is read ("Default: CHF — Swiss
franc"). A row carries no hint unless the rule is true on that surface, and every hint sentence
names the code that makes it true. A field may not claim a severity its gate did not give; where
a hint mirrors a gate finding it is the gate's sentence character for character, pinned from
both ends in `lib/fieldRules.ts`. `LocaleField` and `CurrencyField` carry their own rule on every
surface. A control shared by many rows shares one `sr-only` description rather than a copy per
row.

**Identifiers are derived, never asked first.** A `DerivedIdField` follows its source until
edited, restores the suggestion when emptied or when the source changes, previews as "Saved as
`…`", and refuses a value already taken with the second line in the error treatment, announced.
An order continues the shop's `{prefix}-{n}` series and a ticket always takes `T`. A suggestion
derived from a list still loading keeps the field closed (`pending`) until it knows, and closes
it again when a create moves the list. A saved entry's identifier is displayed and never asked:
edit mode hands it back untouched, because the draft diff keys on it and a changed key reads as
a removal and an addition. A variant's SKU and a media reference *are* their keys; both are
editable and their hint states that consequence.

**No contract union reaches a reader in its wire spelling.** One label table per union in
`lib/enumLabels.ts`, typed `Record<Union, EnumLabel>` over the generated contract and swept by a
test that names any member without words; a free-string field is read through `describeValue`,
which returns the value as the record carries it. An entry carries an explanation only where an
operator could choose wrong ("Issue refund — refund an order in full or part"), and an
explanation may only say what the lab enforces. Labels are capitalised except the tables read
mid-sentence. A status column is a `StatusPill`: an `aria-hidden` glyph naming the axis beside
the word. A provider's spelling is `MODEL_PROVIDER_LABELS` in `lib/agents.ts`, outside the
registry because a provider is not a union, and a served label wins over it. The tables that
have not yet moved into the registry are listed in the history document.

**Where a set comes from decides the control.** A closed set the contract publishes is a select
over its label table. A register too large or too open to be a vocabulary — a locale, a country —
is a datalist that suggests, holds the code and echoes the name beneath the field. What the lab
has *proven* it can run follows the gate's severity: a provider is a select because an unproven
one is a publish error; a model is a datalist because an unexercised one is a warning; a tone
override is a datalist of the preview shop's *published* guidelines because setup, not the
editor, refuses one. A select still offers whatever the payload carries, so an off-list value
is shown and told about rather than hidden. The provider resets when it leaves its proven set;
the model resets only when the provider actually moved; everything else stands and is flagged.
A choice of one is not a choice: a select with exactly one candidate opens on it.

**A list entered one value at a time is one control.** `ChipListField`: each value a chip whose
remove button is named after it, the rule on the input as a hint, the chips and the field in one
named `<fieldset>`, duplicates refused and said, respelling through a `normalize` the caller
passes and previewed as "Saved as `…`" reaching the shape the gate wants. A saved row renders the
same chips read-only.

**A number field says what it accepts and does not accept what it cannot carry.** The rule is
the contract's, spelled once in `lib/fieldRules.ts` and used by both the `pattern` and the hint;
`inputMode` shapes the keyboard. A pattern is not a refusal, so a value the form cannot carry is
refused at the save and said. A closed set of five is five radios, each named, with the count in
words beside the stars.

**A create form asks for what constrains the work that follows and names where the rest lives.**
Currencies are on the shop's create form because a variant cannot be priced outside them;
channels are not, and the footnote says where they are. Creation is a **page**, not a side card
— `form-decisions.md`'s layout 2b, 790px, under a sticky header with Cancel and a Create that is
dashed and disabled with its reason until the form can submit — and lands in the editor of what
it created. *Planned*: Slices 12 to 14; today the indexes create from a side card.

**A saved row opens where it stands.** `EntryCard` edit mode keeps the header line and replaces
the body with the row's fields under Save and Cancel. One payload builder per entry, called by
the add form and the open row alike, and one fieldset component for both. One row open at a
time per list, the siblings' Edit disabled with a line saying why, and that an open row's typing
is not in the draft until Save. Cancel writes nothing. The open row is a named form ("Edit
{entry}"), and Edit, Save, Cancel and Remove are named after the row. A refusal belongs to the
builder's neighbours: what one path refuses the other refuses too. The variants table keeps
price, availability and stock as live cells.

**An editor says what is unsaved and asks before it is lost** (ADR 0051). The header shows
*Discard changes* beside *Save draft* while there is something to save and "All changes saved"
in a polite live region when there is not; a disabled button reading "Saved" is never drawn.
Discard re-reads the draft and leaves an open row alone. A navigation that would strand unsaved
work is asked about once, in one dialog naming what would be lost, with Save and leave, Discard
and leave, and Stay; where the prompt cannot save something, Save is disabled with its reason as
a description.

**Removing is deliberate.** Every Remove that is not trivially re-added takes two presses, the
confirm replacing the row and stating the whole consequence (`form-decisions.md` 9.2); the first
press can be walked back. *Planned*: Slice 21; today the order editor's line removal is the
model.

**A blocked primary action says why.** Dashed, disabled, the reason in `title` and inline; a
validation message sits under the control at 13px 600 `#9d3028` in its accessible description.
*Planned*: Slice 22.

## Lists and counts

**Counts live on the filter that produces them.** An index draws one `FilterChips` row above
its table, each chip carrying its count in its accessible name, on the six-kind vocabulary
above; every chip filters, a zero chip is drawn and pressable, and the count is of the whole
list — the search narrows rows and never moves a count (`filterList` decides both in one pass).
The row waits for its listing: absent in flight and on failure. A chip whose figure the index
payload does not carry is not faked. Tickets draw no chips; the two block libraries and Policies
& FAQ draw none until a table exists to filter (Slice 16 gives documents one).

**Every index can be searched.** `SearchField` sits in the card's header line opposite the
title, chips beneath it, with the `Search <thing>` placeholder; a miss reads "No X matches this
view". Experiment history keeps its own submitted, URL-backed form.

**Every header spans the content width** and holds the page's actions in its slot; it becomes
sticky on editor and create pages with Slice 25.

## Proposals, not decisions

The prototype proposes five browser preferences and a shop logo. Two preferences earn a
consumer — where the app opens, and relative or absolute timestamps — and land with the settings
zones; confirm-before-delete lands with the confirm; auto-offered tours and table density are
cut; the logo is the last, optional slice. The reasoning is in `docs/PLAN-UX.md`.
