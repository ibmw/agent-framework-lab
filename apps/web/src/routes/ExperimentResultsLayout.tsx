import type {
  ArmEvaluationSchema,
  ExperimentAnnotationsResponse,
  ExperimentEvaluationResponse,
  ExperimentResponse,
  ExperimentRunSchema,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  getExperiment,
  getExperimentAnnotations,
  getExperimentEvaluation,
  replayExperiment,
} from "../api/experiments";
import { Fingerprint, PageHeader } from "../components/WorkspaceChrome";
import { formatTimestamp, subtleButtonClasses } from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "This experiment's results are unavailable.";

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
  /** Replace the annotation after a write answered with the whole of it. */
  onAnnotated: (annotations: ExperimentAnnotationsResponse) => void;
}

export function useExperimentResults(): ExperimentResults {
  return useOutletContext<ExperimentResults>();
}

/**
 * The experiment results screen (frame 9), and the persistent frame its depth tabs sit in.
 *
 * The header and the arm summary belong here rather than to any one tab because the frame
 * says so for a reason: an operator who follows a finding from the evidence overview into
 * the execution timeline is still reading one experiment, and a depth view that reintroduced
 * its own header would let them lose which run they were in.
 *
 * The experiment, its evaluation, and what an operator has written on it are read once,
 * here, and handed down. Two tabs fetching the same documents would be two readings of one
 * run, free to disagree the moment one of them was reloaded and the other was not.
 */
export function ExperimentResultsLayout() {
  const { shopId } = useShopWorkspace();
  const { experimentId = "" } = useParams();
  const [experiment, setExperiment] = useState<ExperimentResponse | null>(null);
  const [evaluation, setEvaluation] = useState<ExperimentEvaluationResponse | null>(null);
  const [annotations, setAnnotations] = useState<ExperimentAnnotationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const navigate = useNavigate();

  /**
   * Derive a new experiment from this one and open its results.
   *
   * It navigates rather than staying here, because a replay does not change this run: what
   * came back is a different experiment, and leaving the operator on the old one with a
   * success message would hide the only thing that happened.
   */
  const replay = useCallback(async () => {
    setReplaying(true);
    setError(null);
    try {
      const derived = await replayExperiment(shopId, experimentId);
      navigate(`/shops/${shopId}/bench/${derived.experiment_id}/results`);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This experiment could not be replayed."));
    } finally {
      setReplaying(false);
    }
  }, [shopId, experimentId, navigate]);

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
        <PageHeader title="Experiment results" />
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

  const context: ExperimentResults = {
    shopId,
    experimentId,
    experiment,
    evaluation,
    annotations,
    onEvaluated: setEvaluation,
    onAnnotated: setAnnotations,
  };

  return (
    <>
      <PageHeader
        title={experiment.label}
        actions={
          <button
            className={subtleButtonClasses}
            type="button"
            onClick={replay}
            disabled={replaying}
          >
            {replaying ? "Replaying…" : "Replay"}
          </button>
        }
        description={
          <>
            <Link
              className="font-semibold text-lab-ink"
              to={`/shops/${shopId}/bench/${experimentId}`}
            >
              Back to the live bench
            </Link>{" "}
            · {describeStanding(experiment)} · scenario v{experiment.scenario_version} · seed{" "}
            {experiment.seed} · started {formatTimestamp(experiment.created_at)}
            {experiment.replay_of ? (
              <>
                {" · replay of "}
                <Link
                  className="font-semibold text-lab-ink"
                  to={`/shops/${shopId}/bench/${experiment.replay_of.experiment_id}/results`}
                >
                  {experiment.replay_of.label}
                </Link>
              </>
            ) : null}
          </>
        }
      />

      {error ? (
        <p role="alert" className="mb-3 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="mb-4 grid gap-3">
        <div className="grid gap-3 lg:grid-cols-2">
          {experiment.runs.map((run) => (
            <ArmSummary
              key={run.run_id}
              run={run}
              arm={evaluation.arms.find((entry) => entry.run_id === run.run_id) ?? null}
            />
          ))}
        </div>
        <Provenance experiment={experiment} />
      </div>

      <nav aria-label="Results views" className="mb-4 flex flex-wrap items-center gap-1.5">
        <Tab to="." end label="General" />
        <Tab to="timeline" label="Execution timeline" />
        <Tab to="traces" label="Traces" />
      </nav>

      <Outlet context={context} />
    </>
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
        `${subtleButtonClasses} ${isActive ? "bg-admin-canvas text-admin-ink" : ""}`
      }
    >
      {label}
    </NavLink>
  );
}

/**
 * One arm at the top of every tab: what ran, where it stands, and what it has met.
 *
 * The count is the arm's own — met out of the rows something actually decided — and it is
 * deliberately never put beside the other arm's as a verdict. Two arms driven to different
 * depths hold different denominators, and a screen that subtracted one from the other would
 * be reporting the operator's own pacing as a difference between frameworks.
 */
function ArmSummary({ run, arm }: { run: ExperimentRunSchema; arm: ArmEvaluationSchema | null }) {
  return (
    <section
      aria-label={`${run.label} summary`}
      className="grid gap-1 rounded-lg border border-admin-border bg-admin-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold text-lab-ink">{run.label}</h2>
        <span className="text-xs text-admin-muted">
          {run.framework_id} · {run.model_id} · configuration v{run.agent_configuration_version}
        </span>
        {arm ? (
          <span
            className="ml-auto text-sm font-semibold text-admin-ink"
            title={`${arm.met} of the ${arm.decided} objective(s) something has decided for this arm`}
          >
            {arm.met}/{arm.decided} decided
          </span>
        ) : null}
      </div>
      <p className="text-xs text-admin-muted">
        {run.standing.awaiting === "completed"
          ? `Completed at turn ${run.standing.ordinal}`
          : run.standing.awaiting === "agent"
            ? `Still running — waiting for the agent at turn ${run.standing.ordinal}`
            : `Still running — waiting for the customer at turn ${run.standing.ordinal}`}
      </p>
    </section>
  );
}

/** The chip strip: the versions this run pinned, and the dimensions its arms differ along. */
function Provenance({ experiment }: { experiment: ExperimentResponse }) {
  const differences = experiment.comparison.filter((variable) => variable.differs);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-admin-ink-soft">
      <span className="rounded-full bg-admin-border px-2.5 py-0.5 font-semibold">
        scenario v{experiment.scenario_version}
      </span>
      {experiment.sandbox_inputs.map((pin) => (
        <span
          key={`${pin.definition_type}:${pin.definition_id}`}
          className="rounded-full bg-admin-border px-2.5 py-0.5 font-semibold"
        >
          {pin.definition_type.replace(/_/g, " ")} v{pin.version}
        </span>
      ))}
      <span className="rounded-full bg-admin-border px-2.5 py-0.5 font-semibold">
        starting state <Fingerprint value={experiment.sandbox_fingerprint} />
      </span>
      {differences.map((variable) => (
        <span
          key={variable.dimension}
          className="rounded-full bg-admin-draft px-2.5 py-0.5 font-semibold text-admin-draft-ink"
        >
          {variable.dimension.replace(/_/g, " ")} differs
        </span>
      ))}
      {differences.length > 1 ? (
        <span className="text-admin-draft-ink">
          {differences.length} differences — no behavior here can be attributed to any one of them.
        </span>
      ) : null}
    </div>
  );
}

/** Where the experiment as a whole stands, which is only ever a reading of its arms. */
function describeStanding(experiment: ExperimentResponse): string {
  const completed = experiment.runs.filter((run) => run.standing.awaiting === "completed").length;
  if (completed === experiment.runs.length) {
    return "every arm completed";
  }
  return completed === 0
    ? "still running"
    : `${completed} of ${experiment.runs.length} arms completed`;
}
