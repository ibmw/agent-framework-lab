import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { clearStickyHeader, stickyHeaderClasses } from "../lib/stickyHeader";
import { neutralPillClasses, outlineButtonClasses, validationMessageClasses } from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";
import { PrimaryAction, RefusalLine } from "./PrimaryAction";
import { HeaderBack, HeaderReport } from "./WorkspaceChrome";

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
 * - **Create says why it will not go.** `blockedBy` is one sentence: it refuses the button
 *   through `PrimaryAction` — the dashed weight, `aria-disabled` so a keyboard reader still lands
 *   on it, the sentence in `title` — and prints it *inline* under the control, in the button's
 *   own accessible description, because `title=` is never the only carrier (ADR 0063).
 * - **A refused create keeps the operator here.** `error` renders in the same place under the
 *   button, as an alert; the page does not navigate and nothing it holds is lost.
 * - **Leaving asks nothing.** A half-typed create form is not an edit to something that exists,
 *   so it registers no unsaved work and Cancel is a plain link back to the index (ADR 0051,
 *   *Deliberately not here*). Nothing here calls `useRegisterUnsavedWork`, deliberately.
 *
 * The header is sticky through the same classes and the same focus clearance an editor's
 * `PageHeader` is (`lib/stickyHeader.ts`), and its way back is the editor's own piece,
 * `HeaderBack` — the ←, named "Back to {index}", and the "Index · kind" line — so a create page
 * and the editor it lands in are left the same way. It is not a `PageHeader`: its title reads
 * back what is being typed and its Create carries a refusal line of its own. The chip is the
 * neutral pill `VersionChips` draws its grey states with (`neutralPillClasses`), and Cancel is a
 * row of the button table. The title is drawn at `PageHeader`'s 24px rather than the
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
      <header
        ref={clearStickyHeader}
        className={`${stickyHeaderClasses} mb-4 flex flex-wrap items-center gap-3.5`}
      >
        <HeaderBack to={backTo} label={backLabel} kind={breadcrumb}>
          <h1 className="font-display text-2xl font-bold tracking-[-0.015em]" data-tour="page-name">
            {title === "" ? untitled : title}
          </h1>
          <span className={neutralPillClasses}>{standing ?? "nothing created yet"}</span>
        </HeaderBack>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
          <Link to={backTo} className={`${outlineButtonClasses} no-underline`}>
            Cancel
          </Link>
          <PrimaryAction
            variant="accent"
            type="submit"
            form={formId}
            refusal={blocked ? { id: reasonId, reason: blockedBy } : null}
            busy={creating}
            aria-describedby={!blocked && error ? errorId : undefined}
          >
            <ButtonIcon verb="save" />
            {creating ? creatingLabel : createLabel}
          </PrimaryAction>
        </div>
        {/* Under the button, spanning the row, so a reason and a refusal are read in the place
            the press was refused rather than hunted for down the form. A report row, as an
            editor's is: the header holds or not without it (ADR 0066). */}
        <HeaderReport className="w-full">
          {blocked ? (
            <RefusalLine id={reasonId} className="w-full text-right">
              {blockedBy}
            </RefusalLine>
          ) : null}
          {error ? (
            <p
              id={errorId}
              role="alert"
              className={`w-full text-right ${validationMessageClasses}`}
            >
              {error}
            </p>
          ) : null}
        </HeaderReport>
      </header>

      {/* 790px, the measure `form-decisions.md` 1.5 asks for and the prototype's own column. */}
      <div className="grid max-w-[790px] gap-4">{children}</div>
    </>
  );
}
