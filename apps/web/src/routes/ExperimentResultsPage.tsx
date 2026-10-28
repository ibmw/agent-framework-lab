import type {
  ArmMetricsSchema,
  ExperimentAnnotationsResponse,
  ExperimentEvaluationResponse,
  ExperimentResponse,
  ExperimentRunSchema,
  ParticipantTurnSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { describeApiError } from "../api/client";
import { addExperimentNote, setExperimentTags } from "../api/experiments";
import { AttributionLine, ConfigurationSection } from "../components/ArmComparison";
import {
  ArmStrip,
  SameForEveryArm,
  SheetRow,
  SheetSection,
  SheetSpanningRow,
} from "../components/ArmSheet";
import { ButtonIcon } from "../components/ButtonIcon";
import { ObjectivesSection } from "../components/ObjectivesSection";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import { RunProvenance } from "../components/RunProvenance";
import { BusinessStateSection } from "../components/StateDiff";
import { Card } from "../components/WorkspaceChrome";
import { armsInOrder } from "../lib/comparison";
import {
  describeArmStanding,
  describeFailure,
  formatCost,
  formatDuration,
  formatTokens,
  turnNumber,
} from "../lib/evidence";
import { NOTE_MAX_LENGTH } from "../lib/fieldRules";
import { pythonStrip } from "../lib/pythonText";
import { useRefusalTouch } from "../lib/refusalTouch";
import { type SheetArm, sheetArmsOf } from "../lib/sheet";
import {
  addFormClasses,
  fieldControlClasses,
  focusRingClasses,
  formatTimestamp,
  sheetCellDetailClasses,
  sheetFigureClasses,
  sheetFigureDiffersClasses,
  sheetSectionChipClasses,
  textAreaClasses,
} from "../lib/ui";
import { useExperimentResults } from "./useExperimentResults";

/**
 * The measures *Usage* reads, in the order it reads them: the arm cards' old figures among them,
 * and "Tokens, in and out" before the two it adds up.
 *
 * A union rather than loose strings, so a row this section names and a value `quantities`
 * produces cannot drift apart into an empty cell nobody notices.
 */
const MEASURES = [
  "Turns",
  "Answered turns",
  "Attempts",
  "Retries",
  "Failures",
  "Tool calls",
  "Writes",
  "Model requests",
  "Tokens, in and out",
  "Input tokens",
  "Output tokens",
  "Time in attempts",
  "Time in tools",
  "Estimated cost",
] as const;

type Measure = (typeof MEASURES)[number];

/**
 * The evidence overview (frame 9, General tab), drawn as one sheet (ADR 0080): the arms are its
 * columns and its sections run Outcome, Objectives, Business state, Configuration, Usage,
 * Provenance, Notes, in one column and one scroll, each reached from a chip.
 *
 * One row per objective, one column per arm, and no number anywhere that stands for an arm
 * as a whole. That is the product direction's rule rather than a layout preference: a single
 * score would decide, on the operator's behalf, how a missed process check weighs against a
 * resolved incident — which is exactly the judgement this lab exists to hand to a person.
 *
 * Everything here is read from projections the backend already serves: the evaluation
 * (ADR 0030) with the judge's verdicts on it (ADR 0031), the metrics (ADR 0032), and the
 * arms' own recorded writes (ADR 0026, ADR 0028). This page counts nothing of its own, so it
 * can never describe a run differently from the bench it was driven on.
 */
export function ExperimentResultsPage() {
  const { shopId, experimentId, experiment, evaluation, annotations, onEvaluated, onAnnotated } =
    useExperimentResults();
  const runs = armsInOrder(experiment);
  const sheetArms = sheetArmsOf(runs);

  // A chip is a link to its section's fragment, followed through the router: a native fragment
  // jump is a POP the router did not create, which react-router warns about under the workspace's
  // blocker (the unsaved-work guard itself ignores a change that keeps the pathname). It is landed
  // here, as the timeline lands on an event: focus moves to the section, so the next Tab starts
  // there, and it is scrolled to its top, which the pane's `scroll-padding-top` keeps clear of the
  // pinned strip. Every navigation is a new `location`, so pressing the same chip twice lands
  // twice.
  const location = useLocation();
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!SECTIONS.some((section) => section.id === id)) {
      return;
    }
    const target = document.getElementById(id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  }, [location]);

  return (
    <>
      <nav aria-label="Sections" className="mb-4 flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <Link key={section.id} to={{ hash: section.id }} className={sheetSectionChipClasses}>
            {section.label}
          </Link>
        ))}
      </nav>

      {/* One column in the sheet's order (ADR 0080). The strip is this column's first child, so
          it holds at the pane's top for as long as the sections are on screen. The cards not
          yet drawn as sheet sections carry their section's id, so their chip already reaches
          them. */}
      <div className="grid min-w-0 gap-6">
        <ArmStrip label="General" arms={sheetArms} />

        <Outcome experiment={experiment} runs={runs} arms={sheetArms} evaluation={evaluation} />

        <ObjectivesSection
          of={{ shopId, experimentId }}
          runs={runs}
          arms={sheetArms}
          evaluation={evaluation}
          onEvaluated={onEvaluated}
        />

        <BusinessStateSection experiment={experiment} runs={runs} arms={sheetArms} />

        {/* Below the evidence it explains: what the arms differed on is what any difference
            above can, or cannot, be attributed to (ADR 0025, ADR 0042). */}
        <ConfigurationSection experiment={experiment} shopId={shopId} arms={sheetArms} />

        <Usage runs={runs} arms={sheetArms} />

        <div
          tabIndex={-1}
          id="provenance"
          data-tour="results-provenance"
          className={`min-w-0 ${focusRingClasses}`}
        >
          <Card
            title="Provenance"
            footer={
              <p className="text-xs text-admin-muted">
                Every arm was cloned from one snapshot, so the arms began at the same fingerprint
                and moved apart only when something wrote.
              </p>
            }
          >
            <RunProvenance experiment={experiment} shopId={shopId} linked />
          </Card>
        </div>

        <div tabIndex={-1} id="notes" className={`min-w-0 ${focusRingClasses}`}>
          <NotesAndTags
            shopId={shopId}
            experimentId={experimentId}
            annotations={annotations}
            onAnnotated={onAnnotated}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The sheet's sections in its order, each the target of a chip (ADR 0080). A card not yet drawn
 * as a section carries its section's id, so every chip reaches what it names.
 */
const SECTIONS = [
  { id: "outcome", label: "Outcome" },
  { id: "objectives", label: "Objectives" },
  { id: "state", label: "Business state" },
  { id: "configuration", label: "Configuration" },
  { id: "usage", label: "Usage" },
  { id: "provenance", label: "Provenance" },
  { id: "notes", label: "Notes" },
] as const;

/**
 * Outcome, first on the sheet: what each arm met and where it stands, then whether the
 * comparison was controlled and what its differences let an operator attribute — above the
 * evidence, so the evidence is read knowing whether it can be compared at all.
 *
 * Its note is the sentence that refuses the aggregate; the summary row's label cell already says
 * the columns are never added into a winner.
 */
function Outcome({
  experiment,
  runs,
  arms,
  evaluation,
}: {
  experiment: ExperimentResponse;
  runs: ExperimentRunSchema[];
  arms: SheetArm[];
  evaluation: ExperimentEvaluationResponse;
}) {
  return (
    <SheetSection
      id="outcome"
      title="Outcome"
      note="There is no aggregate score: each arm's count is of the rows something actually decided for it."
      arms={arms}
      labelHeader="Fact"
    >
      <SheetRow
        label="Decided objectives met"
        cells={runs.map((run) => {
          const arm = evaluation.arms.find((entry) => entry.run_id === run.run_id);
          return (
            <span key={run.run_id} className="text-[14px] font-semibold tabular-nums">
              {arm ? `${arm.met} of ${arm.decided}` : "Nothing decided yet"}
            </span>
          );
        })}
      />
      <SheetRow
        label="Status"
        cells={runs.map((run) => (
          <span key={run.run_id}>{describeArmStanding(run.standing, run.metrics)}</span>
        ))}
      />
      {runs.length > 1 ? <Divergence experiment={experiment} runs={runs} /> : null}
      <SheetSpanningRow label="Attribution">
        <AttributionLine comparison={experiment.comparison} />
      </SheetSpanningRow>
    </SheetSection>
  );
}

/** Why *Add tag* is refused: there is no tag to file the run under yet. */
const TAG_EMPTY = "Type the tag to file this run under.";

/** Why *Add note* is refused: an empty note says nothing about the run. */
const NOTE_EMPTY = "Write the note before adding it.";

/**
 * Frame 9's notes-and-tags card, in the rail: what an operator concluded, beside what the run
 * did.
 *
 * The only thing on this screen that is written rather than read, and the only thing that is
 * not evidence. A note is appended and never edited, because it is what a reviewer thought
 * when they read this run; the tags are replaced as a set, because how a run is filed is a
 * current classification rather than a record of what happened to it (ADR 0036).
 *
 * Both writes answer with everything written on the run, so this component never merges a
 * response into a list of its own — the backend's answer replaces what is on screen.
 */
function NotesAndTags({
  shopId,
  experimentId,
  annotations,
  onAnnotated,
}: {
  shopId: string;
  experimentId: string;
  annotations: ExperimentAnnotationsResponse;
  onAnnotated: (annotations: ExperimentAnnotationsResponse) => void;
}) {
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  const tagReasonId = useId();
  const noteReasonId = useId();
  const tagEmpty = pythonStrip(tag) === "";
  const noteEmpty = pythonStrip(note) === "";
  // Each form's refusal is a hint until the operator types in it or presses its action, and
  // again once an add has emptied it (ADR 0078).
  const tagTouch = useRefusalTouch();
  const noteTouch = useRefusalTouch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One writer for both operations: whichever one ran, the answer is the whole annotation,
  // and a failure leaves what the operator typed in the box rather than swallowing it.
  const write = async (
    change: () => Promise<ExperimentAnnotationsResponse>,
    unavailable: string,
    clear: () => void,
  ) => {
    setBusy(true);
    setError(null);
    try {
      onAnnotated(await change());
      clear();
    } catch (cause: unknown) {
      setError(describeApiError(cause, unavailable));
    } finally {
      setBusy(false);
    }
  };

  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    // The button refuses an empty note itself (ADR 0063), and holds while a write is in flight
    // (ADR 0065); a submission that arrives some other way is refused here too, rather than
    // sent for the lab to refuse or sent twice.
    if (noteEmpty || busy) {
      return;
    }
    void write(
      () => addExperimentNote(shopId, experimentId, { body: pythonStrip(note) }),
      "This note could not be saved.",
      () => {
        setNote("");
        noteTouch.reset();
      },
    );
  };

  // `clear` is the caller's, because only the caller knows whether the box it would empty is
  // the one this write came from: adding consumes what was typed, and removing a chip must
  // leave a half-typed tag beside it alone.
  const file = (tags: string[], clear: () => void) =>
    write(
      () => setExperimentTags(shopId, experimentId, { tags }),
      "These tags could not be saved.",
      clear,
    );

  const submitTag = (event: FormEvent) => {
    event.preventDefault();
    // As the note's: an empty tag and a second write while one is in flight go nowhere.
    if (tagEmpty || busy) {
      return;
    }
    // The whole set every time, because that is what the contract takes: the backend folds
    // what was typed, so a tag already on the run comes back as the one chip it always was.
    void file([...annotations.tags, pythonStrip(tag)], () => {
      setTag("");
      tagTouch.reset();
    });
  };

  return (
    <Card
      title="Notes & tags"
      footer={
        <p className="text-xs text-admin-muted">
          What a reviewer concluded, stored beside the record rather than in it.
        </p>
      }
    >
      {error ? (
        <p role="alert" className="text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {annotations.tags.length === 0 ? (
          <p className="text-[13px] text-admin-muted">Not filed under any tag yet.</p>
        ) : (
          annotations.tags.map((entry) => (
            <span
              key={entry}
              className="inline-flex items-center gap-1.5 rounded-full border border-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink"
            >
              {entry}
              <button
                type="button"
                aria-label={`Remove tag ${entry}`}
                disabled={busy}
                className="text-admin-muted hover:text-lab-error"
                onClick={() =>
                  void file(
                    annotations.tags.filter((kept) => kept !== entry),
                    () => {},
                  )
                }
              >
                ×
              </button>
            </span>
          ))
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={submitTag}
          {...tagTouch.watch}
        >
          <label className="sr-only" htmlFor="experiment-tag">
            Add a tag
          </label>
          <input
            id="experiment-tag"
            // `h-8` used to shrink this to the small button beside it; the shared control is a
            // 44px floor now (UI-7) and a fixed height under a floor is dead code, so it is
            // gone rather than left to read as a metric this field still has. The width is the
            // prototype's for the tag input (`Workspace.dc.html`:2650): the rest of the row at a
            // 130px floor, so it sits beside Add tag rather than above it (ADR 0069).
            className={`${fieldControlClasses} w-auto min-w-[130px] flex-1`}
            placeholder="read-check-gap"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          />
          {/* The form's one submit, so a primary action refused with its reason (ADR 0063) —
              at the outline weight *Add note* wears, which is also the height of the field. */}
          <PrimaryAction
            variant="outline"
            type="submit"
            refusal={tagEmpty ? { id: tagReasonId, reason: TAG_EMPTY } : null}
            busy={busy}
          >
            <ButtonIcon verb="create" />
            Add tag
          </PrimaryAction>
          {tagEmpty ? (
            <RefusalLine id={tagReasonId} touched={tagTouch.touched} className="w-full">
              {TAG_EMPTY}
            </RefusalLine>
          ) : null}
        </form>
      </div>

      {annotations.notes.length > 0 ? (
        <ul className="grid gap-2 border-t border-admin-border pt-3">
          {annotations.notes.map((entry) => (
            <li key={entry.note_id} className="grid gap-0.5">
              <p className="text-[13px] text-admin-ink">{entry.body}</p>
              <p className="text-xs text-admin-muted">{formatTimestamp(entry.created_at)}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <form className={addFormClasses} onSubmit={submitNote} {...noteTouch.watch}>
        <label className="sr-only" htmlFor="experiment-note">
          Add a note
        </label>
        <textarea
          maxLength={NOTE_MAX_LENGTH}
          id="experiment-note"
          className={`${textAreaClasses} w-full`}
          placeholder="What this run showed, in your own words…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="grid justify-items-start gap-1.5">
          <PrimaryAction
            variant="outline"
            type="submit"
            refusal={noteEmpty ? { id: noteReasonId, reason: NOTE_EMPTY } : null}
            busy={busy}
          >
            <ButtonIcon verb="create" />
            Add note
          </PrimaryAction>
          {noteEmpty ? (
            <RefusalLine id={noteReasonId} touched={noteTouch.touched}>
              {NOTE_EMPTY}
            </RefusalLine>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

/**
 * Usage: what each arm spent, measure by measure (ADR 0080; sheet mockup :186–191).
 *
 * The measures the arms differ on come first, drawn larger, each tinted and marked *Differs*;
 * the rest fold under "N measures are the same for both arms". Neither says which arm did
 * better: a cheaper arm that missed what the scenario required is not the better one, and the
 * model, the prompt and the operator's own replies move every figure here as much as the
 * framework does. One arm has nothing to differ from, so every measure is drawn.
 *
 * An unreported measurement says so rather than showing a zero. A framework that does not
 * meter itself and an arm that called no model are different findings, and a column of zeros
 * for both would hide the one an operator has to act on.
 */
function Usage({ runs, arms }: { runs: ExperimentRunSchema[]; arms: SheetArm[] }) {
  const columns = runs.map((run) => quantities(run.metrics));
  const compared = runs.length > 1;
  const rows = MEASURES.map((measure) => {
    const values = columns.map((column) => column[measure]);
    const differs = compared && values.some((value) => value.join("\n") !== values[0]?.join("\n"));
    return { measure, values, differs };
  });
  const differing = compared ? rows.filter((row) => row.differs) : rows;
  const shared = compared ? rows.filter((row) => !row.differs) : [];
  // A retry is the one figure drawn in the error ink (ADR 0068): the arm needed another attempt.
  // Drawn open or folded with the rows every arm shares, it keeps the ink.
  const warn = (measure: Measure, index: number) =>
    measure === "Retries" && (runs[index]?.metrics.retries ?? 0) > 0 ? "text-lab-error" : undefined;
  return (
    <SheetSection
      id="usage"
      title="Usage"
      note="Observations, not scores: the model, the prompt and the operator's own replies all move them."
      arms={arms}
      labelHeader="Measure"
      after={
        <SameForEveryArm
          title="Usage"
          labelHeader="Measure"
          noun={["measure", "measures"]}
          rows={shared.map((row) => ({
            key: row.measure,
            label: row.measure,
            value: row.values[0]?.join("\n") ?? "",
            // Shared, so every arm needed it: the first arm's count is all of theirs.
            className: warn(row.measure, 0),
          }))}
        />
      }
    >
      {differing.map((row) => (
        <SheetRow
          key={row.measure}
          label={row.measure}
          differs={row.differs}
          cellClassName={(index) => warn(row.measure, index)}
          cells={row.values.map((lines, index) => (
            <Lines
              key={runs[index]?.run_id ?? index}
              lines={lines}
              className={row.differs ? sheetFigureDiffersClasses : sheetFigureClasses}
            />
          ))}
        />
      ))}
    </SheetSection>
  );
}

/** A value of one or more facts, one per line. */
function Lines({ lines, className }: { lines: string[]; className: string }) {
  return (
    <>
      {lines.map((line) => (
        <span key={line} className={className}>
          {line}
        </span>
      ))}
    </>
  );
}

/**
 * One arm's metrics as the lines each measure's cell draws: one fact per line, so an arm's
 * failures are a line each.
 *
 * "not reported" is a value here, deliberately. It is what the backend means by a null: a
 * measurement nobody took, which is a different reading from a measurement of zero.
 */
function quantities(metrics: ArmMetricsSchema): Record<Measure, string[]> {
  // A total covering fewer attempts than the arm made is a floor, not a figure: a failed
  // attempt reports nothing it spent, so a retried arm really did spend more than this.
  const floor = metrics.metered_attempts < metrics.attempts ? "≥" : "";
  const failures = Object.entries(metrics.failures);
  const usage = metrics.usage;
  return {
    Turns: [`${metrics.turns}`],
    "Answered turns": [`${metrics.answered_turns}`],
    Attempts: [`${metrics.attempts}`],
    Retries: [`${metrics.retries}`],
    Failures:
      failures.length === 0
        ? ["none"]
        : failures.map(([code, count]) => `${count} × ${describeFailure(code)}`),
    "Tool calls": [`${metrics.tool_calls}`],
    Writes: [`${metrics.tool_writes}`],
    "Model requests": [
      metrics.model_requests === null ? "not reported" : `${metrics.model_requests}`,
    ],
    "Tokens, in and out": [
      usage === null
        ? "not reported"
        : `${floor}${formatTokens(usage.input_tokens + usage.output_tokens)}`,
    ],
    "Input tokens": [
      usage === null ? "not reported" : `${floor}${formatTokens(usage.input_tokens)}`,
    ],
    "Output tokens": [
      usage === null ? "not reported" : `${floor}${formatTokens(usage.output_tokens)}`,
    ],
    "Time in attempts": [
      metrics.duration_ms === null
        ? "not reported"
        : `${formatDuration(metrics.duration_ms)}${
            metrics.measured_attempts < metrics.attempts
              ? ` (${metrics.measured_attempts} of ${metrics.attempts})`
              : ""
          }`,
    ],
    "Time in tools": [
      metrics.tool_duration_ms === null ? "not reported" : formatDuration(metrics.tool_duration_ms),
    ],
    "Estimated cost": [
      metrics.estimated_cost === null
        ? "not priced"
        : `${floor}${formatCost(metrics.estimated_cost)}`,
    ],
  };
}

/** Why a turn is listed as divergent: the sentence the divergence card's footer said. */
const ONE_SEND = "One send is one composition however many arms it reaches.";

/**
 * Input divergence, in Outcome: the turns the arms did not hear alike.
 *
 * Read from the composition each turn belongs to rather than from the words in it: the same
 * sentence sent to each arm by two separate decisions is two compositions, and it is those
 * two decisions — not the text — that make everything after them an uncontrolled comparison.
 * Either way one spanning row says whether the comparison is controlled, the card's old footer on
 * its second line; a divergent one is then followed by a row per divergent turn, with what each
 * arm heard in its own cell.
 */
function Divergence({
  experiment,
  runs,
}: {
  experiment: ExperimentResponse;
  runs: ExperimentRunSchema[];
}) {
  const ordinals = [...new Set(experiment.turns.map((turn) => turn.ordinal))].sort(
    (left, right) => left - right,
  );
  const divergent = ordinals.filter((ordinal) => {
    const delivered = experiment.turns.filter((turn) => turn.ordinal === ordinal);
    const compositions = new Set(delivered.map((turn) => turn.turn_id));
    return compositions.size > 1 || delivered.length < runs.length;
  });
  if (divergent.length === 0) {
    return (
      <SheetSpanningRow label="Input divergence">
        <span>
          <span aria-hidden className="mr-2 font-extrabold text-lab-success">
            ✓
          </span>
          Every turn reached both arms as one composition — the comparison is controlled.
        </span>
        <span className={sheetCellDetailClasses}>{ONE_SEND}</span>
      </SheetSpanningRow>
    );
  }
  return (
    <>
      <SheetSpanningRow label="Input divergence">
        <span>
          Not every turn reached both arms as one composition, so the comparison is not controlled.
        </span>
        <span className={sheetCellDetailClasses}>{ONE_SEND}</span>
      </SheetSpanningRow>
      {divergent.map((ordinal) => (
        <SheetRow
          key={ordinal}
          label={`Turn ${turnNumber(ordinal)}`}
          cells={runs.map((run) => {
            const heard = experiment.turns.find(
              (turn: ParticipantTurnSchema) =>
                turn.run_id === run.run_id && turn.ordinal === ordinal,
            );
            return (
              <span key={run.run_id}>{heard ? `“${heard.body}”` : "never received this turn"}</span>
            );
          })}
        />
      ))}
    </>
  );
}
