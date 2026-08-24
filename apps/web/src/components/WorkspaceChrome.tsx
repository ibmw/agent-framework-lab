import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import type { ReactNode } from "react";
import { surfaceClasses } from "../lib/ui";

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
    <header className="mb-4 grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {chips}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="text-[13px] text-admin-muted">{description}</p> : null}
    </header>
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
        <h2 className="border-b border-admin-border px-4 py-3 text-sm font-semibold">{title}</h2>
      ) : null}
      <div className="grid gap-3 p-4">{children}</div>
      {footer ? <div className="border-t border-admin-border px-4 py-3">{footer}</div> : null}
    </section>
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
