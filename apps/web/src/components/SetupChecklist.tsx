import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import { useMemo } from "react";
import { shopIssueEntries } from "../lib/issueRoutes";
import type { ShopDraft } from "../lib/productKeys";
import { type ChecklistLine, setupChecklist } from "../lib/setupChecklist";
import { GateCard, IssueList } from "./WorkspaceChrome";

/**
 * The setup pages' side panel (`Workspace.dc.html` :2154): what a publishable shop has, each
 * line a ✓ or a !, its label, and a note — where the pages used to list the gate's findings
 * flat under "Draft validation".
 *
 * A line still to do carries the gate's findings for it in `IssueList`'s own words, severity
 * and path included, so nothing the flat list said is lost; the last line carries every
 * finding no other line owns, grouped by the product it is about with an *Open* to its editor,
 * as the shop's overview groups them.
 *
 * It reads the gate, and the gate answers for the saved draft. While the draft on screen has
 * unsaved edits the panel says so under its title, because a ✓ beside a count the operator has just emptied
 * is the gate's answer about the last save, not a contradiction. That frame — the title, `busy`
 * while checking, the saved-draft line — is `GateCard`'s, which every editor's panel opens with.
 */
export function SetupChecklist({
  shopId,
  content,
  issues,
  checking,
  dirty,
}: {
  shopId: string;
  content: ShopDraft;
  /**
   * The gate's findings on the saved draft. The workspace draws no page before the gate has
   * answered once, so there is always an answer here, if a stale one while `checking`.
   */
  issues: readonly DefinitionIssueSchema[];
  /** The gate has not answered for the saved draft yet (`DefinitionEditor.checking`). */
  checking: boolean;
  dirty: boolean;
}) {
  const entryOf = useMemo(
    () => shopIssueEntries(shopId, content.products),
    [shopId, content.products],
  );
  const checklist = setupChecklist(content, issues);
  return (
    // The gate card every editor's panel opens with, titled as the prototype titles this one
    // (:2156) and as the tour lights it (`lib/tours.ts`).
    <GateCard title="Setup checklist" busy={checking} dirty={dirty}>
      <ul
        className={`-mx-4 -mb-4 divide-y divide-[#f1f2f3] ${dirty ? "border-t border-[#f1f2f3]" : "-mt-4"}`}
      >
        {checklist.lines.map((line) => (
          <ChecklistItem key={line.label} line={line} />
        ))}
        <ChecklistItem line={checklist.rest} entryOf={entryOf} />
      </ul>
    </GateCard>
  );
}

function ChecklistItem({
  line,
  entryOf,
}: {
  line: ChecklistLine;
  entryOf?: Parameters<typeof IssueList>[0]["entryOf"];
}) {
  return (
    <li className="flex gap-2.5 px-4 py-[11px] text-[12.5px] leading-normal">
      {/* The prototype's two glyphs in its two inks; the word is for a reader, since a glyph
          is never the only carrier of what a line means. */}
      <span
        aria-hidden="true"
        className={`flex-none font-extrabold ${line.done ? "text-[#276245]" : "text-[#9b6a1a]"}`}
      >
        {line.done ? "✓" : "!"}
      </span>
      {/* A finding's path is one unbroken identifier, wider than the 312px panel can hold. */}
      <div className="grid min-w-0 flex-1 gap-1 [&_code]:break-all">
        <p className="font-[650] text-admin-ink">
          {line.label}
          <span className="sr-only">{line.done ? " — done" : " — to do"}</span>
        </p>
        {line.note ? <p className="text-admin-muted">{line.note}</p> : null}
        {line.findings.length > 0 ? <IssueList issues={line.findings} entryOf={entryOf} /> : null}
      </div>
    </li>
  );
}
