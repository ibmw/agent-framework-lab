import type {
  AgentConfigurationSummarySchema,
  DefinitionIssueSchema,
  DefinitionVersionSummarySchema,
  ExperimentPreviewResponse,
  ExperimentSummarySchema,
  ScenarioSummarySchema,
  StartExperimentRequest,
} from "@agent-lab/contracts";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listAgentConfigurations,
  listAgentConfigurationVersions,
} from "../api/agentConfigurations";
import { describeApiError, LabApiError } from "../api/client";
import { listExperiments, previewExperiment, startExperiment } from "../api/experiments";
import { listScenarios, listScenarioVersions } from "../api/scenarios";
import { TourLaunch } from "../components/TourLaunch";
import { Card, Fingerprint, IssueList, PageHeader } from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "The experiment bench is unavailable.";
const DEFAULT_SEED = 20260828;
const MAX_SEED = 2 ** 32 - 1;

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

function dimensionLabel(dimension: string): string {
  return dimension.replace(/_/g, " ");
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
 * Frame 7 — new experiment: one scenario, one or two agent configurations, isolated arms.
 *
 * The page's job is to make the comparison legible *before* anything is frozen. The matrix
 * is the server's answer rather than a local diff of two payloads, so what the operator
 * reads here is exactly what the gate will judge — including the warning that arms differing
 * in more than one dimension measure none of them.
 */
export function ExperimentSetupPage() {
  const { shopId } = useShopWorkspace();
  const navigate = useNavigate();
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
  const [issues, setIssues] = useState<DefinitionIssueSchema[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

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
  const naming = useRef({ label, seed });
  naming.current = { label, seed };

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
      .then(setPreview)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setPreview(null);
          setError(describeApiError(cause, "This setup could not be judged."));
        }
      });
    return () => controller.abort();
  }, [shopId, setup]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (label.trim() === "") {
      setError("Name the experiment so it can be found again beside the ones before it.");
      return;
    }
    // `Number("")` is 0 and a cleared field is NaN, so an emptied seed would either freeze
    // against a seed nobody chose or reach the contract as null. The seed is a behavioral
    // input; it has to be said out loud.
    if (seed.trim() === "") {
      setError("Enter the seed this experiment's starting state is frozen with.");
      return;
    }
    const chosen = setupOf({ scenarioId, scenarioVersion, arms, label, seed });
    if (chosen === null) {
      setError("Choose a published scenario version and at least one agent configuration.");
      return;
    }
    setWorking(true);
    setError(null);
    setIssues([]);
    try {
      const started = await startExperiment(shopId, chosen);
      navigate(`/shops/${shopId}/bench/${started.experiment_id}`);
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
      <PageHeader
        title="New experiment"
        actions={<TourLaunch id="bench-setup" />}
        description="One scenario, one or two agent configurations, isolated arms. Every referenced version is pinned at start."
      />

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
                <label className={fieldLabelClasses}>
                  Seed
                  <input
                    className={fieldControlClasses}
                    type="number"
                    min={0}
                    max={MAX_SEED}
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                  />
                </label>
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
              />
            ))}
            {arms.length < 2 ? (
              <button
                className="justify-self-start text-[13px] font-semibold text-lab-ink underline-offset-2 hover:underline"
                type="button"
                onClick={() => setArms((current) => [...current, emptyArm()])}
              >
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
            <button className={accentButtonClasses} type="submit" disabled={working}>
              {working ? "Starting…" : "Start experiment"}
            </button>
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
                      onClick={() => navigate(`/shops/${shopId}/bench/${experiment.experiment_id}`)}
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
}: {
  position: number;
  arm: ArmDraft;
  configurations: AgentConfigurationSummarySchema[];
  onChange: (next: ArmDraft) => void;
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
