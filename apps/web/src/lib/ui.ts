import {
  Box,
  ChartColumn,
  Check,
  CircleCheck,
  CircleDashed,
  Clock,
  ExternalLink,
  File,
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
import { readTimestampFormat } from "./preferences";

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
 * It lives here rather than inside `Card` because some surfaces draw a card header in open
 * code — the shops and documents tables, which need a filter row between the title and the
 * table, and the settings zones. A card title spelled once per surface is a card title that
 * ends up spelled several ways.
 */
export const cardTitleClasses = "font-display text-[17px] font-bold tracking-[-0.01em]";

/**
 * An editor's body: the cards at most 790px wide and the 312px side panel beside them from
 * `xl`, top-aligned (`Workspace.dc.html` :404–405, :467), as *Shop details* drew it first
 * (ADR 0071). Narrower than both need, the panel follows the cards, which is where the
 * prototype's wrapping row puts it.
 *
 * The panel holds the gate card first (`GateCard`), read-only context next and the freeze card
 * — "What publishing freezes" — last, and never a field of the draft
 * (`docs/design-direction.md`, *The form language*). Its cards are 14px apart, as every
 * prototype panel spaces them.
 */
export const editorColumnsClasses = "grid items-start gap-5 xl:grid-cols-[minmax(0,790px)_312px]";
export const editorMainClasses = "grid min-w-0 gap-4";
export const editorPanelClasses = "grid min-w-0 gap-3.5";

/**
 * The form a list grows by, below the saved entries it adds to (`docs/design-direction.md`,
 * *A saved row opens where it stands*). Now that an entry carries its body, the top rule is
 * what tells an author where the saved configuration ends and the blank form begins. Its
 * labels stack — the one place an editor's fields are not on rows — and its one submit is a
 * `PrimaryAction` with the create glyph and, where it is refused, its `RefusalLine`.
 *
 * A form that lays its fields out across columns composes its grid onto this rather than
 * restating the rule.
 */
export const addFormClasses = "grid gap-2 border-t border-admin-border pt-3";

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
 *
 * **The surface carries no width; every consumer states its own** (ADR 0069). Tailwind emits
 * its utilities in one fixed order whatever order a caller writes them in, so a width on this
 * string beats any width a call site composes after it — `w-full` here made the order line's
 * quantity and the shipping fee fill their cell for as long as they existed, with `w-20` and
 * `w-32` at their call sites doing nothing. With none here, the call site's width is the only
 * one and it is the one drawn: `w-full` almost everywhere, and the few saying otherwise.
 */
const fieldSurfaceClasses =
  "rounded-[9px] border border-admin-field-border bg-admin-surface px-3.5 text-admin-ink outline-none transition focus:border-lab-primary focus:ring-[3px] focus:ring-lab-primary/20 aria-invalid:border-lab-error disabled:cursor-not-allowed disabled:opacity-65 select-chevron";

/**
 * The single-line control's height, the handoff's `min-height:44px`: every control a value is
 * typed or chosen in, and the button that stands beside one (`subtleFieldButtonClasses`), so the
 * two are one height and level at the top.
 */
export const controlHeightClasses = "min-h-[44px]";

/**
 * The single-line control: the handoff's `min-height:44px`, `10px 14px` and `14.5px`.
 *
 * A floor rather than the `h-10` this used to be, because the README writes `min-height` and
 * the difference is not pedantic — the same string paints a `<select>`, an
 * `<input type="date">` whose picker glyph is taller than the text beside it, and a control
 * whose value wraps. A fixed height clips all three; a floor lets them grow and holds the
 * target size for a pointer everywhere else.
 *
 * **A select draws the workspace's chevron, not the browser's.** `select-chevron` (`styles.css`,
 * carried by the surface every control shares) applies to a `<select>` alone — this string
 * also paints inputs — and gives it
 * `appearance: none`, so Safari draws the same box as every other browser rather than its own
 * rounded, gradient control, with a chevron in `admin-muted` drawn in its place and the right
 * padding the chevron needs. A `multiple` or sized select is a list box and gets neither. Under
 * forced colours a `url()` background image is kept, but in its fixed grey, which the
 * high-contrast ground can make illegible; so there the select goes back to `appearance: auto`
 * and the system draws its own arrow in the system's colours. It is here rather than on a
 * select-only string because every `<select>` in the workspace is already drawn from this one
 * (`ui.test.ts` holds them to it), and a second class is a second thing to forget.
 */
export const fieldControlClasses = `box-border ${controlHeightClasses} py-2.5 text-[14.5px] ${fieldSurfaceClasses}`;

/**
 * The single-line control for an identifier a reader checks character by character: the same
 * box in the monospace face at 13.5px, as the methods handoff draws a method's ID field
 * (ADR 0072), and as Lab settings draws the connection's base URL and API key, which the
 * prototype sets at 13px (`Workspace.dc.html` :4018, :4038): one monospace size for every
 * such control, half a point off that frame, as the census above flattens its compact ones.
 * Its own string rather than `font-mono text-[13.5px]` composed after the control's, because
 * Tailwind emits one of two font sizes last whatever order a class string writes them in, and
 * here that is the control's 14.5px.
 */
export const idControlClasses = `box-border ${controlHeightClasses} py-2.5 font-mono text-[13.5px] ${fieldSurfaceClasses}`;

/**
 * The multi-line control, at the prototype's own metrics rather than the input's: 14px on a
 * 1.6 leading, `11px 14px`, and a floor of its own in place of the 44px one.
 */
export const textAreaClasses = `box-border min-h-24 py-[11px] text-[14px] leading-[1.6] ${fieldSurfaceClasses}`;

/**
 * A form row's answer where the page decides it rather than asking: the control's box, on the
 * canvas, with no border a reader could mistake for something to type in.
 *
 * The prototype draws exactly this on the new-configuration page's Provider row, as the
 * alternative to the select (`Workspace.dc.html`:3325): a framework is proven on one provider
 * here, and *a choice of one is not a choice*, so the page shows what the framework decided
 * instead of offering a list with one entry. Minted with that row as its only consumer
 * (PLAN-UX Slice 13).
 *
 * The ground is `admin-canvas` where the prototype writes `#f4f5f6`. One recessed ground for
 * the workspace rather than a second literal a pixel away from the token that already means
 * it; the border is the card's rather than the field's, which is the whole distinction the
 * row is drawing.
 */
const readOnlyBoxClasses =
  "box-border min-h-[44px] w-full rounded-[9px] border border-admin-border bg-admin-canvas px-3.5 text-admin-ink-soft";

export const readOnlyValueClasses = `${readOnlyBoxClasses} flex items-center text-[14px]`;

/**
 * The same box for a value that runs to several lines — the system prompt resolved against the
 * preview context, its variables drawn as chips in the flow of its text. A flex box would make
 * every run of text and every chip an item of its own, so this one is a block that keeps the
 * text's own line breaks, at the textarea's vertical padding.
 */
export const readOnlyTextClasses = `${readOnlyBoxClasses} block py-[11px] text-[13px] leading-relaxed whitespace-pre-wrap`;

/**
 * A stacked field: its label, its control and the lines under it, packed at the top.
 *
 * `content-start` because this is a grid that is often a grid item itself: in a form grid
 * whose cells stretch to the row's tallest field (the variant add form's), a field with fewer
 * lines under it than its neighbour would otherwise share the spare height among its own rows
 * — the label's and the control's among them — and draw its control lower and taller than the
 * one beside it, as the price did beside the SKU.
 */
export const fieldLabelClasses = "grid content-start gap-1 text-xs font-semibold text-admin-muted";

/**
 * The grid the form below a list lays its fields in: the methods handoff's
 * `repeat(auto-fit, minmax(160px, 1fr))` at 12px (`shop-details.template.html` :172), so each
 * field fills its track and the tracks share the row.
 */
export const itemFormGridClasses =
  "grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] items-start gap-3";

/**
 * The same tracks for a field that spans that grid and must line its own parts up with the
 * fields above it: a list's add-a-value input in the first track, its *Add* in the next.
 *
 * `auto-fill` where the grid says `auto-fit`, and the two agree: `auto-fit` collapses only the
 * tracks no item occupies, and a full-width item occupies every one, so the form's grid keeps
 * as many tracks as fit — which is what `auto-fill` keeps here, where two items would otherwise
 * stretch over the whole row.
 */
export const itemFormTracksClasses =
  "grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] items-start gap-3";

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
 * The right column, taking the row's whole width: the control wraps under its label rather
 * than beside it. For the one control a card is built around — the system prompt's template —
 * which a 330px column would cut to a few words a line.
 */
export const fieldRowWideControlClasses = "min-w-0 flex-[1_1_100%]";

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

/**
 * The ring a keyboard reader gets on the top bar, which cannot be the pine one above.
 *
 * The prototype draws `2px solid #1d6241` on the bar's own controls as it does everywhere else,
 * and on the bar's `#16332d` ground that measures **1.86:1** — under the 3:1 WCAG 2.2 asks of a
 * focus indicator (1.4.11). `docs/design-direction.md`'s *Principles* put "WCAG 2.2 AA contrast;
 * every workflow keyboard-reachable" above any measurement below them, so the Authority's rule 2
 * does not carry the prototype's value here. The ring is the bar's own paper instead — 13.37:1
 * on the bar and 10.44:1 on the hover pill — which is already the colour of the active tab's
 * underline, so the bar gains a contrast and not a colour (ADR 0055).
 */
export const topBarFocusRingClasses =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lab-paper";

/**
 * The same ring, drawn inside the control instead of around it.
 *
 * For the two controls that are the bar's whole 56px — the mode tabs and the app title. An
 * outward offset puts their top band above the bar, where the shell's `overflow-hidden` clips
 * it, and their bottom band on the pane below, where the paper reads 1.06:1 on
 * `admin-canvas`: a reader would get two vertical lines rather than a ring. Inset, all four
 * edges are on the bar's forest and the ring is the 13.37:1 one everywhere (ADR 0055).
 */
export const topBarInsetFocusRingClasses =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lab-paper";

/**
 * Everything the top bar draws that is not a shop's name: the two mode tabs and the two quiet
 * controls at the right, *Show me around* and *Settings*.
 *
 * Their own class sets rather than button variants, because they sit on the bar's forest ground
 * and every variant in the table below is drawn for the paper underneath it. They are gathered
 * here rather than beside the header that renders them because the bar is drawn from two files —
 * the shell and the switcher — and `#a8c1b8` is one ink in one role across both
 * (`docs/design-direction.md`, *Tokens, type and glyphs*). `#21453b` stays a literal: the hover
 * pill is one role drawn in this file alone, and a token is minted for a role rather than for a
 * second consumer of a hex.
 *
 * The handoff for the controls: 13px 600 in `#a8c1b8`, filling a 9px-radius pill of `#21453b`
 * with white text under the pointer, and lit — the pill already filled, at 700 — while its own
 * page is open.
 */
const topBarControlBaseClasses = `inline-flex items-center gap-[9px] self-center rounded-[9px] px-3.5 py-2 text-[13px] whitespace-nowrap transition ${topBarFocusRingClasses}`;

export const topBarControlClasses = `${topBarControlBaseClasses} font-semibold text-[#a8c1b8] no-underline hover:bg-[#21453b] hover:text-white`;

/** The same control while the page it opens is the page you are on. */
export const topBarControlLitClasses = `${topBarControlBaseClasses} bg-[#21453b] font-bold text-white no-underline hover:bg-[#2a544a]`;

/**
 * A mode tab, stretched to the bar's full height with its underline along the bottom edge.
 *
 * 2px, which is the README's value against the prototype's 3px: one value against one value in
 * one role is the Authority's rule 3, and the README wins (ADR 0055). Everything else here is
 * the prototype's — 13px, white at 700 lit and `#a8c1b8` at 600 otherwise. The ring is the
 * inset one: a tab is the bar's full height, so an outward offset would draw half of it off
 * the bar.
 */
const modeTabClasses = `flex items-center gap-2 self-stretch border-b-2 px-1 text-[13px] no-underline transition ${topBarInsetFocusRingClasses}`;

export const activeModeTabClasses = `${modeTabClasses} border-lab-paper font-bold text-white`;

export const inactiveModeTabClasses = `${modeTabClasses} border-transparent font-semibold text-[#a8c1b8] hover:text-white`;

/**
 * A button's geometry and type, with no colour and no state in it.
 *
 * Split out so the blocked weight below can take the shape of a primary action without also
 * taking `disabled:opacity-55`, which is drawn for a control that is *temporarily* unavailable
 * and would fade a variant whose whole palette is already the faded one.
 */
const buttonShapeClasses =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition";

/**
 * A control that is temporarily unavailable fades, whichever way it says so: natively
 * `disabled` — a secondary control refused for a reason (ADR 0063) — or `aria-disabled`, which
 * is how a press in flight keeps focus (ADR 0065). A refused primary action wears the blocked
 * weight instead, which is never read off this table.
 */
const unavailableClasses =
  "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

const buttonBaseClasses = `${buttonShapeClasses} ${focusRingClasses} ${unavailableClasses}`;

/** The small button's shape with no height, so the one that stands beside a field can take the field's. */
const smallButtonShapeClasses = `inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${focusRingClasses} ${unavailableClasses}`;

const smallButtonBaseClasses = `min-h-8 ${smallButtonShapeClasses}`;

const subtleColourClasses =
  "border border-admin-border bg-transparent text-admin-muted hover:bg-admin-canvas hover:text-admin-ink";

/**
 * Every button the workspace draws, in one table.
 *
 * Every weight; a size modifier is built from the same parts (`subtleFieldButtonClasses`). The
 * named exports below are read off this record rather than written beside it, so a variant
 * cannot exist that `ui.test.ts` does not check for its hover and its focus ring — and the
 * test runs the same rules over each size modifier.
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
 * - **destructiveSubtle** — an extension, not something the prototype draws: the same
 *   red-bordered weight at the small size, for a Remove that acts on a whole card rather than on
 *   a row — the document editor's. A row's Remove is never this: it is the 30px trash below,
 *   grey until hovered (ADR 0075).
 */
const buttonVariants = {
  accent: `${buttonBaseClasses} bg-lab-primary text-lab-paper hover:bg-lab-primary-hover`,
  ink: `${buttonBaseClasses} bg-lab-ink text-lab-canvas-top hover:bg-lab-ink-hover`,
  outline: `${buttonBaseClasses} border border-admin-border bg-transparent text-admin-ink hover:bg-admin-canvas`,
  warning: `${buttonBaseClasses} bg-lab-accent text-lab-paper hover:bg-lab-accent-hover`,
  destructive: `${buttonBaseClasses} bg-lab-error text-lab-paper hover:bg-lab-error-hover`,
  destructiveOutline: `${buttonBaseClasses} border border-lab-error-border bg-transparent text-lab-error hover:bg-lab-error-tint`,
  subtle: `${smallButtonBaseClasses} ${subtleColourClasses}`,
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
 * The subtle button at the height of the control it stands beside — a chip list's *Add value*
 * next to its input — so the two are one height, top-aligned and therefore level. The subtle
 * weight's colours, hover and ring, on the control's floor rather than the small button's.
 */
export const subtleFieldButtonClasses = `${controlHeightClasses} ${smallButtonShapeClasses} ${subtleColourClasses}`;

/**
 * A product image's drop zone (ADR 0076): a dashed field-sized well the operator drops a file
 * on, holding the chosen image's thumbnail and name, or "Drop an image here". Dashed because it
 * is a place to put something rather than a value; pine while a file is dragged over it.
 */
export function mediaDropZoneClasses(dragging: boolean): string {
  return `flex min-h-[72px] flex-wrap items-center gap-3 rounded-[9px] border border-dashed px-3.5 py-3 text-[13.5px] font-normal transition ${
    dragging
      ? "border-lab-primary bg-lab-primary/5 text-admin-ink"
      : "border-admin-field-border bg-admin-surface text-admin-ink-soft"
  }`;
}

/** *Browse…* in the drop zone: the visually hidden file input's label, ringed when it has focus. */
export const mediaBrowseClasses = `${subtleFieldButtonClasses} cursor-pointer border border-admin-quiet-border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lab-primary peer-aria-disabled:cursor-not-allowed peer-aria-disabled:opacity-55`;

/** An image the shop holds, as a list's item leads with it and the drop zone shows it: 48px. */
export const mediaThumbnailClasses =
  "h-12 w-12 flex-none rounded-md border border-admin-border bg-admin-canvas object-cover";

/**
 * One image of the shop's library (Slice 40b): a native radio drawn as a tile, as the logo's
 * marks are — the input visually hidden and the label carrying the look, so the library is a
 * real radio group with arrow keys and one tab stop. Pine when chosen; quiet and not pressable
 * for an image this product already shows.
 */
export const mediaLibraryTileClasses =
  "flex min-w-0 cursor-pointer flex-col items-start gap-1 rounded-[9px] border border-admin-quiet-border bg-white p-2 text-[12.5px] text-admin-muted hover:border-admin-faint has-checked:border-lab-primary has-checked:bg-admin-chip has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-lab-primary has-disabled:cursor-not-allowed has-disabled:hover:border-admin-quiet-border";

/**
 * A product's first image on its catalog row (Slice 41): the 30px tile, rounded 8px, that the
 * shops index draws a shop's logo in (`Workspace.dc.html` :181).
 */
export const catalogImageTileClasses =
  "h-[30px] w-[30px] flex-none rounded-[8px] border border-admin-border bg-admin-canvas object-cover";

/** An image as the library offers it: 72px. */
export const mediaLibraryThumbnailClasses =
  "h-[72px] w-[72px] flex-none rounded-md border border-admin-border bg-admin-canvas object-cover";

/**
 * A primary action that cannot proceed: dashed, quiet, reachable, and never pressable.
 *
 * `docs/design-direction.md` states the rule — *A blocked primary action says why*: dashed,
 * `aria-disabled` and reachable, the reason in `title` and inline in its accessible description.
 * The prototype draws exactly this weight on the blocked *Create scenario*
 * (`Workspace.dc.html`:2933), *Save connection* (:3987) and *Done* (:1965): `1px dashed #d4d8db`
 * over `#fafbfb` in `#9aa2a8`. All four shop-scope create headers draw a solid grey slab instead
 * (:216 *Create shop*, :1210 *Create order*, :1341 *Create profile*, :1651 *Create identity*),
 * and the README settles that one value against the other — "Blocked primary actions render as
 * a dashed disabled variant with the reason in `title`" — under the Authority's rule 3. The
 * dashed weight is what ships on all of them.
 *
 * **It is deliberately not a row of `buttonVariants`.** Every row of that table is swept for a
 * hover, and this control must not have one: a hover would promise a press that does nothing.
 * It does carry the focus ring, because since ADR 0063 a refused action is `aria-disabled`
 * rather than `disabled` and stays in the tab order — a keyboard reader lands on it and is told
 * the reason, and has to see where they landed. `ui.test.ts` holds this set to its own rules
 * rather than to the table's.
 *
 * Drawn only by `PrimaryAction` (`components/PrimaryAction.tsx`), which also swallows the press.
 */
export const blockedButtonClasses = `${buttonShapeClasses} ${focusRingClasses} cursor-not-allowed border border-dashed border-admin-quiet-border bg-[#fafbfb] text-admin-faint`;

/**
 * The handoff's validation message — "Validation messages sit under the control: 13px 600
 * `#9d3028`" (`tmp/design-frames/README.md`, *The form pattern*) — and, since ADR 0063, the
 * reason a refused action gives inline too: one weight for "this cannot proceed", wherever the
 * sentence is drawn. `lab-error` is `#9d3028`.
 */
export const validationMessageClasses = "text-[13px] font-semibold text-lab-error";

/**
 * A refused action's reason while nobody has touched its form (ADR 0078): the handoff's hint —
 * "13px/1.5; #42474c" (`tmp/design-frames/README.md`, *The form pattern*) — rather than its
 * validation message. The words are the same and so is the button; the line only stops
 * shouting about a press nobody has made. `admin-ink-soft` is `#42474c`, 7.8:1 or better on
 * every ground a refusal is drawn on, where `admin-muted` falls to 4.4:1 on the lab canvas.
 * `font-normal` is the README's 400, set rather than inherited, since a line can sit in a
 * parent at another weight. The leading is left to the parent, as the validation message's is,
 * so the line keeps its height when it turns and nothing below it moves.
 */
export const refusalHintClasses = "text-[13px] font-normal text-admin-ink-soft";

/**
 * The weight a refusal's own line reads at: the hint while its form is untouched, the
 * validation message once the operator has edited the form or pressed the refused action
 * (ADR 0078, amending ADR 0063). `RefusalLine` draws it; a reason drawn as more than one line —
 * `PublishReasons`, Start's list — wears it too, so one rule reads one way everywhere.
 */
export function refusalLineClasses(touched: boolean): string {
  return touched ? validationMessageClasses : refusalHintClasses;
}

/**
 * One entry of a list edited in the form below it (`ListItem`, ADR 0072, ADR 0074): 11px 14px
 * on a 9px radius, `admin-border` on `#fafbfb`, and the methods handoff's pine border and ground
 * (`#8fc3a5` on `#f1f8f3`) while the form holds it.
 */
export function itemClasses(editing: boolean): string {
  return `flex flex-wrap items-center gap-[11px] rounded-[9px] border px-3.5 py-[11px] ${
    editing ? "border-[#8fc3a5] bg-[#f1f8f3]" : "border-admin-border bg-[#fafbfb]"
  }`;
}

/**
 * An item's 30px icon button: the pencil and the trash, bordered, muted until hovered. Every
 * row's Edit and Remove in the workspace is one of these, its verb in its accessible name and
 * never drawn (ADR 0075).
 */
export const itemIconButtonClasses = `flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-admin-quiet-border bg-admin-surface text-admin-muted transition ${focusRingClasses}`;
// A pencil whose row cannot open while another row is open fades as the held trash does.
export const itemEditButtonClasses = `${itemIconButtonClasses} enabled:hover:bg-[#f6f7f8] enabled:hover:text-admin-ink disabled:cursor-not-allowed disabled:opacity-55`;
// An arrow at the end of the list it cannot pass fades as the held trash does.
export const itemMoveButtonClasses = `${itemIconButtonClasses} text-[14px] enabled:hover:bg-[#f6f7f8] enabled:hover:text-admin-ink disabled:cursor-not-allowed disabled:opacity-55`;
// A held Remove fades as a secondary control refused for a reason does (ADR 0063), and loses
// the hover that would promise a press.
export const itemRemoveButtonClasses = `${itemIconButtonClasses} enabled:hover:border-[#c98676] enabled:hover:text-lab-error disabled:cursor-not-allowed disabled:opacity-55`;

/**
 * The neutral pill: a standing fact about the page, in grey, beside its title.
 *
 * `VersionChips` draws its two grey states through it — *Never published* and *Draft matches
 * vN* — and so does the create page's *nothing created yet* chip, which used to spell the
 * prototype's `#f0f2f4` over `#59636d` at 11px 700 (`Workspace.dc.html` :211, :392) in raw
 * values of its own. One pill that means "a fact, neither published nor in progress" is one
 * value, and the value it takes is the one that is already a token (`admin-border` under
 * `admin-ink-soft`, the Authority's rule 5): the create page's chip moved onto the version
 * chips' weight rather than the other way round. The pill carries its glyph as a child, never
 * as its only word (*Principles*, status is never colour alone).
 */
export const neutralPillClasses =
  "inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft";

/**
 * A pinned version as a chip that opens what it pinned (ADR 0068): the neutral pill's shape,
 * with the link's underline on hover and the workspace's focus ring, because unlike the bench's
 * chips it is a control (`chipClasses` is for the ones that are not).
 */
export const versionChipClasses = `rounded-full bg-admin-border px-2.5 py-0.5 font-semibold text-admin-ink-soft no-underline underline-offset-2 hover:underline ${focusRingClasses}`;

/**
 * The published pill: the neutral pill's shape on the published tokens.
 *
 * `VersionChips` draws "vN published" in it and the index's publication pill draws a
 * published record's "v3 · 2 versions" in it — the green the prototype gives a published
 * state (`Workspace.dc.html` :189), on the tokens `VersionChips` already used. Written once
 * so the two cannot drift; the glyph is the caller's child, as on the neutral pill.
 */
export const publishedPillClasses =
  "inline-flex items-center gap-1.5 rounded-full bg-admin-published px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-published-ink";

/**
 * A chip that says what something is, and does nothing when pressed.
 *
 * The bench and the timeline mark a tool call, a retried attempt, a scenario fault and a turn
 * only one arm heard with a small bordered label. Those labels used to wear the button classes,
 * so each drew a hover and a focus ring and read as a control a reader could press — and none
 * of them can be. A chip names a kind (*Tokens, type and glyphs*), and this is its weight: the
 * README's "7px small chips" radius, the border of a secondary, and no hover, no pointer, no
 * ring and no transition, because each of those promises a press. A chip is a `span` or an
 * `li` and never takes a `tabIndex`; one that became interactive would be a button, and would
 * take a row of `buttonVariants` instead.
 *
 * Two tones, for the two things the strips already told apart: `mark` for what happened to the
 * arm (a fault, an attempt, a split turn), and `quiet` for what the agent did (a tool call).
 */
const chipBaseClasses =
  "inline-flex cursor-default items-center rounded-[7px] border border-admin-border px-1.5 py-0.5 text-[10px] font-semibold";

const chipTones = {
  mark: `${chipBaseClasses} text-admin-ink`,
  quiet: `${chipBaseClasses} text-admin-muted`,
} as const;

export type ChipTone = keyof typeof chipTones;

export const chipClasses: Readonly<Record<ChipTone, string>> = chipTones;

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
  | "results"
  | "open";

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
 * `open` is the handoff's eleventh verb, named in the README and drawn nowhere until the shop
 * overview's grouped findings (`Workspace.dc.html`:794, PLAN-UX Slice 15): a control that
 * leaves this surface for the entry it names. It is the arrow leaving a box the prototype
 * draws, and it is not `edit` — what is on the other side is a whole editor rather than the
 * row in front of the reader.
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
  open: ExternalLink,
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
 * The results' depth tabs, and the rule they sit on.
 *
 * The prototype's own declaration (`tmp/design-frames/Workspace.dc.html` :2595–2602):
 *
 * ```
 * row:      display:flex; gap:2px; border-bottom:1px solid #e1e3e5
 * selected: padding:10px 15px; 13px 700; colour #14352e; border-bottom:2px solid #c2532d;
 *           margin-bottom:-1px
 * idle:     padding:10px 15px; 13px 600; colour #6d7175; hover colour #202223
 * ```
 *
 * The selected tab is told apart by its underline, its weight and its ink, never by
 * `aria-current` alone. The idle tab carries a transparent underline of the same width so that
 * moving between tabs moves nothing. `#14352e` is `admin-selected-ink`, the token the rail's
 * active row draws too (`AppShell.tsx`): the prototype's ink where you are standing. The row
 * wraps, as every row does.
 */
export const depthTabRowClasses = "flex flex-wrap items-end gap-0.5 border-b border-admin-border";

const depthTabBaseClasses = `-mb-px inline-flex items-center border-b-2 px-[15px] py-2.5 text-[13px] transition ${focusRingClasses}`;

const depthTabStates = {
  selected: `${depthTabBaseClasses} border-lab-accent font-bold text-admin-selected-ink`,
  idle: `${depthTabBaseClasses} border-transparent font-semibold text-admin-muted hover:text-admin-ink`,
} as const;

export type DepthTabState = keyof typeof depthTabStates;

/** The table itself, for the test that holds both states to the same rules. */
export const depthTabStateClasses: Readonly<Record<DepthTabState, string>> = depthTabStates;

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
 * **All seven.** The page — the document kind — was the one left out while nothing drew it:
 * the prototype spends it on a single Policies & FAQ table filtered by *Policies*,
 * *Guidelines* and *FAQ*, and this workspace had no such table. PLAN-UX Slice 16 built it, so
 * the kind lands with its first consumer, which is the house rule in `docs/design-direction.md`
 * — a primitive no page uses is not a slice — read the other way round.
 */
export type FilterChipKind =
  | "all"
  | "published"
  | "draft"
  | "attention"
  | "referenced"
  | "unfulfilled"
  | "document";

/**
 * Kind to glyph, written once so the pairing cannot drift across the chip rows.
 *
 * A page names a kind; it never names the icon. Which kind a chip takes is the prototype's
 * own `filterKind` classifier (`Workspace.dc.html`:5568–5577) read over that chip's label —
 * *Payment unsettled* and *Without a default address* are alerts by that function, *Shared* is
 * a chain, and everything it does not otherwise place is the check. `published` is that check:
 * the classifier's `ok`, named for the README's "check = published/active", and so the kind of
 * every active-state chip the classifier leaves unplaced — Orders' and Tickets' *Open*,
 * Tickets' *Resolved*, *Active*, *Usable*, *Runnable*, *Adoptable* — as well as of *Published*.
 * Experiment history's status chips are the one row placed otherwise: the classifier places
 * none of *Running*, *Completed* and *Failed* and would draw its check beside *Failed*, so they
 * take the README's *Assets* meanings — the clock, the check and the triangle
 * (`docs/design-direction.md`, *Departures*, "History's status chips").
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
  document: File,
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

/**
 * What a table that can be wider than its card is drawn in: it scrolls sideways inside the card
 * rather than pushing the pane past a phone's viewport, where nothing could scroll it back
 * (ADR 0079). `relative`, because a cell's `sr-only` line is absolutely placed: laid out against
 * the pane instead of this scroller, it would widen the pane by however far the table runs.
 */
export const tableScrollerClasses = "relative overflow-x-auto";

export const tableHeadClasses =
  "border-b border-admin-border px-4 py-2.5 text-left text-xs font-semibold text-admin-muted";

export const tableCellClasses = "border-b border-admin-border/60 px-4 py-2.5 align-top";

/**
 * The date this workspace has always drawn: `19 Sept 2026, 14:07`, in the reader's own zone.
 *
 * Exported so the settings row that offers it can generate its own example from the formatter
 * instead of spelling the shape a second time beside it.
 */
export function formatAbsoluteTimestamp(isoTimestamp: string): string {
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

/**
 * The relative reading, largest unit first (ADR 0058).
 *
 * `numeric: "always"`, so a column reads "1 day ago" beside "2 days ago" rather than
 * "yesterday" beside "2 days ago": the rows of a table have to be comparable down the column,
 * which is the one thing the friendlier spelling costs.
 */
const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

function formatRelativeTimestamp(date: Date, now: number): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 60) {
    // Under a minute in either direction there is no unit worth naming, and "in 0 seconds" is
    // what `Intl` would otherwise say about the instant a row was just written.
    return "just now";
  }
  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "always" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (magnitude >= size) {
      return formatter.format(Math.trunc(seconds / size), unit);
    }
  }
  return formatter.format(Math.trunc(seconds / 60), "minute");
}

/**
 * An instant the lab's own clock wrote — an `updated_at`, a `created_at`, a `published_at` —
 * under the reader's timestamp preference (ADR 0058).
 *
 * The preference is read here rather than handed in, because it can only be changed on
 * `/settings`, which draws no timestamp of its own: leaving that page is a mount, and every
 * listing re-reads it on the way in.
 */
export function formatTimestamp(isoTimestamp: string): string {
  if (readTimestampFormat() === "absolute") {
    return formatAbsoluteTimestamp(isoTimestamp);
  }
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return formatRelativeTimestamp(date, Date.now());
}

/**
 * An instant inside the fiction — an order's `placed_at`, a frozen address's `selected_at` —
 * which is always a date and never an "ago" (ADR 0058).
 *
 * *Ago* is measured from the reader's wall clock, and a fixture has none: an author who typed
 * 21 August 2026 into an order said when it was placed in the story, and "a month ago" would
 * say this shop has been trading for a month — a claim about this workspace that nobody made
 * and that changes every day the fixture is not touched.
 */
export function formatFixtureTimestamp(isoTimestamp: string): string {
  return formatAbsoluteTimestamp(isoTimestamp);
}
