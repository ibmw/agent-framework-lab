import type {
  AgentConfigurationSummarySchema,
  ComparisonDimension,
  DefinitionIssueSchema,
  DefinitionVersionSummarySchema,
  ExperimentPreviewResponse,
  ExperimentSummarySchema,
  ScenarioSummarySchema,
  StartExperimentRequest,
} from "@agent-lab/contracts";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAgentConfigurationVersion,
  listAgentConfigurations,
  listAgentConfigurationVersions,
} from "../api/agentConfigurations";
import { describeApiError, LabApiError } from "../api/client";
import { listExperiments, previewExperiment, startExperiment } from "../api/experiments";
import { listScenarios, listScenarioVersions } from "../api/scenarios";
import { ButtonIcon } from "../components/ButtonIcon";
import { FieldHint } from "../components/FieldHint";
import { PrimaryAction } from "../components/PrimaryAction";
import { Card, Fingerprint, IssueList, PageHeader } from "../components/WorkspaceChrome";
import { COMPARISON_DIMENSION, labelOf } from "../lib/enumLabels";
import { EXPERIMENT_LABEL_MAX_LENGTH, isSeed, startRefusals } from "../lib/experimentStart";
import { MAX_SEED, SEED_RULE } from "../lib/fieldRules";
import { unreachableArmsNote } from "../lib/modelConnections";
import {
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  tableCellClasses,
  tableHeadClasses,
  validationMessageClasses,
} from "../lib/ui";
import { useReachability } from "../lib/useUnreachableProviders";
import { NoCurrentShop } from "../shell/LabWorkspace";
import { useLabWorkspace } from "../shell/useLabWorkspace";

const UNAVAILABLE = "The experiment bench is unavailable.";
const DEFAULT_SEED = 20260828;

/**
 * One arm as the form holds it: a published configuration and the version to pin.
 *
 * `id` exists only so React can tell two arms apart while they are still empty. The arm's
 * meaning is its position — "arm A" is where it sits, not what it runs — so the identity
 * cannot be derived from the configuration, which two arms are allowed to share.
 */
interface ArmDraft {
  id: string;
  configurationId: string;
  version: string;
}

function emptyArm(): ArmDraft {
  return { id: crypto.randomUUID(), configurationId: "", version: "" };
}

function newestVersion(versions: DefinitionVersionSummarySchema[]): number | null {
  return versions.reduce<number | null>(
    (newest, published) =>
      newest === null || published.version > newest ? published.version : newest,
    null,
  );
}

function dimensionLabel(dimension: ComparisonDimension): string {
  return labelOf(COMPARISON_DIMENSION, dimension);
}

/** The request a start would make, or null while the operator has not chosen enough for one. */
function setupOf({
  scenarioId,
  scenarioVersion,
  arms,
  label,
  seed,
}: {
  scenarioId: string;
  scenarioVersion: string;
  arms: ArmDraft[];
  label: string;
  seed: string;
}): StartExperimentRequest | null {
  const chosen = arms.filter((arm) => arm.configurationId !== "" && arm.version !== "");
  if (scenarioId === "" || scenarioVersion === "" || chosen.length === 0) {
    return null;
  }
  return {
    label: label.trim(),
    scenario_id: scenarioId,
    scenario_version: Number(scenarioVersion),
    seed: Number(seed),
    arms: chosen.map((arm) => ({
      configuration_id: arm.configurationId,
      version: Number(arm.version),
      label: "",
    })),
    // The only driver implemented, and stated rather than defaulted: which participant drove
    // a run is recorded evidence, not a fallback the operator never chose.
    participant_driver: "human",
  };
}

/**
 * The bench, which composes for the lab's current shop and says which one that is.
 *
 * The shop is not in this address: nothing here is identified by one yet, and a shop in the
 * path would be a second address for one screen (ADR 0054). It comes from the lab shell, and
 * where there is none the page says so rather than guessing — a bench that quietly composed
 * for the first shop in the list would freeze a starting state of a world nobody chose.
 */
export function ExperimentSetupPage() {
  const { currentShop, loading } = useLabWorkspace();
  return (
    <>
      <PageHeader
        title="New experiment"
        description={
          currentShop
            ? `Composing for ${currentShop.name}. One scenario, one or two agent configurations, isolated arms. Every referenced version is pinned at start.`
            : "One scenario, one or two agent configurations, isolated arms. Every referenced version is pinned at start."
        }
      />
      {currentShop ? (
        <ExperimentSetup key={currentShop.shop_id} shopId={currentShop.shop_id} />
      ) : loading ? (
        <p className="text-[13px] text-admin-muted">Loading the lab's shops…</p>
      ) : (
        <NoCurrentShop what="there is no shop to compose an experiment for" />
      )}
    </>
  );
}

/**
 * Frame 7 — new experiment: one scenario, one or two agent configurations, isolated arms.
 *
 * The page's job is to make the comparison legible *before* anything is frozen. The matrix
 * is the server's answer rather than a local diff of two payloads, so what the operator
 * reads here is exactly what the gate will judge — including the warning that arms differing
 * in more than one dimension measure none of them.
 *
 * It takes the shop rather than reading one, and is remounted when that shop changes, so
 * every listing and every draft on it belongs to one shop and no answer for the shop before
 * it can arrive late into the form.
 */
function ExperimentSetup({ shopId }: { shopId: string }) {
  const navigate = useNavigate();
  const { listings } = useLabWorkspace();
  const [scenarios, setScenarios] = useState<ScenarioSummarySchema[]>([]);
  const [configurations, setConfigurations] = useState<AgentConfigurationSummarySchema[]>([]);
  const [experiments, setExperiments] = useState<ExperimentSummarySchema[]>([]);
  // Deliberately empty. A seeded name is a name every experiment would quietly carry,
  // whichever scenario it actually ran.
  const [label, setLabel] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [scenarioVersion, setScenarioVersion] = useState("");
  const [scenarioVersions, setScenarioVersions] = useState<DefinitionVersionSummarySchema[]>([]);
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  const [arms, setArms] = useState<ArmDraft[]>(() => [emptyArm()]);
  const [preview, setPreview] = useState<ExperimentPreviewResponse | null>(null);
  // Which setup the gate last answered for, and whether it refused to judge it at all. Start
  // reads the gate's errors only once they are the answer for the setup on screen.
  const [judged, setJudged] = useState<{
    setup: StartExperimentRequest;
    refusal: string | null;
  } | null>(null);
  const [issues, setIssues] = useState<DefinitionIssueSchema[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  // The provider each arm's pinned version names, by arm, as the arm reads it. Held here
  // rather than in the picker because Start is what it blocks.
  // `undefined` while the arm's pinned version is being read: not yet known, which is not the
  // same as `null`, the answer for an arm with nothing to read or whose read failed.
  const [armProviders, setArmProviders] = useState<Record<string, string | null | undefined>>({});
  const reachability = useReachability();
  const unreachable = reachability.status === "loaded" ? reachability.unreachable : null;
  const startNoteId = useId();

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listScenarios(shopId, controller.signal),
      listAgentConfigurations(controller.signal),
      listExperiments(shopId, controller.signal),
    ])
      .then(([scenarioList, configurationList, experimentList]) => {
        setScenarios(scenarioList.scenarios);
        setConfigurations(configurationList.configurations);
        setExperiments(experimentList.experiments);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [shopId]);

  // Only a published version can be frozen, so choosing a scenario means choosing which of
  // its versions to run — never the draft the author is still editing.
  useEffect(() => {
    if (scenarioId === "") {
      setScenarioVersions([]);
      return;
    }
    const controller = new AbortController();
    listScenarioVersions(shopId, scenarioId, controller.signal)
      .then((listed) => {
        setScenarioVersions(listed.versions);
        setScenarioVersion(String(newestVersion(listed.versions) ?? ""));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, [shopId, scenarioId]);

  // What the operator calls the experiment and which starting state it freezes. The gate
  // reads the scenario version and the arms and judges neither of these, so they travel in a
  // ref and the preview below does not re-ask the server a question it has already answered
  // on every keystroke of a name. They are still sent — the preview judges a whole request —
  // but the values it carries are the ones current when the setup last changed.
  //
  // A seed the contract would refuse is not sent to the preview: the gate never reads it, but
  // the request's own validation would refuse the whole preview for it, and a matrix that
  // vanished whenever the seed field was mid-edit would hide the answer to a question the seed
  // has no part in. Start is what refuses it, and says so.
  const naming = useRef({ label, seed });
  naming.current = { label, seed: isSeed(seed) ? seed : String(DEFAULT_SEED) };

  const setup = useMemo(
    () => setupOf({ scenarioId, scenarioVersion, arms, ...naming.current }),
    [arms, scenarioId, scenarioVersion],
  );

  // The matrix follows the choices rather than a button, because an operator comparing two
  // configurations is reading it while they choose.
  useEffect(() => {
    if (setup === null) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    previewExperiment(shopId, setup, controller.signal)
      .then((judgement) => {
        setPreview(judgement);
        setJudged({ setup, refusal: null });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setPreview(null);
          setError(describeApiError(cause, "This setup could not be judged."));
          // A refusal of the setup — a version this shop does not publish, an arm version that
          // is gone — is what a start would answer too, so Start says it. A preview that could
          // not be reached says nothing about the setup, and refuses nothing.
          const refused = cause instanceof LabApiError && cause.status < 500;
          setJudged({ setup, refusal: refused ? cause.message : null });
        }
      });
    return () => controller.abort();
  }, [shopId, setup]);

  // Why Start will not start: a chosen arm pins a version naming a provider this lab cannot
  // reach, which the advance would refuse with 422 and no recorded turn (ADR 0053). One
  // sentence per provider, so two arms on one unreachable provider are one reason, not two.
  // A note on this machine, never an issue: the preview's issues are the gate's, and the gate
  // answers identically wherever it is asked.
  const startBlocked = unreachableArmsNote(
    arms.map((arm) => armProviders[arm.id] ?? null),
    unreachable,
  );
  // The gate has not answered for the setup on screen yet. Start is then a press in flight
  // rather than a refusal (ADR 0063) — unless something else already refuses it, which is said
  // meanwhile, and the gate's own errors join it when it answers.
  const gatePending = setup !== null && judged?.setup !== setup;
  const answered = setup !== null && judged?.setup === setup;
  const reasons = startRefusals({
    scenarioId,
    scenarioVersion,
    seed,
    label,
    chosenArms: arms.filter((arm) => arm.configurationId !== "" && arm.version !== "").length,
    gateIssues: answered ? (preview?.issues ?? []) : [],
    previewRefusal: answered ? (judged?.refusal ?? null) : null,
    unreachable: startBlocked,
  });
  // Nor can it be free while the lab has not yet said which providers it reaches, or an arm's
  // provider has not been read: "not read yet" is not "reachable", and an experiment started in
  // that moment would find its arm refused at the first advance.
  const chosenArms = arms.filter((arm) => arm.configurationId !== "" && arm.version !== "");
  const reachPending =
    chosenArms.length > 0 &&
    (reachability.status === "loading" ||
      chosenArms.some((arm) => armProviders[arm.id] === undefined));
  const checking = (gatePending || reachPending) && reasons.length === 0;

  const start = async (event: FormEvent) => {
    event.preventDefault();
    // The button refuses this itself (ADR 0063); a submission that reaches the form without
    // pressing it — `requestSubmit` — is refused here, for every reason the button gives,
    // rather than left to the lab's 422 or the advance's.
    if (working || checking || reasons.length > 0) {
      return;
    }
    const chosen = setupOf({ scenarioId, scenarioVersion, arms, label, seed });
    if (chosen === null) {
      return;
    }
    setWorking(true);
    setError(null);
    setIssues([]);
    try {
      const started = await startExperiment(shopId, chosen);
      // The lab has one more experiment than it had, and History's figure on the rail is
      // read from the same listing that would say so (ADR 0056).
      void listings.history.refresh();
      navigate(`/lab/bench/${shopId}/${started.experiment_id}`);
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This experiment could not be started."));
      setIssues(cause instanceof LabApiError ? cause.issues : []);
    } finally {
      setWorking(false);
    }
  };

  const editArm = (index: number, next: ArmDraft) => {
    setArms((current) => current.map((arm, position) => (position === index ? next : arm)));
  };

  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <div className="mb-4">
          <IssueList issues={issues} />
        </div>
      ) : null}

      <form className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]" onSubmit={start}>
        <div className="grid min-w-0 content-start gap-4">
          <Card title="Scenario">
            {scenarios.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                {loading
                  ? "Loading scenarios…"
                  : "This shop has no scenario yet. Author and publish one first."}
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <label className={fieldLabelClasses}>
                  Recipe
                  <select
                    className={fieldControlClasses}
                    value={scenarioId}
                    onChange={(event) => setScenarioId(event.target.value)}
                  >
                    <option value="">Choose a scenario…</option>
                    {scenarios.map((scenario) => (
                      <option key={scenario.scenario_id} value={scenario.scenario_id}>
                        {scenario.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={fieldLabelClasses}>
                  Published version
                  <select
                    className={fieldControlClasses}
                    value={scenarioVersion}
                    onChange={(event) => setScenarioVersion(event.target.value)}
                    disabled={scenarioVersions.length === 0}
                  >
                    {scenarioVersions.length === 0 ? (
                      <option value="">No published version</option>
                    ) : null}
                    {[...scenarioVersions]
                      .sort((left, right) => right.version - left.version)
                      .map((published) => (
                        <option key={published.version} value={String(published.version)}>
                          v{published.version}
                        </option>
                      ))}
                  </select>
                </label>
                <FieldHint label="Seed" hint={SEED_RULE}>
                  <input
                    className={fieldControlClasses}
                    type="number"
                    min={0}
                    max={MAX_SEED}
                    step={1}
                    value={seed}
                    title={SEED_RULE}
                    onChange={(event) => setSeed(event.target.value)}
                  />
                </FieldHint>
              </div>
            )}
          </Card>

          <Card
            title="Arms"
            footer={
              <p className="text-xs text-admin-muted">
                Each arm gets its own clone of one snapshot. A change made inside one arm never
                reaches the other, and both start from the same fingerprint.
              </p>
            }
          >
            <label className={fieldLabelClasses}>
              Experiment name
              <input
                className={fieldControlClasses}
                value={label}
                maxLength={EXPERIMENT_LABEL_MAX_LENGTH}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            {arms.map((arm, index) => (
              <ArmPicker
                key={arm.id}
                position={index}
                arm={arm}
                configurations={configurations}
                onChange={(next) => editArm(index, next)}
                onProvider={(provider) =>
                  setArmProviders((current) => ({ ...current, [arm.id]: provider }))
                }
              />
            ))}
            {arms.length < 2 ? (
              <button
                className="inline-flex items-center gap-1.5 justify-self-start text-[13px] font-semibold text-lab-ink underline-offset-2 hover:underline"
                type="button"
                onClick={() => setArms((current) => [...current, emptyArm()])}
              >
                <ButtonIcon verb="create" />
                Add a second arm
              </button>
            ) : null}
          </Card>

          <Card
            title="Comparison variables"
            footer={
              <p className="text-xs text-admin-muted">
                Every difference is recorded on the experiment and shown beside each later
                comparison. Arms differing along more than one dimension can still be run, but
                nothing they produce can be attributed to one of them.
              </p>
            }
          >
            {preview === null ? (
              <p className="text-[13px] text-admin-muted">
                Choose a scenario version and at least one arm to read the matrix.
              </p>
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={tableHeadClasses}>Variable</th>
                    {preview.arm_labels.map((armLabel) => (
                      <th key={armLabel} className={tableHeadClasses}>
                        {armLabel}
                      </th>
                    ))}
                    <th className={tableHeadClasses}>Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.comparison.map((variable) => (
                    <tr key={variable.dimension}>
                      <td className={tableCellClasses}>{dimensionLabel(variable.dimension)}</td>
                      {variable.values.map((value, index) => (
                        <td
                          // Values repeat across arms by design, so the cell is named by the
                          // arm it belongs to rather than by what it happens to say.
                          key={`${variable.dimension}:${preview.arm_labels[index]}`}
                          className={`${tableCellClasses} break-words`}
                        >
                          {value === "" ? "—" : value}
                        </td>
                      ))}
                      <td className={tableCellClasses}>
                        {variable.differs ? (
                          <span className="font-semibold text-admin-draft-ink">Difference</span>
                        ) : (
                          <span className="text-admin-muted">Same</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title="Before starting">
            {preview === null ? (
              <p className="text-[13px] text-admin-muted">
                Nothing is frozen until you start. The gate runs against the versions you chose.
              </p>
            ) : (
              <IssueList issues={preview.issues} />
            )}
            <p className="text-xs text-admin-muted">
              Participant: human operator — you play the customer in both arms.
            </p>
            {/* Refused until it can work, reachable and titled, with every reason at once
                (ADR 0063). */}
            <PrimaryAction
              variant="accent"
              type="submit"
              refusal={
                reasons.length === 0 ? null : { id: startNoteId, reason: reasons.join("\n") }
              }
              busy={working || checking}
            >
              <ButtonIcon verb="start" />
              {working ? "Starting…" : "Start experiment"}
            </PrimaryAction>
            {working || reasons.length === 0 ? null : (
              <ul id={startNoteId} className={`${validationMessageClasses} grid gap-1`}>
                {reasons.map((reason, index) => (
                  // Two arms can raise one finding in one sentence; the position tells them apart.
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt, never reordered
                  <li key={`${index}:${reason}`}>{reason}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent experiments">
            {experiments.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                {loading ? "Loading experiments…" : "No experiment has been started yet."}
              </p>
            ) : (
              <ul className="grid gap-3">
                {experiments.map((experiment) => (
                  <li key={experiment.experiment_id} className="grid gap-1">
                    <button
                      className="text-left text-[13px] font-semibold text-lab-ink underline-offset-2 hover:underline"
                      type="button"
                      onClick={() => navigate(`/lab/bench/${shopId}/${experiment.experiment_id}`)}
                    >
                      {experiment.label}
                    </button>
                    <p className="text-xs text-admin-muted">
                      <Fingerprint value={experiment.sandbox_fingerprint} /> ·{" "}
                      {formatTimestamp(experiment.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </form>
    </>
  );
}

function ArmPicker({
  position,
  arm,
  configurations,
  onChange,
  onProvider,
}: {
  position: number;
  arm: ArmDraft;
  configurations: AgentConfigurationSummarySchema[];
  onChange: (next: ArmDraft) => void;
  /**
   * The provider the pinned version names; `undefined` while it is being read; `null` where no
   * version is chosen or the read failed.
   */
  onProvider: (provider: string | null | undefined) => void;
}) {
  const [versions, setVersions] = useState<DefinitionVersionSummarySchema[]>([]);
  const name = String.fromCharCode(65 + position);
  const selected = configurations.find(
    (configuration) => configuration.configuration_id === arm.configurationId,
  );

  useEffect(() => {
    if (arm.configurationId === "") {
      setVersions([]);
      return;
    }
    const controller = new AbortController();
    listAgentConfigurationVersions(arm.configurationId, controller.signal)
      .then((listed) => setVersions(listed.versions))
      .catch(() => setVersions([]));
    return () => controller.abort();
  }, [arm.configurationId]);

  // The version is what the arm runs, so the provider is read off the version rather than the
  // draft, which may since have moved on. A failed read says nothing rather than something.
  // Held in a ref so a parent re-rendering with a new callback does not read the version again.
  const reportProvider = useRef(onProvider);
  reportProvider.current = onProvider;
  useEffect(() => {
    if (arm.configurationId === "" || arm.version === "") {
      reportProvider.current(null);
      return;
    }
    // Being read: neither reachable nor not, until the version answers.
    reportProvider.current(undefined);
    const controller = new AbortController();
    getAgentConfigurationVersion(arm.configurationId, Number(arm.version), controller.signal)
      .then((published) => reportProvider.current(published.content.model.provider))
      .catch(() => {
        // Read and unknown: it says nothing, and holds nothing up.
        if (!controller.signal.aborted) {
          reportProvider.current(null);
        }
      });
    return () => controller.abort();
  }, [arm.configurationId, arm.version]);

  return (
    <fieldset className="grid gap-2 rounded-lg border border-admin-border p-3">
      <legend className="px-1 text-xs font-semibold text-admin-muted">Arm {name}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className={fieldLabelClasses}>
          Agent configuration
          <select
            className={fieldControlClasses}
            value={arm.configurationId}
            onChange={(event) =>
              onChange({ ...arm, configurationId: event.target.value, version: "" })
            }
          >
            <option value="">Choose a configuration…</option>
            {configurations.map((configuration) => (
              <option
                key={configuration.configuration_id}
                value={configuration.configuration_id}
                // A configuration with no published version cannot be pinned, so it is
                // offered as unavailable rather than hidden: an author looking for the one
                // they just wrote has to see why it is not selectable.
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
            value={arm.version}
            onChange={(event) => onChange({ ...arm, version: event.target.value })}
            disabled={versions.length === 0}
          >
            <option value="">{versions.length === 0 ? "No published version" : "Choose…"}</option>
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
      {selected ? (
        <p className="text-xs text-admin-muted">
          {selected.framework_label} · {selected.model_id} · {selected.tool_count} tool(s)
        </p>
      ) : null}
    </fieldset>
  );
}
