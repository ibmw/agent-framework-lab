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
import { getScenarioVersion, listScenarios, listScenarioVersions } from "../api/scenarios";
import { getTicketVersion } from "../api/tickets";
import { ButtonIcon } from "../components/ButtonIcon";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
import { PrimaryAction } from "../components/PrimaryAction";
import { Card, Fingerprint, IssueList, PageHeader } from "../components/WorkspaceChrome";
import { COMPARISON_DIMENSION, labelOf } from "../lib/enumLabels";
import {
  type ArmChoice,
  armLetter,
  EXPERIMENT_LABEL_MAX_LENGTH,
  isSeed,
  proposedExperimentName,
  setupOf,
  startRefusals,
} from "../lib/experimentStart";
import { MAX_SEED, SEED_RULE } from "../lib/fieldRules";
import { unreachableArmsNote } from "../lib/modelConnections";
import { onlyChoiceNote, useSingleChoice } from "../lib/singleChoice";
import {
  fieldControlClasses,
  formatTimestamp,
  tableCellClasses,
  tableHeadClasses,
  validationMessageClasses,
} from "../lib/ui";
import { useReachability } from "../lib/useUnreachableProviders";
import { newestVersion, versionOptionLabel } from "../lib/versions";
import { NoCurrentShop } from "../shell/LabWorkspace";
import { useLabWorkspace } from "../shell/useLabWorkspace";

const UNAVAILABLE = "The bench is unavailable.";
const DEFAULT_SEED = 20260828;

/** The prototype's hint beside Arm A (`Workspace.dc.html`, the setup's Arm A row). */
const ARM_A_HINT = "Defaults to the newest published version of the configuration.";
/** The prototype's hint beside Arm B, which says why a second arm is worth adding. */
const ARM_B_HINT =
  "A comparison is only attributable if the arms differ along one dimension. Leave it empty to run arm A alone.";
/** The prototype's hint beside Name. */
const NAME_HINT =
  "How this run is named in History. Derived from the scenario and the arms until you edit it.";
const SCENARIO_HINT = "Only published scenarios can run.";

/**
 * One arm as the form holds it: a published configuration and the version to pin.
 *
 * `id` exists only so React can tell two arms apart while they are still empty. The arm's
 * meaning is its position — "arm A" is where it sits, not what it runs — so the identity
 * cannot be derived from the configuration, which two arms are allowed to share.
 */
interface ArmDraft extends ArmChoice {
  id: string;
}

function emptyArm(): ArmDraft {
  return { id: crypto.randomUUID(), configurationId: "", version: "" };
}

function dimensionLabel(dimension: ComparisonDimension): string {
  return labelOf(COMPARISON_DIMENSION, dimension);
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
 * Asked in the prototype's order (`Workspace.dc.html`, the setup card): the scenario and what
 * it resolves against, arm A, arm B, the name derived from them, and the seed. Every choice
 * the lab can make without guessing is already made when the page opens (ADR 0064): a version
 * opens on the newest published one, a select with one candidate opens on it, two published
 * configurations become the two arms, and the name follows them until the operator types one.
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
  // Empty until the field proposes one: the name is derived from what is chosen, and a seeded
  // constant would be a name every experiment quietly carried whichever scenario it ran.
  const [label, setLabel] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [scenarioVersion, setScenarioVersion] = useState("");
  // `null` while the chosen scenario's versions are being read — or while none is chosen.
  const [scenarioVersions, setScenarioVersions] = useState<DefinitionVersionSummarySchema[] | null>(
    null,
  );
  // What the chosen scenario version resolves against, once it has been read.
  const [resolves, setResolves] = useState<string | null>(null);
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  // Arm A and arm B, always both: arm B left empty is a one-arm run.
  const [arms, setArms] = useState<ArmDraft[]>(() => [emptyArm(), emptyArm()]);
  // Each chosen configuration's published versions, by configuration, once read. A read that
  // failed is an empty list: the arm then has no version to default to, and Start says so.
  const [armVersions, setArmVersions] = useState<Record<string, DefinitionVersionSummarySchema[]>>(
    {},
  );
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
        // One published configuration is arm A; two are the only comparison there is to make,
        // so they are the two arms, in the order the lab lists them. Three or more is a choice
        // the lab does not make. Written only into arms nobody has touched.
        const published = configurationList.configurations.filter(
          (configuration) => configuration.latest_published_version !== null,
        );
        if (published.length === 1 || published.length === 2) {
          setArms((current) =>
            current.every((arm) => arm.configurationId === "")
              ? current.map((arm, position) => ({
                  ...arm,
                  configurationId: published[position]?.configuration_id ?? "",
                  version: "",
                }))
              : current,
          );
        }
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

  // Choosing a scenario clears its version in the same update, so no (new scenario, old
  // version) pair is ever on screen — or sent to the gate, which would refuse it for a
  // version the new scenario never published. The version returns when the new list answers.
  const chooseScenario = (next: string) => {
    setScenarioId(next);
    setScenarioVersion("");
    setScenarioVersions(null);
    setResolves(null);
  };

  const publishedScenarios = scenarios.filter(
    (scenario) => scenario.latest_published_version !== null,
  );
  const onlyScenario = useSingleChoice(
    publishedScenarios.map((scenario) => scenario.scenario_id),
    scenarioId,
    chooseScenario,
  );

  // Only a published version can be frozen, so choosing a scenario means choosing which of
  // its versions to run — never the draft the author is still editing. It opens on the newest,
  // and a version the operator has chosen is never replaced by a list that answers later.
  useEffect(() => {
    if (scenarioId === "") {
      return;
    }
    const controller = new AbortController();
    listScenarioVersions(shopId, scenarioId, controller.signal)
      .then((listed) => {
        setScenarioVersions(listed.versions);
        const newest = newestVersion(listed.versions);
        setScenarioVersion((current) =>
          current === "" && newest !== null ? String(newest) : current,
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setScenarioVersions([]);
          setError(describeApiError(cause, UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, [shopId, scenarioId]);

  const scenario = scenarios.find((entry) => entry.scenario_id === scenarioId);

  // What the chosen version resolves against: the shop and ticket versions it pinned, and the
  // customer version that ticket version pinned in turn. A read that fails says nothing.
  useEffect(() => {
    setResolves(null);
    if (scenario === undefined || scenarioVersion === "") {
      return;
    }
    const controller = new AbortController();
    const { scenario_id, ticket_id, ticket_reference, customer_display_name } = scenario;
    getScenarioVersion(shopId, scenario_id, Number(scenarioVersion), controller.signal)
      .then(async (pinned) => {
        const againstTicket = `shop v${pinned.shop_version}, ticket ${ticket_reference} v${pinned.ticket_version}`;
        try {
          const ticket = await getTicketVersion(
            shopId,
            ticket_id,
            pinned.ticket_version,
            controller.signal,
          );
          setResolves(
            `Resolves against ${againstTicket}, customer ${customer_display_name} v${ticket.customer_profile_version}.`,
          );
        } catch {
          if (!controller.signal.aborted) {
            setResolves(`Resolves against ${againstTicket}.`);
          }
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResolves(null);
        }
      });
    return () => controller.abort();
  }, [shopId, scenario, scenarioVersion]);

  // Each configuration an arm names has its published versions read once, and an arm waiting
  // on one opens on the newest when it answers. Only an arm with no version is written: an
  // operator's choice is never replaced by a list arriving after it.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const receive = (configurationId: string, versions: DefinitionVersionSummarySchema[]) => {
      setArmVersions((current) => ({ ...current, [configurationId]: versions }));
      const newest = newestVersion(versions);
      if (newest === null) {
        return;
      }
      // The same array where no arm waits on this list: a new one would be a new setup, and
      // the gate would be asked again about a setup that has not changed.
      setArms((current) =>
        current.some((arm) => arm.configurationId === configurationId && arm.version === "")
          ? current.map((arm) =>
              arm.configurationId === configurationId && arm.version === ""
                ? { ...arm, version: String(newest) }
                : arm,
            )
          : current,
      );
    };
    for (const { configurationId } of arms) {
      if (configurationId === "" || requested.current.has(configurationId)) {
        continue;
      }
      requested.current.add(configurationId);
      listAgentConfigurationVersions(configurationId)
        .then((listed) => {
          if (mounted.current) {
            receive(configurationId, listed.versions);
          }
        })
        .catch((cause: unknown) => {
          if (mounted.current) {
            receive(configurationId, []);
            setError(describeApiError(cause, "This configuration's versions are unavailable."));
          }
        });
    }
  }, [arms]);

  const chooseConfiguration = (position: number, configurationId: string) => {
    // A configuration whose versions are already read opens on its newest at once; one being
    // read waits for its list, which fills it in.
    const listed = armVersions[configurationId];
    const newest = listed === undefined ? null : newestVersion(listed);
    setArms((current) =>
      current.map((arm, index) =>
        index === position
          ? { ...arm, configurationId, version: newest === null ? "" : String(newest) }
          : arm,
      ),
    );
  };

  const chooseVersion = (position: number, version: string) => {
    setArms((current) =>
      current.map((arm, index) => (index === position ? { ...arm, version } : arm)),
    );
  };

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

  const configurationOf = (arm: ArmChoice) =>
    configurations.find((configuration) => configuration.configuration_id === arm.configurationId);
  const proposedName = proposedExperimentName(
    scenario?.name ?? "",
    arms.map((arm) => ({ configuration: configurationOf(arm)?.name ?? "", version: arm.version })),
  );

  // Why Start will not start: a chosen arm pins a version naming a provider this lab cannot
  // reach, which the advance would refuse with 422 and no recorded turn (ADR 0053). One
  // sentence per provider, so two arms on one unreachable provider are one reason, not two.
  // A note on this machine, never an issue: the preview's issues are the gate's, and the gate
  // answers identically wherever it is asked.
  const startBlocked = unreachableArmsNote(
    arms.map((arm) => armProviders[arm.id] ?? null),
    unreachable,
  );
  // A version being read is not chosen *yet*: a wait, like the gate's, rather than a refusal.
  const scenarioVersionPending = scenarioId !== "" && scenarioVersions === null;
  const armStates = arms.map((arm) => ({
    ...arm,
    versionPending: arm.configurationId !== "" && armVersions[arm.configurationId] === undefined,
  }));
  const versionsPending = scenarioVersionPending || armStates.some((arm) => arm.versionPending);
  // The gate has not answered for the setup on screen yet. Start is then a press in flight
  // rather than a refusal (ADR 0063) — unless something else already refuses it, which is said
  // meanwhile, and the gate's own errors join it when it answers.
  const gatePending = setup !== null && judged?.setup !== setup;
  const answered = setup !== null && judged?.setup === setup;
  const reasons = startRefusals({
    scenarioId,
    scenarioVersion,
    scenarioVersionPending,
    seed,
    label,
    arms: armStates,
    gateIssues: answered ? (preview?.issues ?? []) : [],
    previewRefusal: answered ? (judged?.refusal ?? null) : null,
    unreachable: startBlocked,
  });
  // Nor can it be free while the lab has not yet said which providers it reaches, or an arm's
  // provider has not been read: "not read yet" is not "reachable", and an experiment started in
  // that moment would find its arm refused at the first advance.
  const wholeArms = arms.filter((arm) => arm.configurationId !== "" && arm.version !== "");
  const reachPending =
    wholeArms.length > 0 &&
    (reachability.status === "loading" ||
      wholeArms.some((arm) => armProviders[arm.id] === undefined));
  const checking = (gatePending || reachPending || versionsPending) && reasons.length === 0;

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

  // Which arms the lab chose because nothing else could be chosen, so their hints can say so.
  const publishedConfigurations = configurations.filter(
    (configuration) => configuration.latest_published_version !== null,
  );
  const onlyConfiguration =
    publishedConfigurations.length === 1 &&
    arms[0].configurationId === publishedConfigurations[0].configuration_id;
  const onlyPair =
    publishedConfigurations.length === 2 &&
    arms[0].configurationId === publishedConfigurations[0].configuration_id &&
    arms[1].configurationId === publishedConfigurations[1].configuration_id;
  const scenarioVersionNewest = newestVersion(scenarioVersions ?? []);

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
          <Card label="Experiment setup">
            <FieldRows>
              <FieldGroup
                label="Scenario"
                hint={
                  onlyScenario
                    ? `${SCENARIO_HINT} ${onlyChoiceNote("published scenario in the shop")}`
                    : SCENARIO_HINT
                }
                extra={
                  scenarios.length === 0
                    ? loading
                      ? "Loading scenarios…"
                      : "This shop has no scenario yet. Author and publish one first."
                    : (resolves ?? undefined)
                }
              >
                <div className="flex flex-wrap gap-3">
                  <select
                    aria-label="Scenario"
                    className={`${fieldControlClasses} min-w-56 flex-[2]`}
                    value={scenarioId}
                    onChange={(event) => chooseScenario(event.target.value)}
                  >
                    <option value="">Choose a scenario…</option>
                    {scenarios.map((entry) => (
                      <option
                        key={entry.scenario_id}
                        value={entry.scenario_id}
                        // Offered as unavailable rather than hidden, as an unpublished
                        // configuration is: only a published scenario can run.
                        disabled={entry.latest_published_version === null}
                      >
                        {entry.name}
                        {entry.latest_published_version === null ? " (unpublished)" : ""}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Published version"
                    className={`${fieldControlClasses} min-w-40 flex-1`}
                    value={scenarioVersion}
                    onChange={(event) => setScenarioVersion(event.target.value)}
                    disabled={scenarioVersion === ""}
                  >
                    {scenarioVersion === "" ? (
                      <option value="">
                        {scenarioVersionPending
                          ? "Reading published versions…"
                          : "No published version"}
                      </option>
                    ) : null}
                    {[...(scenarioVersions ?? [])]
                      .sort((left, right) => right.version - left.version)
                      .map((published) => (
                        <option key={published.version} value={String(published.version)}>
                          {versionOptionLabel(published.version, scenarioVersionNewest)}
                        </option>
                      ))}
                  </select>
                </div>
              </FieldGroup>

              {arms.map((arm, position) => (
                <ArmPicker
                  key={arm.id}
                  position={position}
                  arm={arm}
                  configurations={configurations}
                  versions={arm.configurationId === "" ? [] : armVersions[arm.configurationId]}
                  hint={
                    position === 0
                      ? onlyConfiguration
                        ? `${ARM_A_HINT} ${onlyChoiceNote("published agent configuration in the lab")}`
                        : ARM_A_HINT
                      : onlyPair
                        ? `${ARM_B_HINT} ${ONLY_PAIR_NOTE}`
                        : ARM_B_HINT
                  }
                  onConfiguration={(configurationId) =>
                    chooseConfiguration(position, configurationId)
                  }
                  onVersion={(version) => chooseVersion(position, version)}
                  onProvider={(provider) =>
                    setArmProviders((current) => ({ ...current, [arm.id]: provider }))
                  }
                />
              ))}

              <DerivedIdField
                label="Name"
                hint={NAME_HINT}
                arrangement="row"
                value={label}
                suggested={proposedName}
                maxLength={EXPERIMENT_LABEL_MAX_LENGTH}
                preview={false}
                onChange={setLabel}
              />

              <Field label="Seed" hint={SEED_RULE}>
                <input
                  className={`${fieldControlClasses} max-w-[200px] text-right font-mono`}
                  type="number"
                  min={0}
                  max={MAX_SEED}
                  step={1}
                  value={seed}
                  title={SEED_RULE}
                  onChange={(event) => setSeed(event.target.value)}
                />
              </Field>
            </FieldRows>
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
              Each arm gets its own clone of one snapshot. A change made inside one arm never
              reaches the other, and both start from the same fingerprint.
            </p>
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

/** Arm B's hint when the lab's two published configurations are the two arms. */
const ONLY_PAIR_NOTE =
  "These two are the only published agent configurations in the lab, so both arms are already chosen.";

/**
 * One arm, as a row: which configuration it runs, and which published version of it.
 *
 * The versions are the page's, read once per configuration: `undefined` while they are being
 * read, a list once they are. The version select has no empty option once there is a version
 * to hold, so a chosen arm always names one.
 */
function ArmPicker({
  position,
  arm,
  configurations,
  versions,
  hint,
  onConfiguration,
  onVersion,
  onProvider,
}: {
  position: number;
  arm: ArmDraft;
  configurations: AgentConfigurationSummarySchema[];
  versions: DefinitionVersionSummarySchema[] | undefined;
  hint: string;
  onConfiguration: (configurationId: string) => void;
  onVersion: (version: string) => void;
  /**
   * The provider the pinned version names; `undefined` while it is being read; `null` where no
   * version is chosen or the read failed.
   */
  onProvider: (provider: string | null | undefined) => void;
}) {
  const name = armLetter(position);
  const selected = configurations.find(
    (configuration) => configuration.configuration_id === arm.configurationId,
  );
  const newest = newestVersion(versions ?? []);

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
    <FieldGroup
      label={`Arm ${name}`}
      hint={hint}
      extra={
        selected
          ? `${selected.framework_label} · ${selected.model_id} · ${selected.tool_count} tool(s)`
          : undefined
      }
    >
      <div className="flex flex-wrap gap-3">
        <select
          aria-label="Agent configuration"
          className={`${fieldControlClasses} min-w-56 flex-[2]`}
          value={arm.configurationId}
          onChange={(event) => onConfiguration(event.target.value)}
        >
          <option value="">{position === 0 ? "Choose a configuration…" : "No second arm"}</option>
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
        <select
          aria-label="Published version"
          className={`${fieldControlClasses} min-w-40 flex-1`}
          value={arm.version}
          onChange={(event) => onVersion(event.target.value)}
          disabled={arm.version === ""}
        >
          {arm.version === "" ? (
            <option value="">
              {arm.configurationId === ""
                ? "—"
                : versions === undefined
                  ? "Reading published versions…"
                  : "No published version"}
            </option>
          ) : null}
          {[...(versions ?? [])]
            .sort((left, right) => right.version - left.version)
            .map((published) => (
              <option key={published.version} value={String(published.version)}>
                {versionOptionLabel(published.version, newest)}
              </option>
            ))}
        </select>
      </div>
    </FieldGroup>
  );
}
