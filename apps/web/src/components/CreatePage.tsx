import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { accentButtonClasses, blockedButtonClasses, focusRingClasses } from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";

/**
 * Creating is a page, and this is the page (PLAN-UX Slice 12).
 *
 * `form-decisions.md` chose layout **2b** for it: the two-column field pattern wants 760–790px,
 * which the 380px side card the workspace used to create from cannot give it. So a create is a
 * focused page with a sticky header — back arrow, breadcrumb, the typed name as the title, a
 * "nothing created yet" chip, Cancel and Create — over a 790px body
 * (`Workspace.dc.html`:212, :1202, :1333, :1643).
 *
 * Four things about it are load-bearing rather than decorative:
 *
 * - **The title is what is being typed.** It reads back the name the operator is entering, so a
 *   page they arrived at empty becomes the thing they are making while they make it. `untitled`
 *   is what stands in until there is one; the chip beside it says the page has written nothing.
 * - **Create says why it will not go.** `blockedBy` is one sentence: it disables the button,
 *   dresses it in the dashed weight, puts the sentence in `title`, and prints it *inline* next
 *   to the control in the button's own accessible description — because `title=` is never the
 *   only carrier (`docs/design-direction.md`, *The form language*).
 * - **A refused create keeps the operator here.** `error` renders in the same place under the
 *   button, as an alert; the page does not navigate and nothing it holds is lost.
 * - **Leaving asks nothing.** A half-typed create form is not an edit to something that exists,
 *   so it registers no unsaved work and Cancel is a plain link back to the index (ADR 0051,
 *   *Deliberately not here*). Nothing here calls `useRegisterUnsavedWork`, deliberately.
 *
 * The header is sticky on its own rather than through `PageHeader`, which PLAN-UX Slice 25
 * makes sticky for the editors. The title is drawn at `PageHeader`'s 24px rather than the
 * prototype's 22px for a bound name: the workspace has one page-title size and the departure
 * that flattened the prototype's two is already recorded in `docs/design-direction.md`.
 *
 * The form is not owned here. A consumer renders its own `<form id>` in `children` and names it
 * through `formId`, so the submit button in the sticky header drives it and Enter in any field
 * does the same thing the button does.
 */
export function CreatePage({
  backTo,
  backLabel,
  breadcrumb,
  title,
  untitled,
  standing,
  formId,
  createLabel,
  creating,
  creatingLabel,
  blockedBy,
  error,
  children,
}: {
  /** Where the back arrow, the breadcrumb link and Cancel all go: the index this creates into. */
  backTo: string;
  /** That index's name, as the rail and its own heading say it. */
  backLabel: string;
  /** What is being made, in the prototype's words: "creating an order fixture". */
  breadcrumb: string;
  /** The name as typed. Empty until there is one. */
  title: string;
  /** What the heading reads while `title` is empty. */
  untitled: string;
  /**
   * What the chip beside the title says, where the page has already written something.
   *
   * "nothing created yet" is the prototype's and is true of a create page that has not been
   * pressed. It stops being true where a create takes more than one write and the first has
   * landed — the order page, whose `POST` makes the order before the `PUT` puts its line on
   * it — and a chip that kept saying it there would be the page contradicting itself
   * (*Principles*: every state is designed for).
   */
  standing?: string;
  /** The `id` of the consumer's own `<form>`, which the header's Create submits. */
  formId: string;
  createLabel: string;
  creating: boolean;
  creatingLabel: string;
  /** Why Create cannot be pressed, in one sentence. Absent when it can. */
  blockedBy?: string;
  /** Why the last attempt was refused. */
  error?: string | null;
  children: ReactNode;
}) {
  const blocked = blockedBy !== undefined;
  const reasonId = "create-page-reason";
  const errorId = "create-page-error";

  return (
    <>
      {/* Pulled out to the scrolling pane's own edges, so the rule under it spans the width the
          prototype draws it at rather than stopping inside the page's gutter. */}
      <header className="sticky top-0 z-10 -mx-6 -mt-5 mb-4 flex flex-wrap items-center gap-3.5 border-b border-admin-border bg-admin-canvas px-6 py-4">
        <Link
          to={backTo}
          aria-label={`Back to ${backLabel}`}
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-[9px] border border-admin-field-border bg-admin-surface text-[15px] text-admin-ink-soft hover:bg-[#f1f2f3] ${focusRingClasses}`}
        >
          <span aria-hidden>←</span>
        </Link>
        <div className="min-w-0">
          <p className="text-xs text-admin-muted">
            <Link to={backTo} className={`underline-offset-2 hover:underline ${focusRingClasses}`}>
              {backLabel}
            </Link>{" "}
            · {breadcrumb}
          </p>
          <div className="mt-[3px] flex flex-wrap items-center gap-2.5">
            <h1
              className="font-display text-2xl font-bold tracking-[-0.015em]"
              data-tour="page-name"
            >
              {title === "" ? untitled : title}
            </h1>
            <span className="rounded-full bg-[#f0f2f4] px-2.5 py-0.5 text-[11px] font-bold text-[#59636d]">
              {standing ?? "nothing created yet"}
            </span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
          <Link
            to={backTo}
            className={`inline-flex min-h-10 items-center justify-center rounded-lg border border-admin-border bg-transparent px-4 text-sm font-semibold text-admin-ink no-underline transition hover:bg-admin-canvas ${focusRingClasses}`}
          >
            Cancel
          </Link>
          <button
            className={blocked ? blockedButtonClasses : accentButtonClasses}
            type="submit"
            form={formId}
            disabled={blocked || creating}
            title={blockedBy}
            aria-describedby={blocked ? reasonId : error ? errorId : undefined}
          >
            <ButtonIcon verb="save" />
            {creating ? creatingLabel : createLabel}
          </button>
        </div>
        {/* Under the button, spanning the row, so a reason and a refusal are read in the place
            the press was refused rather than hunted for down the form. */}
        {blocked ? (
          <p id={reasonId} className="w-full text-right text-[13px] font-semibold text-lab-error">
            {blockedBy}
          </p>
        ) : null}
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="w-full text-right text-[13px] font-semibold text-lab-error"
          >
            {error}
          </p>
        ) : null}
      </header>

      {/* 790px, the measure `form-decisions.md` 1.5 asks for and the prototype's own column. */}
      <div className="grid max-w-[790px] gap-4">{children}</div>
    </>
  );
}
