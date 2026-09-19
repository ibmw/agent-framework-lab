import {
  ChartColumn,
  Check,
  GitBranch,
  type LucideIcon,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Star,
  Trash2,
  Upload,
} from "lucide-react";

/** The lab note: the pine-on-cream band the synthetic-sandbox notices are drawn on. */
export const labNoteClasses = "rounded-[10px] border border-[#b7d9cc] bg-[#eaf4f0]";

export const surfaceClasses =
  "rounded-[10px] border border-admin-border bg-admin-surface shadow-[0_1px_2px_rgb(22_51_45/6%)]";

const fieldSurfaceClasses =
  "w-full rounded-lg border border-admin-border bg-admin-surface px-3 text-sm text-admin-ink outline-none transition focus:border-lab-primary focus:ring-[3px] focus:ring-lab-primary/20 aria-invalid:border-lab-error disabled:cursor-not-allowed disabled:opacity-65";

export const fieldControlClasses = `box-border h-10 ${fieldSurfaceClasses}`;

export const textAreaClasses = `box-border min-h-24 py-2 ${fieldSurfaceClasses}`;

export const fieldLabelClasses = "grid gap-1 text-xs font-semibold text-admin-muted";

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
 * The colours are the refresh's (`docs/design-direction.md`, "the workspace refresh"):
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
