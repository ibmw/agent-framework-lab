import type {
  AgentConfigurationSummarySchema,
  ArmEvaluationSchema,
  ComparisonDimension,
  DefinitionVersionSummarySchema,
  ExperimentAnnotationsResponse,
  ExperimentEvaluationResponse,
  ExperimentResponse,
  ExperimentRunSchema,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
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
import { TourLaunch } from "../components/TourLaunch";
import { Fingerprint, PageHeader } from "../components/WorkspaceChrome";
import { COMPARISON_DIMENSION, DEFINITION_TYPE, describeValue, labelOf } from "../lib/enumLabels";
import {
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  inkButtonClasses,
  subtleButtonClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

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
  const [deriving, setDeriving] = useState(false);
  const [forking, setForking] = useState(false);
  const navigate = useNavigate();

  /**
   * Derive a new experiment from this one and open its results.
   *
   * It navigates rather than staying here, because a replay does not change this run: what
   * came back is a different experiment, and leaving the operator on the old one with a
   * success message would hide the only thing that happened.
   */
  const replay = useCallback(async () => {
    setDeriving(true);
    setError(null);
    try {
      const derived = await replayExperiment(shopId, experimentId);
      navigate(`/shops/${shopId}/bench/${derived.experiment_id}/results`);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This experiment could not be replayed."));
    } finally {
      setDeriving(false);
    }
  }, [shopId, experimentId, navigate]);

  /**
   * Derive a new experiment that runs this incident with the arms the operator chose.
   *
   * Navigates for the reason the replay does: what came back is a different run, and the
   * reason to fork one is to read what the arms did instead.
   */
  const fork = useCallback(
    async (arms: { configuration_id: string; version: number }[]) => {
      setDeriving(true);
      setError(null);
      try {
        const derived = await forkExperiment(shopId, experimentId, { arms });
        navigate(`/shops/${shopId}/bench/${derived.experiment_id}/results`);
      } catch (cause: unknown) {
        setError(describeApiError(cause, "This experiment could not be forked."));
      } finally {
        setDeriving(false);
      }
    },
    [shopId, experimentId, navigate],
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
          <div className="flex items-center gap-2">
            <TourLaunch id="results" />
            <button
              className={subtleButtonClasses}
              type="button"
              onClick={replay}
              disabled={deriving}
            >
              {deriving ? "Deriving…" : "Replay"}
            </button>
            {/* The frame's ellipsis is doing real work: a replay asks nothing because
                everything it needs is in the record, and a fork asks which versions to
                take. The panel opens below the header rather than over it — this shell has
                no modal, and a derivation is read beside the run it derives from. */}
            <button
              className={subtleButtonClasses}
              type="button"
              aria-expanded={forking}
              aria-controls={FORK_PANEL_ID}
              onClick={() => setForking((open) => !open)}
            >
              Fork…
            </button>
          </div>
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
            {experiment.derived_from ? (
              <>
                {` · ${experiment.derived_from.kind} of `}
                <Link
                  className="font-semibold text-lab-ink"
                  to={`/shops/${shopId}/bench/${experiment.derived_from.experiment_id}/results`}
                >
                  {experiment.derived_from.label}
                </Link>
                {describeChange(experiment.derived_from.changed)}
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

      {forking ? <ForkPanel experiment={experiment} deriving={deriving} onFork={fork} /> : null}

      <div className="mb-4 grid gap-3">
        <div data-tour="results-arms" className="grid gap-3 lg:grid-cols-2">
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
 * What a derivation moved from the run it came from, said where it names that run.
 *
 * Empty for a replay, which pins what its source pinned. More than one dimension is the
 * setup gate's comparison warning one level out: a fork that moved two things has no claim
 * that the thing it changed is the only thing that changed, so the sentence says so rather
 * than leaving it to be noticed months later.
 */
function describeChange(changed: ComparisonDimension[]) {
  if (changed.length === 0) {
    return null;
  }
  const named = changed.map((dimension) => labelOf(COMPARISON_DIMENSION, dimension)).join(", ");
  return changed.length === 1 ? (
    <span className="text-admin-muted">{` · changed ${named}`}</span>
  ) : (
    <span className="text-admin-draft-ink">
      {` · changed ${named} — no difference from that run can be attributed to any one of them`}
    </span>
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
  onFork,
}: {
  experiment: ExperimentResponse;
  deriving: boolean;
  onFork: (arms: { configuration_id: string; version: number }[]) => void;
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

  const moved = chosen.some(
    (arm, position) =>
      arm.configurationId !== experiment.runs[position].agent_configuration_id ||
      arm.version !== experiment.runs[position].agent_configuration_version,
  );

  return (
    <section
      id={FORK_PANEL_ID}
      aria-label="Fork this experiment"
      className="mb-4 grid gap-3 rounded-lg border border-admin-border bg-admin-surface px-4 py-3"
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
        <button
          className={inkButtonClasses}
          type="button"
          disabled={deriving || !moved}
          onClick={() =>
            onFork(
              chosen.map((arm) => ({
                configuration_id: arm.configurationId,
                version: arm.version,
              })),
            )
          }
        >
          {deriving ? "Deriving…" : "Fork this run"}
        </button>
      </div>
    </section>
  );
}

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
        {run.label} · ran {run.agent_configuration_name} v{run.agent_configuration_version}
      </legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className={fieldLabelClasses}>
          Agent configuration
          <select
            className={fieldControlClasses}
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
            className={fieldControlClasses}
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
    <div
      data-tour="results-provenance"
      className="flex flex-wrap items-center gap-2 text-[11.5px] text-admin-ink-soft"
    >
      <span className="rounded-full bg-admin-border px-2.5 py-0.5 font-semibold">
        scenario v{experiment.scenario_version}
      </span>
      {experiment.sandbox_inputs.map((pin) => (
        <span
          key={`${pin.definition_type}:${pin.definition_id}`}
          className="rounded-full bg-admin-border px-2.5 py-0.5 font-semibold"
        >
          {describeValue(DEFINITION_TYPE, pin.definition_type)} v{pin.version}
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
          {labelOf(COMPARISON_DIMENSION, variable.dimension)} differs
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
