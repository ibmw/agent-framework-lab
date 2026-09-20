import {
  Box,
  ChartColumn,
  Check,
  CircleCheck,
  CircleDashed,
  Clock,
  GitBranch,
  Link,
  type LucideIcon,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";

/** The lab note: the pine-on-cream band the synthetic-sandbox notices are drawn on. */
export const labNoteClasses = "rounded-[10px] border border-[#b7d9cc] bg-[#eaf4f0]";

export const surfaceClasses =
  "rounded-[10px] border border-admin-border bg-admin-surface shadow-[0_1px_2px_rgb(22_51_45/6%)]";

/**
 * A card's own title, in the workspace's display face.
 *
 * The handoff's *Type* line gives card titles as Georgia 17–18px 700. The prototype draws
 * three treatments rather than one, and this constant flattens all three into the first:
 *
 * - **17px at `-0.01em`** where the title sits in a bordered header above a table — twelve of
 *   them (`Workspace.dc.html`:162, 826, 1067, 3569 and eight more);
 * - **18px** where it heads an editor's section card, which has no header rule and carries its
 *   title and description in the body — sixty-six of them;
 * - and **sans**, at the page's own size, on the small side-panel note card, a title over a
 *   paragraph in a `13px 16px` bordered header — forty-four of them (`:1433`, `:1436`).
 *
 * One `Card` serves all three here and no slice has given it a variant. Both Georgia values sit
 * in the handoff's range, so either is compliant; 17 is taken because the bordered header over
 * the card's content is the shape this component draws. The census cuts the other way and is
 * said rather than left to be found — of the hundred-and-thirty-seven `Card`s in this
 * workspace only about a dozen stand where the prototype draws its table card, and the rest
 * where it draws the 18px section card. Putting display type on the note-card class at all is
 * a departure from the prototype, recorded with the other two in
 * `docs/history/workspace-refresh-pattern-slices.md` UI-5.
 *
 * It lives here rather than inside `Card` because two surfaces draw a card header in open
 * code: the shops table, which needs a filter row between the title and the table, and the
 * tickets list panel, which carries its filter in the header line. A card title spelled three
 * times is a card title that ends up spelled three ways.
 */
export const cardTitleClasses = "font-display text-[17px] font-bold tracking-[-0.01em]";

/**
 * The ground every form control is drawn on: what the classes below share, and no more.
 *
 * Only the values that are one decision for every control live here — the box, the radius, the
 * horizontal padding, the border and the focus pair. **Height, vertical padding and type size
 * are per-export**, because the handoff gives the input and the text area different ones and a
 * shared string that carried the input's would make every text area a caller's override away
 * from being right.
 *
 * `tmp/design-frames/README.md`, *The form pattern*, `Inputs:` bullet:
 *
 * ```
 * min-height: 44px; padding: 10px 14px; border: 1px solid #c9cccf;
 * border-radius: 9px; font-size: 14.5px
 *   focus: border-color:#1d6241; box-shadow:0 0 0 3px rgb(29 98 65 / 20%)
 * ```
 *
 * The border is `--color-admin-field-border`, added in `styles.css` for this: the README's
 * token table gives the role its own row, and a field that borrowed the card's `#e1e3e5`
 * disappeared into the card. The radius is the README's *Radii* line ("9px fields"), which
 * `rounded-lg` missed by a pixel. The focus pair is unchanged from UI-1.
 *
 * **The census: the prototype draws five classes of control, and this file builds three.**
 * Counted over every one of the 107 native `input`/`select`/`textarea` elements in
 * `Workspace.dc.html` — the four classes below account for 101, and the remaining six are
 * listed after them, because a census that silently drops its remainder is not a census:
 *
 * - **67 at `min-height:44px`, `#c9cccf`, 9px, mostly 14.5px** — the form-row control, which
 *   is `fieldControlClasses`.
 * - **11 at 38px, `#bdc7cf`, 8px, 13px** — the index search box. A separate class set here
 *   (`searchFieldClasses` below) and deliberately untouched by this constant: UI-6 settled its
 *   metrics and `docs/design-direction.md` records why the `Inputs:` bullet, which scopes
 *   itself to "107 rows", does not reach it.
 * - **16 at 42px or 40px, `#c9cccf`, 13–13.5px** — thirteen compact controls in the list
 *   sub-editors and the Settings provider card (`:2867`, `:2974`, `:3084`, `:3109`, `:3110`,
 *   `:3135`, `:3672`, `:3673`, `:3816`, `:3817`, `:4018`, `:4038`, `:4053`) and the three on
 *   the History filter bar (`:2677`, `:2678`, `:2679`).
 * - **7 text areas, `#c9cccf`, 9px, 14px, `11px 14px`, `line-height:1.6`, no `min-height`**
 *   (`:530`, `:1677`, `:1724`, `:1807`, `:1954`, `:3205`, `:3515`) — identical in all six
 *   values, which is `textAreaClasses`.
 *
 * And the six the four classes leave over: `:940` and `:941` are status **radios**, which are
 * not fields and take none of this; `:965` and `:2650` are borderless 28px inputs sitting
 * *inside* a bordered chip strip; `:1003` and `:1004` are the variant table's currency select
 * and price input, borderless inside a 38px composite cell.
 *
 * **What is flattened, and what is not.** The sixteen compact controls are flattened into
 * `fieldControlClasses`, as a departure from the prototype: no compact component exists in this
 * workspace to give a second size to — every sub-editor add-form row and all eight
 * `ExperimentHistoryPage` filters already reach for this string — and minting one with no
 * caller asking for it is the primitive-without-a-consumer the house rule refuses. The cost is
 * 2–4px of height and half a point of type on those thirty-odd controls. The text area is
 * **not** flattened: it is a distinct export with its own consumers, so the one-component
 * argument does not reach it, and the prototype's seven are consistent enough to be a class the
 * `Inputs:` bullet summarised away — the case rule 3 of `docs/design-direction.md`'s
 * *Authority* hands to the prototype. It keeps 14px, `11px 14px` and `line-height:1.6`.
 *
 * **The four borderless controls have no class here and are a departure that predates this
 * slice**: `ChipListField`, the results tag box and the variant table's cells all draw a
 * bordered standalone field where the prototype draws a borderless one inside a composite.
 * What this slice changes is their size, not their shape. It is written up in
 * `docs/history/workspace-refresh-pattern-slices.md` UI-7 rather than repaired, because giving a chip strip or a
 * composite cell its own component is a component slice.
 *
 * One reading to save the next person a measurement: every `<select>` in the prototype has
 * **zero** vertical padding (`0 12px` on twenty-nine of them, `0 11px`, `0 10px` and `0 7px`
 * on the rest) where `fieldControlClasses` gives `py-2.5`. It changes nothing — `min-height`
 * governs a select's height and the text centres in it either way — and one padding for every
 * control is worth more than matching a value that has no effect.
 */
const fieldSurfaceClasses =
  "w-full rounded-[9px] border border-admin-field-border bg-admin-surface px-3.5 text-admin-ink outline-none transition focus:border-lab-primary focus:ring-[3px] focus:ring-lab-primary/20 aria-invalid:border-lab-error disabled:cursor-not-allowed disabled:opacity-65";

/**
 * The single-line control: the handoff's `min-height:44px`, `10px 14px` and `14.5px`.
 *
 * A floor rather than the `h-10` this used to be, because the README writes `min-height` and
 * the difference is not pedantic — the same string paints a `<select>`, an
 * `<input type="date">` whose picker glyph is taller than the text beside it, and a control
 * whose value wraps. A fixed height clips all three; a floor lets them grow and holds the
 * target size for a pointer everywhere else.
 */
export const fieldControlClasses = `box-border min-h-[44px] py-2.5 text-[14.5px] ${fieldSurfaceClasses}`;

/**
 * The multi-line control, at the prototype's own metrics rather than the input's: 14px on a
 * 1.6 leading, `11px 14px`, and a floor of its own in place of the 44px one.
 */
export const textAreaClasses = `box-border min-h-24 py-[11px] text-[14px] leading-[1.6] ${fieldSurfaceClasses}`;

export const fieldLabelClasses = "grid gap-1 text-xs font-semibold text-admin-muted";

/**
 * The form row, in the one shape the handoff gives all 107 of them.
 *
 * `tmp/design-frames/README.md`, *The form pattern*, writes it as inline style; this is that
 * declaration and nothing else, utility by utility:
 *
 * ```
 * row:      display:flex; flex-wrap:wrap; align-items:flex-start;
 *           column-gap:28px; row-gap:10px; padding:22px 0;
 *           border-top:1px solid #f1f2f3
 * left:     flex:1 1 210px; min-width:0; max-width:36ch
 *   label:  display:block; 13.5px/700; #202223
 *   hint:   margin-top:4px; 13px/1.5; #42474c; text-wrap:pretty
 * control:  flex:2 1 330px; min-width:0
 * ```
 *
 * The wrap is the responsive behaviour rather than a breakpoint: `210 + 28 + 330` is 568px, so
 * the two columns stack when the row has less than that, wherever the row happens to sit — a
 * card in the 320px side column reaches the stacked order without the page knowing its width.
 * That is why these are `flex-[…]` bases and not `sm:` variants.
 *
 * `#f1f2f3` is the rule *between rows*, lighter than `admin-border`, which divides a card from
 * what is outside it. It is written as a literal for the same reason `labNoteClasses` above
 * writes its two: a colour one file uses is not yet a token, and the refresh's token table in
 * `docs/design-direction.md` does not list this one.
 */
export const fieldRowClasses =
  "flex flex-wrap items-start gap-x-7 gap-y-2.5 border-t border-[#f1f2f3] py-[22px]";

/** The left column: the label, and the hint under it. */
export const fieldRowLabelClasses = "min-w-0 max-w-[36ch] flex-[1_1_210px]";

/** The label itself, or — where the control is a group — the name standing in for one. */
export const fieldRowLabelTextClasses = "block text-[13.5px] font-bold text-admin-ink";

/** The hint, under the label rather than under the control. */
export const fieldRowHintClasses =
  "mt-1 text-[13px] leading-[1.5] font-normal text-admin-ink-soft [text-wrap:pretty]";

/** The right column: the control, and any second line directly beneath it. */
export const fieldRowControlClasses = "min-w-0 flex-[2_1_330px]";

/**
 * The ring every control shows a keyboard reader, on the refresh's pine rather than the clay
 * accent: `2px solid #1d6241` offset by 2px, the value the handoff's token table gives for a
 * custom control. It is `focus-visible` rather than `focus` so a pointer press does not draw
 * it, and it is in the base of every variant below rather than left to a caller, because a
 * variant that forgets it leaves a reader with nothing but a colour shift to locate them by —
 * the one thing this design says status may never be.
 */
export const focusRingClasses =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lab-primary";

const buttonBaseClasses = `inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition ${focusRingClasses} disabled:cursor-not-allowed disabled:opacity-55`;

const smallButtonBaseClasses = `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${focusRingClasses} disabled:cursor-not-allowed disabled:opacity-55`;

/**
 * Every button the workspace draws, in one table.
 *
 * The named exports below are read off this record rather than written beside it, so a variant
 * cannot exist that `ui.test.ts` does not check for its hover and its focus ring.
 *
 * The colours are the refresh's (`docs/design-direction.md`, *Tokens, type and glyphs*):
 *
 * - **accent** — pine `#1d6241`, the safe and expected action. It used to be the clay accent,
 *   which read as a warning while sitting on *Save draft*.
 * - **ink** — forest, where Save is not the page's primary action because Publish is.
 * - **outline** / **subtle** — the two secondary weights, unchanged but for their ring.
 * - **warning** — the clay, kept for the one press that should give a reader pause without
 *   destroying anything: the armed seed.
 * - **destructive**, **destructiveOutline** — the warm red, now reserved for what destroys
 *   something. Solid is the confirmation and the bordered weight is the control that asks for
 *   it, which is the pair the prototype draws.
 * - **destructiveSubtle** — an extension, not something the prototype draws: it removes an
 *   entry from a list, and the prototype draws those as a quiet `×` in `#6d7175` with a
 *   `title`. It is the same red-bordered weight at the small size, taken so that an entry-list
 *   Remove reads as destructive without growing to `min-h-10` and loosening list density.
 *   Whoever revisits that density is departing from the prototype either way, and should know
 *   which way this went.
 */
const buttonVariants = {
  accent: `${buttonBaseClasses} bg-lab-primary text-lab-paper hover:bg-lab-primary-hover`,
  ink: `${buttonBaseClasses} bg-lab-ink text-lab-canvas-top hover:bg-lab-ink-hover`,
  outline: `${buttonBaseClasses} border border-admin-border bg-transparent text-admin-ink hover:bg-admin-canvas`,
  warning: `${buttonBaseClasses} bg-lab-accent text-lab-paper hover:bg-lab-accent-hover`,
  destructive: `${buttonBaseClasses} bg-lab-error text-lab-paper hover:bg-lab-error-hover`,
  destructiveOutline: `${buttonBaseClasses} border border-lab-error-border bg-transparent text-lab-error hover:bg-lab-error-tint`,
  subtle: `${smallButtonBaseClasses} border border-admin-border bg-transparent text-admin-muted hover:bg-admin-canvas hover:text-admin-ink`,
  destructiveSubtle: `${smallButtonBaseClasses} border border-lab-error-border bg-transparent text-lab-error hover:bg-lab-error-tint`,
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

/** The table itself, for the test that holds every variant to the same two rules. */
export const buttonVariantClasses: Readonly<Record<ButtonVariant, string>> = buttonVariants;

export const accentButtonClasses = buttonVariants.accent;
export const inkButtonClasses = buttonVariants.ink;
export const outlineButtonClasses = buttonVariants.outline;
export const warningButtonClasses = buttonVariants.warning;
export const destructiveButtonClasses = buttonVariants.destructive;
export const destructiveOutlineButtonClasses = buttonVariants.destructiveOutline;
export const subtleButtonClasses = buttonVariants.subtle;
export const destructiveSubtleButtonClasses = buttonVariants.destructiveSubtle;

/**
 * The verbs a button's glyph may mean. The set is closed: what is fixed is which glyph means
 * which verb, not the drawing, so the pairing survives a change of icon set while a page that
 * invents a twelfth verb does not compile.
 */
export type ButtonVerb =
  | "create"
  | "save"
  | "discard"
  | "edit"
  | "delete"
  | "makeDefault"
  | "start"
  | "rerun"
  | "fork"
  | "publish"
  | "results";

/**
 * Verb to glyph, written once so the pairing cannot drift across the seventy-odd buttons that
 * carry one. A page names the verb; it never names the icon.
 *
 * **Which controls take one.** Every control whose act is one of these verbs, whatever weight
 * it is drawn at — a link-styled button in a table cell counts as much as a pine one in a page
 * header. A control whose act is *not* in this list stays bare rather than reaching for the
 * nearest drawing: Cancel, Keep it, Stay on this page, Retry, Search, Previous and Next, the
 * reorder pairs, the filter chips and the tab links have no glyph, and neither do the two the
 * prototype draws outside this vocabulary (the compass on *Show me around*, the bolt on *Test
 * connection*). That is the boundary; it is not "the buttons that happened to use a shared
 * class set".
 *
 * `save` is the commit of the form in front of the reader — including every *Create …* — and
 * `create` opens a creation or appends to a list. The prototype's own labels settle it:
 * *New shop* and *Add parameter* take the plus, *Create shop* and *Save draft* the check.
 *
 * The drawings are `lucide-react`, which the navigation chrome and the tour control already
 * use — the handoff asks for the prototype's marks to be redrawn "with whatever icon set the
 * codebase prefers, provided the semantic pairing holds", and this is that set.
 */
export const buttonIcon: Readonly<Record<ButtonVerb, LucideIcon>> = {
  create: Plus,
  save: Check,
  discard: RotateCcw,
  edit: Pencil,
  delete: Trash2,
  makeDefault: Star,
  start: Play,
  rerun: RotateCw,
  fork: GitBranch,
  publish: Upload,
  results: ChartColumn,
};

/**
 * A leading glyph's size, as one decision rather than seventy-five. The button's own `gap`
 * sets the space after it, and `flex-none` keeps a long label from squeezing the drawing.
 */
export const iconLeadingClasses = "h-3.5 w-3.5 flex-none";

/**
 * The band of filter chips that sits above a list, and the one shape every index draws it in.
 *
 * The prototype's own declaration (`tmp/design-frames/Workspace.dc.html`, the `shopFilters`
 * row at 164–173 and the nine rows that repeat it):
 *
 * ```
 * row:          display:flex; gap:6px; padding:11px 20px; border-bottom:1px solid …
 * chip:         min-height:34px; display:flex; align-items:center; gap:5px; padding:0 12px;
 *               border-radius:7px; font-size:13px; font-weight:700
 *   selected:   border #b6d9c4; background #eaf5ed; colour #1d6241; hover #ddeee3
 *   unselected: border transparent; colour #58636d; hover (README) #f6f7f8
 * count:        font-variant-numeric: tabular-nums; opacity .75
 * ```
 *
 * Four values are not the prototype's, and each is named so that nobody has to re-measure:
 *
 * - **`px-4`, not 20px.** In this workspace the chips sit directly above `tableHeadClasses`,
 *   which is `px-4`; a row indented differently from the column it labels reads as a second,
 *   narrower card.
 * - **`py-2.5` (10px), not 11px.** The same reason and the same neighbour: `tableHeadClasses`
 *   is `py-2.5`, so the chip row and the column header it sits on share one rhythm rather
 *   than missing each other by a pixel. It is also the one value here off Tailwind's 4px
 *   scale otherwise.
 * - **It wraps.** The prototype does not declare it; the handoff's *Responsive* rule requires
 *   it of every row.
 * - **`rounded-[7px]`.** Not a departure but a reading: the README's *Radii* line gives "8px
 *   secondary buttons and chips, 7px small chips" and does not say which a 34px filter chip
 *   is. Where the README is ambiguous and the prototype is specific the prototype governs
 *   (`docs/design-direction.md`), and the prototype draws 7px.
 *
 * The unselected hover is the README's `#f6f7f8` where the prototype's inline style draws
 * `#f4f6f7`: an outright conflict rather than a silence, which the same rule in
 * `docs/design-direction.md` settles for the README. `#f6f7f8` is also the hover that document
 * gives every white secondary, so the chip row does not introduce a second near-grey.
 *
 * `#58636d` is written as a literal for the reason `labNoteClasses` writes its two: it is the
 * unselected chip's ink in the prototype, the README's token table does not name it, and a
 * colour one file uses is not yet a token.
 */
export const filterChipRowClasses =
  "flex flex-wrap items-center gap-1.5 border-b border-admin-border px-4 py-2.5";

const filterChipBaseClasses = `inline-flex min-h-[34px] items-center gap-[5px] rounded-[7px] border px-3 text-[13px] font-bold transition ${focusRingClasses}`;

/**
 * The two states a chip is drawn in, as one record for the same reason `buttonVariants` is
 * one: the named exports are read off it, so a state cannot lose its hover unnoticed.
 */
const filterChipStates = {
  selected: `${filterChipBaseClasses} border-admin-chip-border bg-admin-chip text-lab-primary hover:bg-admin-chip-hover`,
  unselected: `${filterChipBaseClasses} border-transparent text-[#58636d] hover:bg-[#f6f7f8]`,
} as const;

export type FilterChipState = keyof typeof filterChipStates;

/** The table itself, for the test that holds both states to the same rules. */
export const filterChipStateClasses: Readonly<Record<FilterChipState, string>> = filterChipStates;

/** The number, in the same column width whatever the digits, and quieter than the label. */
export const filterChipCountClasses = "tabular-nums opacity-75";

/**
 * What a filter chip's glyph may mean.
 *
 * A second closed vocabulary beside `ButtonVerb`, and deliberately not an extension of it: a
 * chip names a *subset of a list*, a button names an *act*, and the two sets overlap nowhere —
 * the check on a chip means "the published ones", not "save". The set is closed for the same
 * reason the verbs are: what is fixed is which glyph means which kind of subset, so a page
 * that invents a seventh does not compile.
 *
 * The kinds are the handoff's own, from `tmp/design-frames/README.md`, *Assets*: "cube = all ·
 * check = published/active · dashed circle = draft · warning triangle = needs attention ·
 * chain = shared/referenced · clock = unfulfilled · page = document".
 *
 * **Six of the seven.** The page — the document kind — is left out because nothing draws it.
 * The prototype spends it on one screen, a single Policies & FAQ table filtered by *Policies*,
 * *Guidelines* and *FAQ*; this workspace has no such table (policies and FAQ are two authored
 * lists on `PoliciesAndFaqPage` and guidelines are a third page), so the chips that would
 * carry it do not exist here. The house rule in `docs/design-direction.md` — a primitive no
 * page uses is not a slice — decides it, and the kind is added by whichever slice builds that
 * index.
 */
export type FilterChipKind =
  | "all"
  | "published"
  | "draft"
  | "attention"
  | "referenced"
  | "unfulfilled";

/**
 * Kind to glyph, written once so the pairing cannot drift across the ten chip rows.
 *
 * A page names a kind; it never names the icon. Which kind a chip takes is the prototype's
 * own `filterKind` classifier (`Workspace.dc.html`:5568–5577) read over that chip's label —
 * *Payment unsettled* and *Without a default address* are alerts by that function, *Shared* is
 * a chain, and everything it does not otherwise place is the check.
 *
 * The drawings are `lucide-react`, as the button glyphs are, and they are the circled marks
 * the prototype draws rather than the bare ones the buttons use: `FILTER_ICONS.ok` is a check
 * inside a circle and `FILTER_ICONS.draft` a dashed one. The handoff's *Assets* section frees
 * the drawing provided the semantic pairing holds, which is why lucide's dashed circle carries
 * no inner stroke and the prototype's does.
 */
export const filterChipIcon: Readonly<Record<FilterChipKind, LucideIcon>> = {
  all: Box,
  published: CircleCheck,
  draft: CircleDashed,
  attention: TriangleAlert,
  referenced: Link,
  unfulfilled: Clock,
};

/**
 * The search box an index draws over its list, and the row it sits in.
 *
 * The prototype's own declaration, identical on all eleven indexes that carry one
 * (`tmp/design-frames/Workspace.dc.html`:163, 827, 1068, 1142, 1460, 1534, 1595, 3238, 3419,
 * 3570, 3714):
 *
 * ```
 * input:  margin-left:auto; width:min(300px, 34%); min-height:38px;
 *         padding:8px 12px 8px 36px; border:1px solid #bdc7cf; border-radius:8px;
 *         font-size:13px
 *   focus: border-color:#1d6241; box-shadow:0 0 0 3px rgb(29 98 65 / 20%)
 * glyph:  a 16x16 magnifier in #6d7175, background-positioned at 12px 50%
 * ```
 *
 * **It is not the form pattern's input, and does not take its metrics.** The README writes
 * `min-height:44px; padding:10px 14px; border:1px solid #c9cccf; border-radius:9px;
 * font-size:14.5px` under *The form pattern*, and says in the same breath that the pattern
 * "applies to 107 rows" — a label, a hint and a control in a form row. A search box in a
 * card's header is none of those, and the prototype draws it differently in every one of the
 * five values, in all eleven places and nowhere else: `#bdc7cf` occurs exactly eleven times in
 * that document and they are these eleven fields. That is the class rule 3 of
 * `docs/design-direction.md`'s *Authority* describes — a distinction the prototype draws consistently which
 * the README's summary does not enumerate — so the prototype governs and these are its
 * numbers. `#bdc7cf` is written as a literal for the reason `labNoteClasses` writes its two:
 * a colour one file uses is not yet a token.
 *
 * Three values are not the prototype's, and each is named so that nobody re-measures:
 *
 * - **`px-4 py-3` on the row, not `17px 20px`.** The card header's own padding, spelled the
 *   way `Card` and the shops table already spell it — UI-4's and UI-5's argument, unchanged:
 *   a row indented differently from the column it labels reads as a second, narrower card.
 * - **One width, `min(300px, 34%)`.** The prototype draws three — this on eight indexes,
 *   `min(320px, 36%)` on orders and customers, and a flat `260px` on documents. The modal
 *   value stands for all of them, as UI-5's single title size stands for two.
 * - **A 180px floor under that width.** 34% of a card in the narrow column is not a field
 *   anyone can read their own word back from, and the handoff's *Responsive* rule requires
 *   every row to survive the wrap. The prototype, which is one fixed-width canvas, never
 *   meets the case.
 *
 * The focus pair is the README's, which the prototype draws identically, and is spelled with
 * the same two utilities every other control in this file uses rather than re-derived.
 */
export const searchFieldRowClasses =
  "flex flex-wrap items-center gap-4 border-b border-admin-border px-4 py-3";

/**
 * The field's own box: the width, the `margin-left:auto` the prototype puts on the input
 * itself, and the ground the glyph is positioned against. The auto margin lives here rather
 * than in a wrapper because a percentage width resolves against the flex container, and a
 * `ml-auto` box around the field would be sized by its content instead.
 */
export const searchFieldWrapClasses = "relative ml-auto w-[min(300px,34%)] min-w-[180px]";

/** The magnifier: 16px, muted, at the left inset the 36px padding leaves for it. */
export const searchFieldIconClasses =
  "pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-admin-muted";

/**
 * The field itself. `appearance-none` and the cancel-button reset are not cosmetic
 * preferences: the control is `type="search"`, Tailwind's preflight resets only
 * `::-webkit-search-decoration` and sets no `appearance` for `[type=search]`, and WebKit's
 * remaining `searchfield` appearance brings a native clear x that the prototype does not draw,
 * that no keyboard reaches and that announces as nothing — and, on older Safari, a native box
 * that can overrule the radius and padding declared here.
 */
export const searchFieldClasses =
  "box-border min-h-[38px] w-full appearance-none rounded-lg border border-[#bdc7cf] bg-admin-surface py-2 pr-3 pl-9 text-[13px] text-admin-ink outline-none transition [&::-webkit-search-cancel-button]:appearance-none focus:border-lab-primary focus:ring-[3px] focus:ring-lab-primary/20";

export const tableHeadClasses =
  "border-b border-admin-border px-4 py-2.5 text-left text-xs font-semibold text-admin-muted";

export const tableCellClasses = "border-b border-admin-border/60 px-4 py-2.5 align-top";

export function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
