import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import type { ReactNode } from "react";
import type { EntryEdit } from "../lib/entryEdit";
import {
  accentButtonClasses,
  cardTitleClasses,
  outlineButtonClasses,
  subtleButtonClasses,
  surfaceClasses,
} from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";

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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft">
          <span aria-hidden>◦</span> Never published
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-published px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-published-ink">
          <span aria-hidden>●</span> v{preview.latest_published_version} published
        </span>
      )}
      {preview.matches_latest_published ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft">
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
 * down in `docs/implementation-plan.md` UI-5 so the variant can be added rather than the census
 * rediscovered — and what to watch when it is added is a long product or customer name wrapping
 * at 24px Georgia where 22px would have held it on one line.
 *
 * The 5px between the title and its description is the prototype's own
 * (`Workspace.dc.html`:154, 816), and it is the whole of this header's density change.
 */
export function PageHeader({
  title,
  chips,
  actions,
  description,
}: {
  title: string;
  chips?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <header className="mb-4 grid gap-[5px]">
      <div className="flex flex-wrap items-center gap-3">
        {/* The chain step of a tour lights the page's own name: it is the one element
            every surface has, and it is what the step is about — where you have arrived. */}
        <h1 className="font-display text-2xl font-bold tracking-[-0.015em]" data-tour="page-name">
          {title}
        </h1>
        {chips}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="text-[13px] text-admin-muted">{description}</p> : null}
    </header>
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
}: {
  saveLabel?: string;
  dirty: boolean;
  saving: boolean;
  discarding: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Accent where Save is the page's primary action, outline where Publish is. */
  tone?: "accent" | "outline";
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
          <button
            className={tone === "accent" ? accentButtonClasses : outlineButtonClasses}
            type="button"
            onClick={onSave}
            disabled={saving || discarding}
          >
            <ButtonIcon verb="save" />
            {saving ? "Saving…" : saveLabel}
          </button>
        </>
      ) : null}
    </>
  );
}

export function Card({
  title,
  label,
  children,
  footer,
}: {
  title?: ReactNode;
  /** Accessible name when the visible title is not a plain string. */
  label?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const accessibleName = label ?? (typeof title === "string" ? title : undefined);
  return (
    <section aria-label={accessibleName} className={`${surfaceClasses} overflow-hidden`}>
      {title ? (
        <h2 className={`border-b border-admin-border px-4 py-3 ${cardTitleClasses}`}>{title}</h2>
      ) : null}
      <div className="grid gap-3 p-4">{children}</div>
      {footer ? <div className="border-t border-admin-border px-4 py-3">{footer}</div> : null}
    </section>
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
  saveable = true,
  submit = false,
}: {
  label: string;
  open: boolean;
  blockedBy?: string;
  onOpen: () => void;
  onSave: () => void;
  onCancel: () => void;
  saveable?: boolean;
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
      <button
        className={accentButtonClasses}
        type={submit ? "submit" : "button"}
        aria-label={`Save ${label}`}
        disabled={!saveable}
        onClick={submit ? undefined : onSave}
      >
        <ButtonIcon verb="save" />
        Save
      </button>
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
  chips,
  actions,
  edit,
  children,
}: {
  /** A control that selects the entry, such as the default-tone radio. */
  lead?: ReactNode;
  title: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  edit?: EntryEdit;
  children?: ReactNode;
}) {
  const open = edit?.open ?? false;
  return (
    // A grid item defaults to min-width:auto, so an unbreakable token in the body would
    // widen the row past the card — which clips, taking every sibling's actions with it.
    // The row may shrink, and its text breaks anywhere rather than only at whitespace.
    <li className="grid min-w-0 gap-2 rounded-lg border border-admin-border bg-admin-canvas/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {lead}
        <h3 className="min-w-0 [overflow-wrap:anywhere] text-[13px] font-semibold">{title}</h3>
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

export function IssueList({ issues }: { issues: DefinitionIssueSchema[] }) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-lab-success">
        <span aria-hidden>✓</span> No validation findings.
      </p>
    );
  }
  return (
    <ul className="grid gap-2">
      {issues.map((issue) => (
        // One path can raise the same code twice (a variant missing two option values),
        // so the message is part of the identity.
        <li
          key={`${issue.code}:${issue.path}:${issue.message}`}
          className="flex items-start gap-2 text-[13px] leading-relaxed"
        >
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
      ))}
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

/**
 * One definition of "may this draft be frozen", shared by every editor so the button and
 * the explanation below it can never disagree — and so a new resource cannot quietly ship
 * a weaker gate than the shop's.
 */
export function canPublish(preview: PublishGate | null, dirty: boolean): boolean {
  return preview !== null && preview.publishable && !dirty && !preview.matches_latest_published;
}

/** Why the publish button is disabled, in the order an author can act on. */
export function PublishReasons({
  preview,
  dirty,
}: {
  preview: PublishGate | null;
  dirty: boolean;
}) {
  const errors = preview?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = preview?.issues.filter((issue) => issue.severity === "warning") ?? [];
  return (
    <>
      {dirty ? (
        <p className="text-xs text-lab-error">
          Save the draft first — publishing freezes the saved draft, not unsaved edits.
        </p>
      ) : null}
      {preview && !preview.publishable ? (
        <p className="text-xs text-lab-error">Resolve {errors.length} error(s) to publish.</p>
      ) : null}
      {preview?.matches_latest_published ? (
        <p className="text-xs text-admin-muted">
          The draft is identical to v{preview.latest_published_version}; there is nothing new to
          freeze.
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <p className="text-xs text-admin-muted">
          {warnings.length} warning(s) do not block publication.
        </p>
      ) : null}
    </>
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
