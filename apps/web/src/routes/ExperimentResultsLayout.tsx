import type {
  AgentConfigurationSummarySchema,
  ArmEvaluationSchema,
  DefinitionVersionSummarySchema,
  ExperimentAnnotationsResponse,
  ExperimentEvaluationResponse,
  ExperimentResponse,
  ExperimentRunSchema,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import {
  listAgentConfigurations,
  listAgentConfigurationVersions,
} from "../api/agentConfigurations";
import { describeApiError } from "../api/client";
import {
  forkExperiment,
  getExperiment,
  getExperimentAnnotations,
  getExperimentEvaluation,
  replayExperiment,
} from "../api/experiments";
import { ActionStatus } from "../components/ActionStatus";
import { ButtonIcon } from "../components/ButtonIcon";
import { BusyButton, PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import { RunTags } from "../components/RunTags";
import { PageHeader } from "../components/WorkspaceChrome";
import {
  type ActionStatusRow,
  armDetail,
  DERIVATION_NOTE,
  type Derivation,
  derivationReport,
  derivedRows,
} from "../lib/actionStatus";
import type { Annotate } from "../lib/annotate";
import { armsInOrder } from "../lib/comparison";
import {
  configurationChip,
  describeArmStanding,
  MISSED_REQUIREMENT,
  OUTCOMES,
} from "../lib/evidence";
import { unreachableArmsNote } from "../lib/modelConnections";
import { useRefusalTouch } from "../lib/refusalTouch";
import { sheetArmsOf } from "../lib/sheet";
import {
  depthTabRowClasses,
  depthTabStateClasses,
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  notesCountClasses,
  outlineButtonClasses,
  resultsBackLinkClasses,
  resultsHeaderRowsClasses,
  runFactClasses,
  runFactLinkClasses,
  runFactListClasses,
  sheetArmLetterClasses,
  sheetCellArmClasses,
  sheetColumns,
  sheetSectionClasses,
  versionChipClasses,
} from "../lib/ui";
import { frameworkName, labelNamesFramework, useFrameworkLabels } from "../lib/useFrameworkLabels";
import { pinKey, publishedNameOf, usePinnedVersions } from "../lib/usePinnedVersions";
import { useUnreachableProviders } from "../lib/useUnreachableProviders";
import { definitionPath, versionPath } from "../lib/versionLinks";
import { useNarrowViewport } from "../lib/viewport";

const UNAVAILABLE = "This experiment's results are unavailable.";

/** Named so the header's `Fork…` can say which region it expands (`aria-controls`). */
const FORK_PANEL_ID = "fork-experiment-panel";

/**
 * What every results tab is handed, so no two of them read the experiment differently.
 *
 * None of the three documents is nullable: they are read together and the tabs are rendered
 * only once all of them have arrived. A tab holding an experiment without its evaluation
 * would be a state this screen deliberately never enters — it would render an objective
 * matrix that had not been told anything yet.
 */
export interface ExperimentResults {
  shopId: string;
  experimentId: string;
  experiment: ExperimentResponse;
  evaluation: ExperimentEvaluationResponse;
  /** What an operator has written on this run — never a reading of what the run did. */
  annotations: ExperimentAnnotationsResponse;
  /** Replace the evaluation after a scoring pass answered with the whole of it. */
  onEvaluated: (evaluation: ExperimentEvaluationResponse) => void;
  /** Write on this run: a note on General, the tags in the header (`Annotate`). */
  annotate: Annotate;
  /** A note or a tag write is in flight, from the header or from General. */
  annotating: boolean;
}

/**
 * The experiment results screen (frame 9), and the persistent frame its depth tabs sit in.
 *
 * The header, the tabs and the arms' summary row belong here rather than to any one tab because the frame
 * says so for a reason: an operator who follows a finding from the evidence overview into
 * the execution timeline is still reading one experiment, and a depth view that reintroduced
 * its own header would let them lose which run they were in.
 *
 * The experiment, its evaluation, and what an operator has written on it are read once,
 * here, and handed down. Two tabs fetching the same documents would be two readings of one
 * run, free to disagree the moment one of them was reloaded and the other was not.
 */
export function ExperimentResultsLayout() {
  // Both identifiers come from the address; see `ExperimentBenchPage` (ADR 0054).
  const { shopId = "", experimentId = "" } = useParams();
  const [experiment, setExperiment] = useState<ExperimentResponse | null>(null);
  const [evaluation, setEvaluation] = useState<ExperimentEvaluationResponse | null>(null);
  const [annotations, setAnnotations] = useState<ExperimentAnnotationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The derivation in flight — or answered while the operator read another run — with the run
  // it was pressed on. It outlives a move between runs, because this element does (below).
  const [deriving, setDeriving] = useState<
    (Derivation & { sourceId: string; sourceLabel: string; derivedId?: string }) | null
  >(null);
  const inFlight = deriving !== null && deriving.answer === undefined;
  // The run the operator is reading now, or null once they have left the results altogether:
  // what a derivation's answer is read against when it arrives.
  const here = useRef<string | null>(experimentId);
  useEffect(() => {
    here.current = experimentId;
  }, [experimentId]);
  useEffect(
    () => () => {
      here.current = null;
    },
    [],
  );
  const [forking, setForking] = useState(false);
  // One annotation write at a time, whether a note from General or the tags from the header: each
  // answers with the whole annotation, and two in flight could answer out of order, the later
  // answer drawing the run without what the earlier one wrote.
  const [annotating, setAnnotating] = useState(false);
  const navigate = useNavigate();
  // Replay and Fork both run their arms before they answer, so an arm naming a provider this
  // lab cannot reach is refused there with 422 — said here first, as setup's Start says it
  // (ADR 0053). Read before the early return below, so the hooks keep their order.
  const unreachable = useUnreachableProviders();
  // The summary row names each framework by its label, as History does; read before the early
  // return below for the same reason.
  const frameworkLabels = useFrameworkLabels();
  const replayNoteId = useId();
  const aboutId = useId();
  const derivingNoteId = useId();

  /**
   * What a derivation's answer does, read against where the operator is when it arrives.
   *
   * Still on the run it was pressed on, it opens the new run — a replay does not change this
   * run, and leaving the operator on it with a success message would hide the only thing that
   * happened — or says in the page's alert why it was refused, as before. Reading another run
   * by then (this layout stays mounted across the move, so the answer still arrives here), it
   * never takes them off the page they chose: the queue says what came back, with a link to it.
   * Gone from the results altogether (`here` is then null), it opens nothing either.
   */
  const answered = useCallback(
    (sourceId: string, outcome: { experimentId: string; label: string } | { error: string }) => {
      if (here.current === sourceId) {
        setDeriving(null);
        if ("error" in outcome) {
          setError(outcome.error);
        } else {
          navigate(`/lab/bench/${shopId}/${outcome.experimentId}/results`);
        }
        return;
      }
      setDeriving((current) =>
        current === null || current.sourceId !== sourceId
          ? current
          : {
              ...current,
              answer: "error" in outcome ? outcome : { label: outcome.label },
              derivedId: "error" in outcome ? undefined : outcome.experimentId,
            },
      );
    },
    [shopId, navigate],
  );

  /** Derive a new experiment from this one; its answer is `answered`'s to deliver. */
  const replay = useCallback(
    async (arms: ActionStatusRow[], sourceLabel: string) => {
      const sourceId = experimentId;
      setDeriving({ kind: "replay", arms, sourceId, sourceLabel });
      setError(null);
      try {
        const derived = await replayExperiment(shopId, sourceId);
        answered(sourceId, { experimentId: derived.experiment_id, label: derived.label });
      } catch (cause: unknown) {
        answered(sourceId, {
          error: describeApiError(cause, "This experiment could not be replayed."),
        });
      }
    },
    [shopId, experimentId, answered],
  );

  /**
   * Derive a new experiment that runs this incident with the arms the operator chose, for the
   * reason the replay does: the reason to fork one is to read what the arms did instead.
   */
  const fork = useCallback(
    async (
      arms: { configuration_id: string; version: number }[],
      rows: ActionStatusRow[],
      sourceLabel: string,
    ) => {
      const sourceId = experimentId;
      setDeriving({ kind: "fork", arms: rows, sourceId, sourceLabel });
      setError(null);
      try {
        const derived = await forkExperiment(shopId, sourceId, { arms });
        answered(sourceId, { experimentId: derived.experiment_id, label: derived.label });
      } catch (cause: unknown) {
        answered(sourceId, {
          error: describeApiError(cause, "This experiment could not be forked."),
        });
      }
    },
    [shopId, experimentId, answered],
  );

  const annotate = useCallback<Annotate>(
    async (change) => {
      const sourceId = experimentId;
      setAnnotating(true);
      try {
        const answer = await change();
        // An answer about a run the operator has since left is not drawn over the one they are on.
        if (here.current !== sourceId) {
          return false;
        }
        setAnnotations(answer);
        return true;
      } finally {
        setAnnotating(false);
      }
    },
    [experimentId],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      // Together, for the reason the bench reads them together: what an arm did and how it
      // is doing against what the recipe asked for are one reading of one record.
      const [record, judged, written] = await Promise.all([
        getExperiment(shopId, experimentId, signal),
        getExperimentEvaluation(shopId, experimentId, signal),
        // Read here rather than by the tab that shows it, for the reason the other two are:
        // one screen, one reading. It is a third request because it is a third document —
        // annotating a run must not be able to move the record it is about (ADR 0036).
        getExperimentAnnotations(shopId, experimentId, signal),
      ]);
      setExperiment(record);
      setEvaluation(judged);
      setAnnotations(written);
    },
    [shopId, experimentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    // Cleared before the next read rather than left showing the previous run. This element
    // stays mounted across a navigation between two experiments — deriving one lands here,
    // and so does following a derived run's provenance link back — so a screen that kept its
    // state would show one run's header over another run's evidence until the fetch landed,
    // and would leave the fork panel open on a draft written against the run before it.
    setExperiment(null);
    setEvaluation(null);
    setAnnotations(null);
    setForking(false);
    // A derivation still in flight is kept: it holds Replay and Fork on whichever run is read,
    // so a move cannot free them for a second one while the lab is running the first. One
    // already answered and said here is dropped with the page it was said on.
    setDeriving((current) => (current !== null && current.answer === undefined ? current : null));
    setError(null);
    load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(describeApiError(cause, UNAVAILABLE));
      }
    });
    return () => controller.abort();
  }, [load]);

  if (experiment === null || evaluation === null || annotations === null) {
    return (
      <>
        <PageHeader title="Results" />
        {error ? (
          <p role="alert" className="text-[13px] text-lab-error">
            {error}
          </p>
        ) : (
          <p className="text-sm text-admin-muted">Loading results…</p>
        )}
      </>
    );
  }

  // The pressed control is the one on the run the derivation started from; on any other run
  // both are held natively, as a history row's are while another row's derivation runs.
  const pressedHere = inFlight && deriving.sourceId === experimentId ? deriving.kind : null;
  const report = derivationReport(
    deriving === null
      ? null
      : {
          ...deriving,
          subject: deriving.sourceId === experimentId ? undefined : deriving.sourceLabel,
        },
  );

  // A replay runs exactly what this run pinned, and each arm already says which provider its
  // pinned version names, so nothing has to be read to know.
  const replayBlocked = unreachableArmsNote(
    experiment.runs.map((run) => run.provider),
    unreachable,
  );

  const context: ExperimentResults = {
    shopId,
    experimentId,
    experiment,
    evaluation,
    annotations,
    onEvaluated: setEvaluation,
    annotate,
    annotating,
  };

  const resultsPath = `/lab/bench/${shopId}/${experimentId}/results`;
  const completed = experiment.runs.every((run) => run.standing.awaiting === "completed");
  const scenarioPath = versionPath(
    "scenario",
    experiment.scenario_id,
    experiment.scenario_version,
    shopId,
  );

  return (
    <>
      <PageHeader
        title={experiment.label}
        lead={
          <Link className={resultsBackLinkClasses} to={`/lab/bench/${shopId}/${experimentId}`}>
            <span aria-hidden>← </span>
            Back to the live bench
          </Link>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* To the last section of General from any tab, where the router lands it as a chip's
                jump. Named with its count, so a run with notes on it says so from every tab: the
                label spells the count's separator, which the drawn badge only implies. */}
            <Link
              className={outlineButtonClasses}
              to={{ pathname: resultsPath, hash: "notes" }}
              aria-label={`Notes · ${annotations.notes.length}`}
            >
              Notes
              <span className={notesCountClasses}>{annotations.notes.length}</span>
            </Link>
            <BusyButton
              className={outlineButtonClasses}
              type="button"
              onClick={() => void replay(derivedRows(experiment.runs), experiment.label)}
              // A secondary control keeps native `disabled` (ADR 0063): the reason in `title`,
              // and in one muted line the button's `aria-describedby` names. The replay in
              // flight is busy instead, which keeps focus on it (ADR 0065); any other
              // derivation in flight disables it natively, since it is not the control that
              // was pressed. It is described by the note before the press too, which is true
              // then as well, so a reader hears it on reaching the button.
              busy={pressedHere === "replay"}
              disabled={inFlight || replayBlocked !== ""}
              title={replayBlocked === "" ? undefined : replayBlocked}
              aria-describedby={[
                aboutId,
                replayBlocked === "" ? null : replayNoteId,
                derivingNoteId,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <ButtonIcon verb="rerun" />
              {pressedHere === "replay" ? "Replaying…" : "Replay"}
            </BusyButton>
            {/* The frame's ellipsis is doing real work: a replay asks nothing because
                everything it needs is in the record, and a fork asks which versions to
                take. The panel opens below the header rather than over it — this shell has
                no modal, and a derivation is read beside the run it derives from. */}
            <button
              className={outlineButtonClasses}
              type="button"
              aria-expanded={forking}
              aria-controls={FORK_PANEL_ID}
              aria-describedby={aboutId}
              onClick={() => setForking((open) => !open)}
            >
              <ButtonIcon verb="fork" />
              Fork…
            </button>
          </div>
        }
        below={
          <div className={resultsHeaderRowsClasses}>
            <ul aria-label="About this run" className={runFactListClasses}>
              <li className={runFactClasses[completed ? "completed" : "open"]}>
                <span aria-hidden>{completed ? OUTCOMES.met.mark : OUTCOMES.pending.mark}</span>
                {describeStanding(experiment)}
              </li>
              <li className={runFactClasses.fact}>
                {/* The chip's words are the link's, so it is heard once as what it opens. */}
                {scenarioPath === null ? (
                  `Scenario v${experiment.scenario_version}`
                ) : (
                  <Link className={runFactLinkClasses} to={scenarioPath}>
                    Scenario v{experiment.scenario_version}
                  </Link>
                )}
              </li>
              <li className={runFactClasses.fact}>
                Seed <span className="font-mono">{experiment.seed}</span>
              </li>
              <li className={runFactClasses.fact}>
                Started {formatTimestamp(experiment.created_at)}
              </li>
            </ul>
            {/* Keyed by the run, so a form opened on one run is not left open over the next. */}
            <RunTags
              key={experimentId}
              shopId={shopId}
              experimentId={experimentId}
              tags={annotations.tags}
              annotate={annotate}
              annotating={annotating}
            />
          </div>
        }
      />

      {/* What the two derivations are, beside them: neither changes this run, and each opens
          a new one once its arms are done. */}
      <p id={aboutId} className="mb-3 text-xs text-admin-muted">
        Replay runs this incident again as it was recorded; Fork runs it again with the arms you
        choose.
      </p>

      {replayBlocked === "" ? null : (
        <p id={replayNoteId} className="mb-3 text-xs text-admin-muted">
          {replayBlocked}
        </p>
      )}

      <div className={deriving === null ? undefined : "mb-3 grid gap-1"}>
        <ActionStatus
          label="Where each derived arm stands"
          report={report}
          note={DERIVATION_NOTE}
          noteId={derivingNoteId}
        />
        {deriving?.derivedId === undefined ? null : (
          <Link
            className="text-xs font-semibold text-lab-ink"
            to={`/lab/bench/${shopId}/${deriving.derivedId}/results`}
          >
            Open the new run
          </Link>
        )}
      </div>

      {error ? (
        <p role="alert" className="mb-3 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      {forking ? (
        <ForkPanel
          experiment={experiment}
          deriving={pressedHere}
          held={inFlight}
          noteId={derivingNoteId}
          unreachable={unreachable}
          onFork={fork}
        />
      ) : null}

      <nav aria-label="Results views" className={`mb-4 ${depthTabRowClasses}`}>
        <Tab to="." end label="General" />
        <Tab to="conversation" label="Conversation" />
        <Tab to="timeline" label="Execution timeline" />
        <Tab to="traces" label="Traces" />
      </nav>

      <ArmSummaryRow
        shopId={shopId}
        runs={armsInOrder(experiment)}
        evaluation={evaluation}
        frameworkLabels={frameworkLabels}
      />

      <Outlet context={context} />
    </>
  );
}

/**
 * Frame 9's `Fork…`: which published version each arm runs instead.
 *
 * Everything else is deliberately not here, because it is not a fork's to change. The
 * scenario version, the seed, the starting state and the customer's own script are the
 * source's, which is what makes the derived run a comparison with it rather than a new
 * experiment — and the arms keep the names this run gave them, because a comparison refers
 * to an arm by its position.
 *
 * The submit is disabled until something has actually moved. The backend refuses a fork that
 * changes nothing — it is a replay, and there is a button for that beside this one — and a
 * control that can only fail is worse than one that says why it is not ready.
 */
function ForkPanel({
  experiment,
  deriving,
  held,
  noteId,
  unreachable,
  onFork,
}: {
  experiment: ExperimentResponse;
  /** The derivation in flight from this run, whichever button started it. */
  deriving: "replay" | "fork" | null;
  /** Any derivation is in flight, from this run or the one the operator came from. */
  held: boolean;
  /** The derivation's note, which says it cannot be cancelled. */
  noteId: string;
  /** The providers this lab cannot reach, or null while that is not known. */
  unreachable: ReadonlySet<string> | null;
  onFork: (
    arms: { configuration_id: string; version: number }[],
    rows: ActionStatusRow[],
    sourceLabel: string,
  ) => void;
}) {
  const [configurations, setConfigurations] = useState<AgentConfigurationSummarySchema[]>([]);
  // What the panel could not read. Reported rather than swallowed, as the setup screen
  // reports it: an empty picker with no message reads as "there is nothing to fork onto",
  // which is a claim about the lab rather than about a request that failed.
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ForkDraft[]>(() =>
    experiment.runs.map((run) => ({
      configurationId: run.agent_configuration_id,
      version: run.agent_configuration_version,
    })),
  );

  useEffect(() => {
    const controller = new AbortController();
    listAgentConfigurations(controller.signal)
      .then((listed) => {
        setConfigurations(listed.configurations);
        setUnreadable(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setUnreadable(describeApiError(cause, "The agent configurations are unavailable."));
        }
      });
    return () => controller.abort();
  }, []);

  const moves = (arm: ForkDraft, position: number) =>
    arm.configurationId !== experiment.runs[position].agent_configuration_id ||
    arm.version !== experiment.runs[position].agent_configuration_version;
  const moved = chosen.some(moves);
  const forkNoteId = useId();
  // The panel's refusal is a hint until an arm is moved or *Fork this run* is pressed
  // (ADR 0078): opening the panel is not an attempt that failed.
  const forkTouch = useRefusalTouch();

  // What each chosen arm would run, as the choice stands. An arm left where it was runs the
  // version this run pinned, whose provider and published name the run already records; an
  // arm moved is read off the version it moves to — its provider for the reach line, and the
  // name it was published under for the queue (ADR 0065, amended 2026-10-04). An answer
  // counts only for the version it was read for, so a quick switch never names the arm by the
  // version it left.
  const pinned = usePinnedVersions(chosen.filter(moves));
  const forkBlocked = unreachableArmsNote(
    chosen.map((arm, position) =>
      moves(arm, position)
        ? (pinned.get(pinKey(arm))?.provider ?? null)
        : experiment.runs[position].provider,
    ),
    unreachable,
  );
  const names = chosen.map((arm, position) =>
    publishedNameOf(
      pinned,
      {
        pin: {
          configurationId: experiment.runs[position].agent_configuration_id,
          version: experiment.runs[position].agent_configuration_version,
        },
        name: experiment.runs[position].agent_configuration_name,
      },
      arm,
    ),
  );
  // An arm moved onto a version still being read is not named yet: a wait, so the press is
  // busy rather than refused (ADR 0063), and it is never sent under a name it may not have.
  const namesPending = names.some((name) => name === undefined);
  // An arm the lab cannot reach refuses the whole derivation; failing that, a fork that moved
  // nothing is a replay (ADR 0063: refused with a reason, never silently).
  const forkRefusal = forkBlocked !== "" ? forkBlocked : moved ? null : FORK_UNMOVED_REASON;
  // Waiting on a name is said only where nothing refuses the fork, as setup's Start waits.
  const waiting = namesPending && forkRefusal === null;

  return (
    <section
      id={FORK_PANEL_ID}
      aria-label="Fork this experiment"
      className="mb-4 grid gap-3 rounded-lg border border-admin-border bg-admin-surface px-4 py-3"
      {...forkTouch.watch}
    >
      {unreadable ? (
        <p role="alert" className="text-[13px] text-lab-error">
          {unreadable}
        </p>
      ) : null}
      <p className="text-xs text-admin-muted">
        A fork runs this incident again in the world it started in, driven by the turns it recorded,
        with the arms you choose here. Change at least one — a derivation that changes nothing is a
        replay.
      </p>
      {experiment.runs.map((run, position) => (
        <ForkArmPicker
          key={run.run_id}
          run={run}
          configurations={configurations}
          arm={chosen[position]}
          onUnreadable={setUnreadable}
          onChange={(next) =>
            setChosen((current) =>
              current.map((entry, index) => (index === position ? next : entry)),
            )
          }
        />
      ))}
      <div>
        <PrimaryAction
          variant="ink"
          type="button"
          refusal={forkRefusal === null ? null : { id: forkNoteId, reason: forkRefusal }}
          busy={held || waiting}
          // The note is true before the press as well, so a reader hears it on reaching it.
          aria-describedby={noteId}
          onClick={() => {
            // The button swallows a refused or busy press itself; this is the handler's own check.
            if (forkRefusal !== null || namesPending) {
              return;
            }
            onFork(
              chosen.map((arm) => ({
                configuration_id: arm.configurationId,
                version: arm.version,
              })),
              chosen.map((arm, position) => ({
                key: experiment.runs[position].run_id,
                label: experiment.runs[position].label,
                detail: armDetail(names[position] ?? null, arm.version),
                progress: "running",
              })),
              experiment.label,
            );
          }}
        >
          <ButtonIcon verb="fork" />
          {deriving === "fork" ? "Forking…" : "Fork this run"}
        </PrimaryAction>
        {forkRefusal === null ? null : (
          <RefusalLine id={forkNoteId} touched={forkTouch.touched} className="mt-1">
            {forkRefusal}
          </RefusalLine>
        )}
      </div>
    </section>
  );
}

/** Why *Fork this run* is refused while every arm stands where the run left it. */
const FORK_UNMOVED_REASON = "Change at least one arm: a fork that changes nothing is a replay.";

/** One arm of a fork as the panel holds it, before it becomes a request. */
interface ForkDraft {
  configurationId: string;
  version: number;
}

/** One arm: which configuration it will run, and which published version of it. */
function ForkArmPicker({
  run,
  configurations,
  arm,
  onUnreadable,
  onChange,
}: {
  run: ExperimentRunSchema;
  configurations: AgentConfigurationSummarySchema[];
  arm: ForkDraft;
  onUnreadable: (message: string) => void;
  onChange: (next: ForkDraft) => void;
}) {
  const [versions, setVersions] = useState<DefinitionVersionSummarySchema[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    listAgentConfigurationVersions(arm.configurationId, controller.signal)
      .then((listed) => setVersions(listed.versions))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          // Reported into the panel's one alert rather than beside each picker: an operator
          // whose lab is unreachable is reading one message, not one per arm.
          onUnreadable(describeApiError(cause, "This configuration's versions are unavailable."));
        }
      });
    return () => controller.abort();
  }, [arm.configurationId, onUnreadable]);

  return (
    <fieldset className="grid gap-2 rounded-lg border border-admin-border p-3">
      <legend className="px-1 text-xs font-semibold text-admin-muted">
        {run.label} · ran{" "}
        {configurationChip(
          run.label,
          run.agent_configuration_name,
          run.agent_configuration_version,
        )}
      </legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className={fieldLabelClasses}>
          Agent configuration
          <select
            className={`${fieldControlClasses} w-full`}
            value={arm.configurationId}
            onChange={(event) => {
              const configurationId = event.target.value;
              const latest = configurations.find(
                (entry) => entry.configuration_id === configurationId,
              )?.latest_published_version;
              // Defaults to the newest publication of whatever was chosen, because "fork
              // with newer versions" is the question this panel is usually opened to ask.
              onChange({ configurationId, version: latest ?? 1 });
            }}
          >
            {configurations.map((configuration) => (
              <option
                key={configuration.configuration_id}
                value={configuration.configuration_id}
                // An unpublished configuration cannot be pinned, so it is offered as
                // unavailable rather than hidden.
                disabled={configuration.latest_published_version === null}
              >
                {configuration.name}
                {configuration.latest_published_version === null ? " (unpublished)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClasses}>
          Published version
          <select
            className={`${fieldControlClasses} w-full`}
            value={String(arm.version)}
            disabled={versions.length === 0}
            onChange={(event) => onChange({ ...arm, version: Number(event.target.value) })}
          >
            {[...versions]
              .sort((left, right) => right.version - left.version)
              .map((published) => (
                <option key={published.version} value={String(published.version)}>
                  v{published.version}
                </option>
              ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

/**
 * One depth tab.
 *
 * A link rather than a button, because a tab here is a place in the experiment: an operator
 * following a finding into the timeline can share or reopen exactly the view they were in.
 * `NavLink` marks the current one `aria-current="page"` itself, so the painted state and the
 * announced one cannot come apart.
 */
function Tab({ to, end, label }: { to: string; end?: boolean; label: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        isActive ? depthTabStateClasses.selected : depthTabStateClasses.idle
      }
    >
      {label}
    </NavLink>
  );
}

/**
 * The arms, once, on the sheet's columns, under the tabs on every tab (ADR 0080; sheet mockup
 * :90–96): what each ran and where it stands. It scrolls with the page; the strip General pins
 * is what names the columns once this has gone.
 *
 * Its label cell says what the columns are not: added into a winner. The figures an arm spent
 * are not here but in General's *Usage*, measure by measure beside the other arm's, because a
 * figure drawn on its arm's own card was read against nothing.
 */
function ArmSummaryRow({
  shopId,
  runs,
  evaluation,
  frameworkLabels,
}: {
  shopId: string;
  /** The arms in their positions' order, the order of every column on the sheet. */
  runs: ExperimentRunSchema[];
  evaluation: ExperimentEvaluationResponse;
  frameworkLabels: ReturnType<typeof useFrameworkLabels>;
}) {
  const narrow = useNarrowViewport();
  const arms = sheetArmsOf(runs);
  return (
    <div
      data-tour="results-arms"
      className={`mb-4 grid ${sheetSectionClasses}`}
      style={narrow ? undefined : { gridTemplateColumns: sheetColumns(runs.length) }}
    >
      <div className="grid content-center gap-1 px-5 py-4">
        <span className={sheetCellArmClasses}>Compared arms</span>
        <span className="text-[12.5px] leading-[1.45] text-admin-muted">
          Columns are never added into a winner.
        </span>
      </div>
      {runs.map((run, index) => (
        <ArmSummary
          key={run.run_id}
          shopId={shopId}
          run={run}
          letter={arms[index].letter}
          ruled={!narrow}
          framework={frameworkName(frameworkLabels, run.framework_id)}
          arm={evaluation.arms.find((entry) => entry.run_id === run.run_id) ?? null}
        />
      ))}
    </div>
  );
}

/**
 * One arm in the summary row: its name, what it ran, what it has met, and where it stands
 * (`Workspace.dc.html` :2566, sheet mockup :97–103).
 *
 * The count is the arm's own — met out of the rows something actually decided — and it is
 * deliberately never put beside the other arm's as a verdict. Two arms driven to different
 * depths hold different denominators, and a screen that subtracted one from the other would
 * be reporting the operator's own pacing as a difference between frameworks. For the same
 * reason it is drawn in one ink in every column, where the frame paints one green and one amber,
 * and the position's letter beside the name is one ink too: it names the column and ranks
 * nothing, and it is `aria-hidden` because the name it stands beside already says it.
 *
 * The configuration's version is a link to the editor of the draft it was published from
 * (ADR 0068), so a reviewer reading a finished run reaches what the arm ran in one press. It
 * names the configuration rather than the arm again (`configurationChip`), and the standing
 * is the bench's own sentence (`describeArmStanding`), turns counted from one. An arm that missed
 * a required objective says so under its count, in History's words and with the missed mark.
 */
function ArmSummary({
  shopId,
  run,
  letter,
  ruled,
  framework,
  arm,
}: {
  shopId: string;
  run: ExperimentRunSchema;
  letter: string;
  /** Ruled from the column before it, where the arms stand side by side. */
  ruled: boolean;
  /**
   * The framework as History names it: its display label, or its id where none is known; `null`
   * while the catalog loads, when the line names the model alone.
   */
  framework: string | null;
  arm: ArmEvaluationSchema | null;
}) {
  return (
    <section
      aria-label={`${run.label} summary`}
      className={`grid min-w-0 content-start gap-1.5 px-5 py-4 ${ruled ? "border-l border-admin-border/60" : "border-t border-admin-border/60"}`}
    >
      <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-bold text-admin-ink">
        <span aria-hidden className={sheetArmLetterClasses}>
          {letter}
        </span>
        <span className="min-w-0 break-words">{run.label}</span>
      </h2>
      <Link
        className={`${versionChipClasses} justify-self-start text-xs`}
        to={definitionPath(
          "agent_configuration",
          run.agent_configuration_id,
          run.agent_configuration_version,
          shopId,
        )}
        title={`Open ${run.agent_configuration_name}, whose draft published v${run.agent_configuration_version}`}
      >
        {configurationChip(
          run.label,
          run.agent_configuration_name,
          run.agent_configuration_version,
        )}
      </Link>
      <p className="text-[12.5px] text-admin-ink-soft">
        {framework === null || labelNamesFramework(run.label, framework)
          ? run.model_id
          : `${framework} · ${run.model_id}`}
      </p>
      {arm ? (
        <div
          title={`${arm.met} of the ${arm.decided} objective(s) something has decided for this arm`}
        >
          <p className="text-[12.5px] text-admin-ink">
            <span className="font-display text-[17px] font-bold text-admin-ink">
              {arm.met} of {arm.decided}
            </span>{" "}
            decided objectives met
          </p>
          {arm.failed ? (
            <p className="text-[12.5px] font-semibold text-lab-error">
              <span aria-hidden>{MISSED_REQUIREMENT.mark}</span> {MISSED_REQUIREMENT.label}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-[12.5px] text-admin-muted">
        {describeArmStanding(run.standing, run.metrics)}
      </p>
    </section>
  );
}

/** Where the experiment as a whole stands, which is only ever a reading of its arms. */
function describeStanding(experiment: ExperimentResponse): string {
  const completed = experiment.runs.filter((run) => run.standing.awaiting === "completed").length;
  if (completed === experiment.runs.length) {
    return "Every arm completed";
  }
  return completed === 0
    ? "Still running"
    : `${completed} of ${experiment.runs.length} arms completed`;
}
