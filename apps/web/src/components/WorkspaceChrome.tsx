import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import {
  PUBLISH_UNSAVED_REASON,
  publishErrorsReason,
  publishRefusalReason,
  publishUnchangedReason,
} from "../lib/definitionEditor";
import type { EntryEdit } from "../lib/entryEdit";
import { groupFindings, type IssueEntry, type IssueGroup } from "../lib/issueRoutes";
import {
  accentButtonClasses,
  cardTitleClasses,
  outlineButtonClasses,
  subtleButtonClasses,
  surfaceClasses,
  validationMessageClasses,
} from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";
import { PrimaryAction } from "./PrimaryAction";

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
 * down in `docs/history/workspace-refresh-pattern-slices.md` UI-5 so the variant can be added rather than the census
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
          // A path the map does not recognise keeps its finding and loses only its Open.
          <Finding key={group.key} issue={group.issues[0]} />
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

/**
 * Why the publish button is refused, in the order an author can act on.
 *
 * `id` is what the button's `aria-describedby` names (`PublishButton`'s `reasonsId`), so every
 * line here is read to a keyboard reader who lands on a refused Publish.
 */
export function PublishReasons({
  id,
  className = "grid gap-1",
  preview,
  dirty,
}: {
  id: string;
  className?: string;
  preview: PublishGate | null;
  dirty: boolean;
}) {
  const errors = preview?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = preview?.issues.filter((issue) => issue.severity === "warning") ?? [];
  return (
    <div id={id} className={className}>
      {/* The three reasons Publish is refused for, at the validation weight every refusal reads
          at (ADR 0063) — "identical to vN" among them, since it refuses the press as surely as
          an error does. The warnings line refuses nothing and stays muted. */}
      {dirty ? <p className={validationMessageClasses}>{PUBLISH_UNSAVED_REASON}</p> : null}
      {preview && !preview.publishable ? (
        <p className={validationMessageClasses}>{publishErrorsReason(errors.length)}</p>
      ) : null}
      {preview?.matches_latest_published ? (
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
 * gate that has not answered — is a press in flight.
 */
export function PublishButton({
  preview,
  dirty,
  publishing,
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
  return (
    <PrimaryAction
      ref={ref}
      variant={variant}
      type="button"
      className={className}
      refusal={reason === null ? null : { id: reasonsId, reason }}
      busy={publishing || preview === null}
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
