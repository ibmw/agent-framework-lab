import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import { type ReactNode, type Ref, useId } from "react";
import { Link, type To } from "react-router-dom";
import {
  PUBLISH_UNSAVED_REASON,
  publishErrorsReason,
  publishRefusalReason,
  publishUnchangedReason,
} from "../lib/definitionEditor";
import type { EntryEdit } from "../lib/entryEdit";
import { groupFindings, type IssueEntry, type IssueGroup } from "../lib/issueRoutes";
import {
  clearStickyHeader,
  STICKY_REPORT_ATTRIBUTE,
  stickyHeaderClasses,
} from "../lib/stickyHeader";
import {
  accentButtonClasses,
  cardTitleClasses,
  focusRingClasses,
  neutralPillClasses,
  outlineButtonClasses,
  subtleButtonClasses,
  surfaceClasses,
  validationMessageClasses,
} from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";
import { PrimaryAction, type Refusal } from "./PrimaryAction";

/**
 * Draft and published state is never carried by colour alone: every chip pairs its colour
 * with a glyph and an explicit label.
 */
export interface VersionProvenance {
  latest_published_version: number | null;
  next_version: number;
  matches_latest_published: boolean;
}

export function VersionChips({ preview }: { preview: VersionProvenance | null }) {
  if (!preview) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {preview.latest_published_version === null ? (
        <span className={neutralPillClasses}>
          <span aria-hidden>◦</span> Never published
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-published px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-published-ink">
          <span aria-hidden>●</span> v{preview.latest_published_version} published
        </span>
      )}
      {preview.matches_latest_published ? (
        <span className={neutralPillClasses}>
          <span aria-hidden>=</span> Draft matches v{preview.latest_published_version}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-draft px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-draft-ink">
          <span aria-hidden>◐</span> Draft v{preview.next_version} in progress
        </span>
      )}
    </div>
  );
}

/**
 * The page's own name, in the workspace's display face.
 *
 * The handoff's *Type* line gives page titles as Georgia 24–27px 700. The prototype draws
 * something more particular than a range, and the distinction is recorded here because this
 * component flattens it. Its rule is **a bound name against a fixed label**, not an editor
 * against an index: all fifteen titles it binds to data — `{{ prodTitle }}`, `{{ agName }}`,
 * `{{ ordRef }}`, `{{ scnNameShown }}` — are 22px, below the stated floor, and all fourteen it
 * writes as a fixed label are 24px, two of them editors (Tone of voice `:1897`, Shop details
 * `:1997`). Outside those two classes it draws 26px on Shops `:153` and the shop overview
 * `:722`, and 27px on Settings `:3854`.
 *
 * One `PageHeader` renders both classes and no slice has given it a variant, so it takes 24px
 * at `-0.015em`: the size of the fixed-label class, and the only one of the two the handoff's
 * range admits. That is a departure from the prototype for the fifteen bound names, written
 * down in `docs/history/workspace-refresh-pattern-slices.md` UI-5 so the variant can be added rather than the census
 * rediscovered — and what to watch when it is added is a long product or customer name wrapping
 * at 24px Georgia where 22px would have held it on one line.
 *
 * The 5px between the title and its description is the prototype's own
 * (`Workspace.dc.html`:154, 816), and it is the whole of this header's density change.
 *
 * **An editor's header sticks** (`sticky`): the prototype draws every page that edits one
 * thing — a product, an order, a customer, a document, a scenario, an agent, a judge, a block,
 * an identity — with its header pinned to the top of the scrolling pane on the canvas and over
 * a 1px rule (`Workspace.dc.html`:387, :483, :890, :1746), so Save and Publish are in reach at
 * the foot of the longest of them. The shop's four setup pages stick too, although the
 * prototype draws them unpinned (:1893, :1993): their Save is in the header and Shop details
 * runs to more than two screens. It is the create page's header mechanism, shared rather than
 * restated (`lib/stickyHeader.ts`), and it holds only while its name and actions take a third
 * of the pane or less. An index, the overview, the results and the lab's settings scroll their
 * header away, as the prototype draws them — even the Products and Documents tables and the
 * overview, which carry the shop draft's Save: they are lists and a summary, not an editor of
 * one object (ADR 0066).
 *
 * `reasons` is what the header's actions say about themselves: why a press failed, what a
 * publish froze, and `PublishReasons`' account of why Publish will not go. It is drawn under the
 * actions, right-aligned, inside the header, so a press and its outcome are pinned together
 * rather than the outcome being printed at the top of a page the operator has scrolled away from
 * (ADR 0063, *says why in the place the press was refused*).
 *
 * `back` is the way back, in the one place every editor keeps it (PLAN-UX Milestone 9): the ←
 * and the "Index · kind" line above the title, which is `HeaderBack` — the create page's own
 * piece — so an editor and the create page beside it are left the same way. The setup pages,
 * the indexes and the lab's own surfaces have nowhere to go back to and take none.
 */
export function PageHeader({
  title,
  chips,
  actions,
  reasons,
  description,
  back,
  sticky = false,
}: {
  title: string;
  chips?: ReactNode;
  actions?: ReactNode;
  /** What the header's actions report — a failure, a publish, a refusal — beneath them. */
  reasons?: ReactNode;
  description?: ReactNode;
  /** Where the ← and the line above the title go back to: the index this record is listed in. */
  back?: HeaderBackTarget;
  /** Pin the header to the top of the scrolling pane: true on an editor. */
  sticky?: boolean;
}) {
  // The chain step of a tour lights the page's own name: it is the one element every surface
  // has, and it is what the step is about — where you have arrived.
  const name = (
    <h1 className="font-display text-2xl font-bold tracking-[-0.015em]" data-tour="page-name">
      {title}
    </h1>
  );
  return (
    <header
      ref={sticky ? clearStickyHeader : undefined}
      className={sticky ? `${stickyHeaderClasses} ${pageHeaderClasses}` : pageHeaderClasses}
    >
      <div className="flex flex-wrap items-center gap-3">
        {back ? (
          <HeaderBack {...back}>
            {name}
            {chips}
          </HeaderBack>
        ) : (
          <>
            {name}
            {chips}
          </>
        )}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {reasons ? <HeaderReport>{reasons}</HeaderReport> : null}
      {description ? <p className="text-[13px] text-admin-muted">{description}</p> : null}
    </header>
  );
}

const pageHeaderClasses = "mb-4 grid gap-[5px]";

/** Where a header's way back goes, and the two words the line above its title reads. */
export interface HeaderBackTarget {
  /**
   * The page it returns to. Resolved against the address rather than the route tree, so an
   * editor's `..` is its index: the lab's editors are siblings of their index in the tree.
   */
  to: To;
  /** That page's name, as its own heading and the rail say it: "Agent configs". */
  label: string;
  /**
   * What this page is, in the prototype's words: "configuration", "creating an order fixture".
   * A page under one record — a scenario's starting states — names that record in `label` and
   * its kind here ("scenario"), since the page's own name is already its title.
   */
  kind: ReactNode;
}

/**
 * The way back above a page's title: the ← and the "Index · kind" line, with the title and what
 * stands beside it underneath (`Workspace.dc.html` :388–392, and :209–211 on a create page).
 *
 * One piece for the create page and every editor, so the way back is the same control in the
 * same corner wherever an operator is inside a record. The arrow is named "Back to {index}",
 * which is the name the create pages already answered to; the index's name in the line above
 * the title is a second link to the same place, as the prototype draws it, named by the index
 * alone. The audit that asked for this named it "‹ Index"; the prototype draws the ← and the
 * line, and that is what is built.
 */
export function HeaderBack({
  to,
  label,
  kind,
  children,
}: HeaderBackTarget & {
  /** The title, and what stands beside it — the chips on an editor, the chip on a create page. */
  children: ReactNode;
}) {
  return (
    // One item of the header's row, so the ← never wraps away from the title it stands beside.
    // It gives way before the actions do: from 16rem it takes what the row leaves it, and its
    // chips wrap under the title rather than pushing Save onto a line of its own — a wrapped
    // actions row costs a pinned header more height than a wrapped chip does (ADR 0066).
    <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3.5">
      <Link
        to={to}
        relative="path"
        aria-label={`Back to ${label}`}
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-[9px] border border-admin-field-border bg-admin-surface text-[15px] text-admin-ink-soft hover:bg-[#f1f2f3] ${focusRingClasses}`}
      >
        <span aria-hidden>←</span>
      </Link>
      <div className="min-w-0">
        <p className="text-xs text-admin-muted">
          <Link
            to={to}
            relative="path"
            className={`underline-offset-2 hover:underline ${focusRingClasses}`}
          >
            {label}
          </Link>{" "}
          · {kind}
        </p>
        <div className="mt-[3px] flex flex-wrap items-center gap-2.5">{children}</div>
      </div>
    </div>
  );
}

/**
 * The row under a header's actions that holds what they report: why a press failed, the
 * version a publish froze, `PublishReasons`. Right-aligned, under the buttons it is about.
 *
 * Three things about it are load-bearing:
 *
 * - **It is marked as a report** (`STICKY_REPORT_ATTRIBUTE`), so a pinned header decides
 *   whether it holds without it: a failed press grows this row, and a header that unpinned
 *   because of it would take the failure and the button off screen together (ADR 0066).
 * - **It is bounded** at a quarter of the viewport and scrolls within that. Its lines are
 *   few and short — at most one failure, one published version and four publish reasons — but
 *   the failure is the lab's own sentence and has no length the client controls; a row that
 *   grew without bound would be the letterbox the third-of-the-pane rule refuses, arrived at
 *   through the one row that rule does not measure. A scrolling row is reachable from the
 *   keyboard in the browsers this lab supports, which focus a scroll container that has no
 *   focusable content of its own.
 * - **It draws nothing while it holds nothing**, so an editor with nothing to report keeps
 *   the prototype's 5px between its name and its description.
 */
export function HeaderReport({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    // A named region, because it can be a stop on the keyboard's way through the page:
    // once its lines overflow the bound, the browser focuses it so they can be scrolled, and a
    // focus stop with no role and no name tells a screen reader nothing about where it is.
    <section
      aria-label="What the actions report"
      {...{ [STICKY_REPORT_ATTRIBUTE]: "" }}
      className={`grid max-h-[25vh] justify-items-end gap-1 justify-self-end overflow-y-auto text-right empty:hidden ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * The Save an editor's header carries, the Discard beside it, and the line that replaces both
 * once there is nothing to save.
 *
 * A clean editor used to draw a disabled accent button reading "Saved", which is a control
 * offering an action it will not perform; what it was actually reporting is a state, so it is
 * written as one (PLAN-UX Slice 8). "Discard changes" appears only while there is something to
 * discard, and it undoes exactly what Save would have written — the draft, and not a row that
 * is open for editing, whose typing no page-level Save has ever carried.
 */
export function EditorSaveActions({
  saveLabel = "Save draft",
  dirty,
  saving,
  discarding,
  onSave,
  onDiscard,
  tone = "outline",
  refusal = null,
}: {
  saveLabel?: string;
  dirty: boolean;
  saving: boolean;
  discarding: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Accent where Save is the page's primary action, outline where Publish is. */
  tone?: "accent" | "outline";
  /**
   * Why Save is refused, naming the line that says so (ADR 0063) — a field on the page holds a
   * value the draft cannot take, and saving around it would drop what was typed there.
   * Discard stays: it is how that value is let go.
   */
  refusal?: Refusal | null;
}) {
  return (
    <>
      {/* Present whether or not the editor is dirty, so the line is a live region an assistive
          technology is already watching when a save lands. */}
      <p role="status" className={dirty ? "sr-only" : "text-xs font-semibold text-admin-muted"}>
        {dirty ? "" : "All changes saved"}
      </p>
      {dirty ? (
        <>
          <button
            className={subtleButtonClasses}
            type="button"
            onClick={onDiscard}
            disabled={saving || discarding}
          >
            <ButtonIcon verb="discard" />
            {discarding ? "Discarding…" : "Discard changes"}
          </button>
          {refusal !== null && !saving && !discarding ? (
            <PrimaryAction variant={tone} type="button" refusal={refusal} onClick={onSave}>
              <ButtonIcon verb="save" />
              {saveLabel}
            </PrimaryAction>
          ) : (
            <button
              className={tone === "accent" ? accentButtonClasses : outlineButtonClasses}
              type="button"
              onClick={onSave}
              disabled={saving || discarding}
            >
              <ButtonIcon verb="save" />
              {saving ? "Saving…" : saveLabel}
            </button>
          )}
        </>
      ) : null}
    </>
  );
}

/**
 * A section of a page: its title in a header over a rule, then what it holds.
 *
 * `description` is the card's first line — the 13px muted sentence under the title that says
 * what the card is for (`Workspace.dc.html` :407–408), which *Shop details* and *Tone of voice*
 * used to draw by hand as their first child and every editor now hands over here. It is the
 * section's accessible description, so a reader who lands in the region is told what it is for
 * as well as what it is called. Where the sentence is also a control's description — the rule
 * a field is written under — `descriptionId` keeps the `id` that control points at.
 *
 * `footer` is for what acts on the card as a whole — *Add event*, the document's Remove — and
 * not for an explanation, which belongs on the first line.
 */
export function Card({
  title,
  label,
  description,
  descriptionId,
  busy = false,
  ref,
  children,
  footer,
}: {
  title?: ReactNode;
  /** Accessible name when the visible title is not a plain string. */
  label?: string;
  /** What the card is for, in one sentence: its first line. */
  description?: ReactNode;
  /** The first line's `id`, where a control inside the card is described by it too. */
  descriptionId?: string;
  /**
   * What this card shows is about to change, because an action in flight is changing it
   * (ADR 0065). Never set on a card that holds the action's own status, which a busy region
   * would keep from being announced.
   */
  busy?: boolean;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const accessibleName = label ?? (typeof title === "string" ? title : undefined);
  const generatedId = useId();
  const lineId = description ? (descriptionId ?? generatedId) : undefined;
  return (
    <section
      ref={ref}
      aria-label={accessibleName}
      aria-describedby={lineId}
      aria-busy={busy || undefined}
      className={`${surfaceClasses} overflow-hidden`}
    >
      {title ? (
        <h2 className={`border-b border-admin-border px-4 py-3 ${cardTitleClasses}`}>{title}</h2>
      ) : null}
      <div className="grid gap-3 p-4">
        {description ? (
          <p id={lineId} className={cardDescriptionClasses}>
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {footer ? <div className="border-t border-admin-border px-4 py-3">{footer}</div> : null}
    </section>
  );
}

/** A card's first line: 13px in the muted ink, held to the prototype's 70ch measure (:408). */
const cardDescriptionClasses = "max-w-[70ch] text-[13px] text-admin-muted";

/** What a gate card says while the screen holds edits its findings were not read off. */
function readOffTheSaved(record: string): string {
  return `Read off the saved ${record}. Save to check what is on screen.`;
}

/**
 * The first card of an editor's side panel: the findings the saved draft's gate returned, in a
 * frame that says when they are about to change and when the screen has moved past them.
 *
 * It is a frame and nothing more — what it holds is the caller's (`IssueList` on an editor, the
 * checklist's lines on the setup pages, ADR 0071). The gate answers for the saved draft, so the
 * card is `busy` from the moment a save lands until the gate has answered for it (ADR 0065),
 * and while the editor holds unsaved edits a line under the title says the findings are the
 * last save's: a clean ✓ beside a field the operator has just emptied is the gate's answer
 * about the saved draft, not a contradiction.
 */
export function GateCard({
  title,
  busy,
  dirty,
  record = "draft",
  children,
}: {
  /** "Publish gate" wherever the record or its shop draft publishes. */
  title: string;
  /**
   * The gate has not answered for the saved draft yet (`DefinitionEditor.checking`), or the save
   * is in flight, where no gate answers separately (the order's findings come back with it).
   */
  busy: boolean;
  /** The screen holds edits the saved draft does not. */
  dirty: boolean;
  /** What the findings are read off, where it is not a draft: an order is saved as itself. */
  record?: string;
  children: ReactNode;
}) {
  return (
    <Card title={title} busy={busy}>
      {/* Under the title rather than at the foot of the card: it is what everything below it
          is to be read with. */}
      {dirty ? <p className="text-xs text-admin-muted">{readOffTheSaved(record)}</p> : null}
      {children}
    </Card>
  );
}

/**
 * The Edit a saved row carries, and the Save and Cancel it opens into.
 *
 * Shared by `EntryCard` and the variants table, so a row that is not a card is still opened,
 * saved and cancelled by the same three controls under the same three names. Each is named
 * after the row it acts on the way `RemoveButton` already is: the visible word stays short
 * and the accessible name says which entry, because a card holding six rows otherwise offers
 * six buttons called "Edit".
 */
export function EntryEditButtons({
  label,
  open,
  blockedBy,
  onOpen,
  onSave,
  onCancel,
  saveRefusal,
  submit = false,
}: {
  label: string;
  open: boolean;
  blockedBy?: string;
  onOpen: () => void;
  onSave: () => void;
  onCancel: () => void;
  /**
   * Why Save is refused, and the id of the line in the row that says so. Present, Save is
   * refused through `PrimaryAction`: the dashed weight, `aria-disabled` and reachable, the
   * reason in `title` and in the line it names (ADR 0063).
   */
  saveRefusal?: { id: string; reason: string };
  /** True where the fields sit in a `<form>`, so Enter in a field saves the row. */
  submit?: boolean;
}) {
  if (!open) {
    return (
      <button
        className={subtleButtonClasses}
        type="button"
        aria-label={`Edit ${label}`}
        aria-describedby={blockedBy}
        disabled={Boolean(blockedBy)}
        onClick={onOpen}
      >
        <ButtonIcon verb="edit" />
        Edit
      </button>
    );
  }
  return (
    <>
      <PrimaryAction
        variant="accent"
        type={submit ? "submit" : "button"}
        aria-label={`Save ${label}`}
        refusal={saveRefusal ?? null}
        onClick={submit ? undefined : onSave}
      >
        <ButtonIcon verb="save" />
        Save
      </PrimaryAction>
      <button
        className={subtleButtonClasses}
        type="button"
        aria-label={`Cancel editing ${label}`}
        onClick={onCancel}
      >
        Cancel
      </button>
    </>
  );
}

/**
 * The line a list shows while one of its rows is open, and the reason its other Edit buttons
 * are disabled.
 *
 * It says the two things an operator cannot see: that the open row is the list's one open
 * edit, and that nothing reaches the draft until Save is pressed — so the page's own "Save
 * draft" does not carry what is being typed here.
 */
export function EntryEditNotice({ id, label }: { id: string; label: string | null }) {
  return (
    // Present whether or not a row is open, so the line is a live region an assistive
    // technology is already watching when one opens. `role="status"` carries the polite
    // announcement; a second `aria-live` here would only ask for it twice.
    <p id={id} className={label ? "text-xs text-admin-muted" : "sr-only"} role="status">
      {label
        ? `Editing ${label}. Save or Cancel before opening another row; nothing in the open row reaches the draft until you press Save.`
        : null}
    </p>
  );
}

/**
 * One saved entry in an editor's list. A row that carries only a title and a Remove button
 * cannot be read back — the configuration becomes write-only — so the identifying line and
 * the stored fields live in the same component, and every list that has fields to show uses
 * it rather than inventing its own row.
 *
 * With `edit` it also opens: the header line stays exactly where it was, identifier and all,
 * and the read-only body is replaced by the fields in a form whose Save writes the same
 * payload the add form below the list would have written.
 */
export function EntryCard({
  lead,
  title,
  titleLevel = 3,
  chips,
  actions,
  edit,
  children,
}: {
  /** A control that selects the entry, such as the default-tone radio. */
  lead?: ReactNode;
  title: ReactNode;
  /**
   * The row's place in the document outline. `3` is where every list of these sits — under a
   * `Card`, whose own title is an `h2` — and is the default, so no existing caller says it.
   * A list one level deeper passes `4` rather than flattening: a row that announces itself as
   * a sibling of the card holding it tells a reader the wrong thing about what contains what.
   */
  titleLevel?: 3 | 4;
  chips?: ReactNode;
  actions?: ReactNode;
  edit?: EntryEdit;
  children?: ReactNode;
}) {
  const Title = titleLevel === 4 ? "h4" : "h3";
  const open = edit?.open ?? false;
  return (
    // A grid item defaults to min-width:auto, so an unbreakable token in the body would
    // widen the row past the card — which clips, taking every sibling's actions with it.
    // The row may shrink, and its text breaks anywhere rather than only at whitespace.
    <li className="grid min-w-0 gap-2 rounded-lg border border-admin-border bg-admin-canvas/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {lead}
        <Title className="min-w-0 [overflow-wrap:anywhere] text-[13px] font-semibold">
          {title}
        </Title>
        {chips}
        {/* While the row is open its Remove is gone: removing the entry being corrected is
            not one of the two answers the open row is asking for. */}
        {edit && !open ? (
          <div className="ml-auto flex items-center gap-1.5">
            <EntryEditButtons {...edit} />
            {actions}
          </div>
        ) : actions && !open ? (
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
      {open && edit ? (
        <form
          // Named, because the open row asks the same questions the add form below the list
          // asks, in the same words. Without a name on the group, "Title" means two controls
          // on the card and neither a reader nor a test can say which one they have reached.
          aria-label={`Edit ${edit.label}`}
          className="grid min-w-0 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            // Save refuses the press itself; a submission that arrives another way does too.
            if (edit.saveRefusal) {
              return;
            }
            edit.onSave();
          }}
        >
          {edit.fields}
          <div className="flex items-center gap-1.5">
            <EntryEditButtons {...edit} submit />
          </div>
        </form>
      ) : (
        children
      )}
    </li>
  );
}

/** What an entry is classified as: a policy's kind, a payment rail, an attribute's type. */
export function EntryKind({ value }: { value: string }) {
  return (
    <span className="rounded bg-admin-canvas px-1.5 py-0.5 text-[11px] text-admin-muted">
      {value}
    </span>
  );
}

/**
 * The guideline a shop resolves `{{shop.tone_of_voice}}` to. Like every state chip in the
 * workspace it pairs its colour with a written label, and the glyph is decorative.
 */
export function DefaultToneChip() {
  return (
    <span className="rounded-full bg-admin-published px-2 py-0.5 text-[11px] font-semibold text-admin-published-ink">
      <span aria-hidden>●</span> shop default
    </span>
  );
}

/** The identifier a scenario binding or a tool read names, shown where the entry is read. */
export function EntryId({ value }: { value: string }) {
  return (
    <code className="rounded bg-admin-border/60 px-1.5 py-0.5 font-mono text-[11px] text-admin-ink-soft">
      {value}
    </code>
  );
}

/**
 * Stored prose, shown whole and with its authored line breaks intact. The shell has one
 * treatment for long text — the resolved-prompt panel — and this is it, so a policy body
 * reads the same wherever it is inspected rather than being clamped on one page and
 * folded away on another.
 */
export function EntryText({ label, value }: { label: string; value: string }) {
  return (
    // A description list ties the field name to the text it names; a bare caption above a
    // paragraph reads as a label but is not one.
    <dl className="grid min-w-0 gap-1">
      <dt className="text-xs font-semibold text-admin-muted">{label}</dt>
      <dd className="min-w-0 rounded-lg border border-admin-border bg-admin-surface p-3 text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-admin-ink-soft">
        {value}
      </dd>
    </dl>
  );
}

/** One gate finding, in the gate's own words and with the path that located it. */
function Finding({ issue }: { issue: DefinitionIssueSchema }) {
  return (
    <li className="flex items-start gap-2 text-[13px] leading-relaxed">
      <span
        className={
          issue.severity === "error"
            ? "font-semibold text-lab-error"
            : "font-semibold text-admin-draft-ink"
        }
      >
        {issue.severity === "error" ? "Error" : "Warning"}
      </span>
      <span className="text-admin-ink-soft">
        {issue.message}
        <code className="ml-1.5 rounded bg-admin-canvas px-1 py-0.5 font-mono text-[11px] text-admin-muted">
          {issue.path}
        </code>
      </span>
    </li>
  );
}

/** How many of each severity a group holds, said in words beside the entry's name. */
function groupTally(group: IssueGroup): string {
  const parts: string[] = [];
  if (group.errors > 0) {
    parts.push(`${group.errors} error${group.errors === 1 ? "" : "s"}`);
  }
  if (group.warnings > 0) {
    parts.push(`${group.warnings} warning${group.warnings === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

/**
 * The publish gate's findings, and — where the caller can say where each one is fixed — the
 * entry that is wrong with one *Open* beside it (`form-decisions.md` 11.2).
 *
 * One list serves every surface that renders findings: the shop's overview, which groups and
 * links, and every editor's Publish gate card, which does not, because there the entry that is
 * wrong is a row of the page the reader is already standing on. The difference between the two
 * is whether the caller hands over an `entryOf`, so a finding is never rendered two ways and a
 * gate sentence is never restated.
 */
export function IssueList({
  issues,
  entryOf,
}: {
  issues: DefinitionIssueSchema[];
  /** Turns a finding's path into the entry it is about (`lib/issueRoutes.ts`). */
  entryOf?: (path: string) => IssueEntry | null;
}) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-lab-success">
        <span aria-hidden>✓</span> No validation findings.
      </p>
    );
  }
  if (entryOf === undefined) {
    return (
      <ul className="grid gap-2">
        {issues.map((issue) => (
          // One path can raise the same code twice (a variant missing two option values),
          // so the message is part of the identity.
          <Finding key={`${issue.code}:${issue.path}:${issue.message}`} issue={issue} />
        ))}
      </ul>
    );
  }
  const groups = groupFindings(issues, entryOf);
  return (
    <ul className="grid gap-2.5">
      {groups.map((group) =>
        group.entry === null ? (
          // A path the map does not recognise keeps its findings — every one of them, since a
          // product deleted or renamed on screen leaves all its findings at one unknown path —
          // and loses only its Open.
          group.issues.map((issue) => (
            <Finding key={`${issue.code}:${issue.path}:${issue.message}`} issue={issue} />
          ))
        ) : (
          <li key={group.key} className="overflow-hidden rounded-[9px] border border-admin-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-admin-border/60 bg-admin-canvas px-3 py-2">
              <span className="text-[12.5px] font-bold">{group.entry.label}</span>
              <span
                className={`text-[11px] font-bold ${
                  group.errors > 0 ? "text-lab-error" : "text-admin-draft-ink"
                }`}
              >
                {groupTally(group)}
              </span>
              <Link
                className={`ml-auto ${subtleButtonClasses}`}
                to={group.entry.to}
                aria-label={`Open ${group.entry.label}`}
              >
                <ButtonIcon verb="open" />
                Open
              </Link>
            </div>
            <ul className="grid gap-1.5 px-3 py-2">
              {group.issues.map((issue) => (
                <Finding key={`${issue.code}:${issue.path}:${issue.message}`} issue={issue} />
              ))}
            </ul>
          </li>
        ),
      )}
    </ul>
  );
}

export function Fingerprint({ value }: { value: string }) {
  return (
    <code
      title={value}
      className="rounded bg-lab-fingerprint px-1.5 py-0.5 font-mono text-[11px] text-lab-ink"
    >
      {value.slice(0, 12)}…
    </code>
  );
}

/** The publish-gate half of any definition preview. */
export interface PublishGate extends VersionProvenance {
  publishable: boolean;
  issues: DefinitionIssueSchema[];
}

/** What the gate says while it has not answered for the draft the server holds. */
const CHECKING_THE_DRAFT = "Checking the draft…";

/**
 * Why the publish button is refused, in the order an author can act on.
 *
 * `id` is what the button's `aria-describedby` names (`PublishButton`'s `reasonsId`), so every
 * line here is read to a keyboard reader who lands on a refused Publish.
 *
 * While the gate is `checking` it says so and nothing else: the reasons it last gave were
 * about a draft the server no longer holds, and a Publish drawn as a press in flight beside
 * no words at all reads as a button that is broken rather than one that is waiting (ADR 0065).
 */
export function PublishReasons({
  id,
  className = "grid gap-1",
  preview,
  dirty,
  checking,
}: {
  id: string;
  className?: string;
  preview: PublishGate | null;
  dirty: boolean;
  /** The gate has not answered for the saved draft yet (`DefinitionEditor.checking`). */
  checking: boolean;
}) {
  const errors = preview?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = preview?.issues.filter((issue) => issue.severity === "warning") ?? [];
  if (checking && !dirty) {
    return (
      <div id={id} className={className}>
        <p className="text-xs text-admin-muted">{CHECKING_THE_DRAFT}</p>
      </div>
    );
  }
  const unchanged = !dirty && preview?.matches_latest_published === true;
  if (!dirty && (preview === null || preview.publishable) && !unchanged && warnings.length === 0) {
    // Nothing to say, so nothing drawn: an empty block would still take a row of the header it
    // stands in, and its gap with it.
    return null;
  }
  return (
    <div id={id} className={className}>
      {/* The three reasons Publish is refused for, at the validation weight every refusal reads
          at (ADR 0063) — "identical to vN" among them, since it refuses the press as surely as
          an error does. The warnings line refuses nothing and stays muted. */}
      {dirty ? <p className={validationMessageClasses}>{PUBLISH_UNSAVED_REASON}</p> : null}
      {preview && !preview.publishable ? (
        <p className={validationMessageClasses}>{publishErrorsReason(errors.length)}</p>
      ) : null}
      {/* Not while the draft is dirty: "identical" would describe the saved draft, and the
          operator is looking at edits that are not in it. */}
      {unchanged && preview ? (
        <p className={validationMessageClasses}>
          {publishUnchangedReason(preview.latest_published_version)}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <p className="text-xs text-admin-muted">
          {warnings.length} warning(s) do not block publication.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Publish, refused with its reason while the gate or the draft says no (ADR 0063).
 *
 * One button for every definition editor and the overview, so the refusal, its `title`, and the
 * `PublishReasons` block it is described by cannot drift apart between them. Publishing — and a
 * gate that has not answered — is a press in flight; while the gate is checking, the button is
 * described by the reasons block, which then says "Checking the draft…".
 */
export function PublishButton({
  preview,
  dirty,
  publishing,
  checking,
  reasonsId,
  onPublish,
  variant = "accent",
  className,
  ref,
  children,
}: {
  preview: PublishGate | null;
  dirty: boolean;
  publishing: boolean;
  /** The gate has not answered for the saved draft yet (`DefinitionEditor.checking`). */
  checking: boolean;
  /** The `id` given to this page's `PublishReasons`. */
  reasonsId: string;
  onPublish: () => void;
  variant?: "accent" | "ink";
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  /** The label, where it is not `Publish vN`. */
  children?: ReactNode;
}) {
  const reason = publishRefusalReason(preview, dirty);
  const waiting = !publishing && !dirty && (checking || preview === null);
  return (
    <PrimaryAction
      ref={ref}
      variant={variant}
      type="button"
      className={className}
      refusal={reason === null ? null : { id: reasonsId, reason }}
      busy={publishing || waiting}
      aria-describedby={waiting ? reasonsId : undefined}
      onClick={onPublish}
    >
      {children ?? (
        <>
          <ButtonIcon verb="publish" />
          {publishing ? "Publishing…" : `Publish v${preview?.next_version ?? 1}`}
        </>
      )}
    </PrimaryAction>
  );
}

/**
 * The glyph each status axis is drawn with.
 *
 * The mark says *which* status this is, not which value it holds — two pills side by side in
 * one table cell are told apart by their shape before they are read. It is decorative on
 * purpose: the label beside it carries the meaning, so nothing here is the only carrier of
 * anything, and a reader who sees no colour and no glyph still reads the status.
 */
const PILL_GLYPHS = {
  payment: "◆",
  fulfilment: "▣",
  product: "◧",
  availability: "▤",
} as const;

export type StatusTone = keyof typeof PILL_GLYPHS;

/**
 * One status axis. Status is never carried by colour alone: the pill pairs a glyph with the
 * written label, and the label is a contract enum's own name from `lib/enumLabels.ts`.
 */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border/60 px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft">
      <span aria-hidden>{PILL_GLYPHS[tone]}</span> {label}
    </span>
  );
}
