import type {
  AgentConfigurationPayloadSchema,
  AgentConfigurationResourcesResponse,
  AgentConfigurationSummarySchema,
  ProvenFrameworkSchema,
} from "@agent-lab/contracts";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import {
  createAgentConfiguration,
  readAgentConfigurationResources,
  replaceAgentConfigurationDraft,
} from "../api/agentConfigurations";
import { describeApiError } from "../api/client";
import { CreatePage } from "../components/CreatePage";
import { Field, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips, filterList } from "../components/FilterChips";
import { ProvenModelField } from "../components/ProvenModelField";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import { describeProvider } from "../lib/agents";
import { useCreateThenComplete } from "../lib/createDefinition";
import { SUPPORT_IDENTITY_PIN_RULE } from "../lib/fieldRules";
import {
  accentButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  readOnlyValueClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useLabWorkspace } from "../shell/LabWorkspace";

const UNAVAILABLE = "The agent-configuration service is unavailable.";

type Filter = "all" | "published" | "draft";

/**
 * The prototype's configuration chips (`tmp/design-frames/Workspace.dc.html`:6221–6224), less
 * one.
 *
 * *Pydantic AI* is not here. It filters the prototype's fixture by one framework of the two
 * it holds; this lab proves three — Pydantic AI, the OpenAI Agents SDK and the deterministic
 * fake — and a chip for one of them would hard-code a backend label on the index while
 * leaving the other two unreachable. A framework chip belongs to whichever slice gives this
 * page a framework control, and it is one chip per framework or none.
 */
const FILTERS: FilterChipDefinition<Filter, AgentConfigurationSummarySchema>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  {
    id: "published",
    label: "Adoptable",
    kind: "published",
    matches: (configuration) => configuration.latest_published_version !== null,
  },
  {
    id: "draft",
    label: "Never published",
    kind: "draft",
    matches: (configuration) => configuration.latest_published_version === null,
  },
];

export function AgentConfigurationsPage() {
  // The library this page renders is the one the lab's rail counts, read once by the lab's
  // shell and read again here whenever this page changes what it lists (ADR 0056). What a
  // configuration may *adopt* is a different read, and it belongs to the create page that
  // asks — this index no longer makes it.
  const { listings } = useLabWorkspace();
  const configurations = listings.agentConfigurations.rows;
  const loading = listings.agentConfigurations.loading;
  const loadError = listings.agentConfigurations.error;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // Name and model, the two the prototype's configurations search reads (its `shownAgents`
  // filter).
  const { chips, visible } = filterList(configurations, FILTERS, filter, {
    query,
    fields: (configuration) => [configuration.name, configuration.model_id],
  });

  return (
    <>
      <PageHeader
        title="Agent configurations"
        description="What runs the support agent: framework, architecture, model, prompt, tools, and the support identity it adopts. Configurations are cross-shop — prompt variables resolve at experiment start and the resolved configuration is pinned to the run."
        actions={
          <Link className={accentButtonClasses} to="new">
            New configuration
          </Link>
        }
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <section className={`${surfaceClasses} overflow-hidden`}>
        {/* Only once there are rows to search and count. A chip is a filter, and a row of
              zeros over "Loading…" — or over a listing that failed — filters nothing and
              answers nothing; it is the stat band this slice exists to avoid, drawn at its
              least useful moment. The search box keeps the same company: a box that can only
              narrow nothing is a control that does nothing. Both arrive with the table they
              belong to. */}
        {loading || loadError ? null : (
          <>
            <SearchRow>
              <SearchField label="Search configurations" onChange={setQuery} value={query} />
            </SearchRow>
            <FilterChips
              legend="Filter agent configurations"
              chips={chips}
              selected={filter}
              onSelect={setFilter}
            />
          </>
        )}
        {loading ? (
          <p className="p-4 text-[13px] text-admin-muted">Loading agent configurations…</p>
        ) : configurations.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">
            No agent configuration yet. Create one to describe the agent an experiment runs.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">No configuration matches this view.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={tableHeadClasses}>Configuration</th>
                <th className={tableHeadClasses}>Framework</th>
                <th className={tableHeadClasses}>Model</th>
                <th className={tableHeadClasses}>Tools</th>
                <th className={tableHeadClasses}>Published</th>
                <th className={tableHeadClasses}>Draft updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((configuration) => (
                <tr key={configuration.configuration_id}>
                  <td className={tableCellClasses}>
                    <Link
                      className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                      to={configuration.configuration_id}
                    >
                      {configuration.name}
                    </Link>
                  </td>
                  <td className={tableCellClasses}>{configuration.framework_label}</td>
                  <td className={tableCellClasses}>{configuration.model_id}</td>
                  <td className={tableCellClasses}>{configuration.tool_count} enabled</td>
                  <td className={tableCellClasses}>
                    {configuration.latest_published_version === null
                      ? "Never published"
                      : `v${configuration.latest_published_version} · ${configuration.published_version_count} version(s)`}
                  </td>
                  <td className={tableCellClasses}>{formatTimestamp(configuration.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/**
 * `/lab/agent-configurations/new` — the configuration, authored on a page
 * (`Workspace.dc.html`:3293).
 *
 * **Name and model are what it asks for** (PLAN-UX Slice 13; the README's *Interactions*:
 * "an agent configuration needs a name and a model"), plus the identity, which the create
 * request carries and a configuration cannot exist without. The model follows the framework,
 * because a framework is what the lab has proven a model *against* — so choosing one is the
 * question and the model is its answer, offered as the datalist `ProvenModelField` draws
 * everywhere else: the gate only warns about an unexercised model, and a select would refuse
 * in the browser what the API would take.
 *
 * **Creating a configuration is two writes.** `CreateAgentConfigurationRequest` carries a
 * name and an identity and nothing else; the framework and the model live in the payload a
 * `PUT` replaces. So the page makes the configuration and completes it —
 * `useCreateThenComplete` holds that shape and the rules that come with it, including the
 * one where the answers are left alone: a create on the framework and model the lab already
 * defaults to sends one write and registers nothing.
 *
 * The prototype's Architecture and Tools rows are not here. The lab implements one
 * architecture — *a choice of one is not a choice* — and a new draft's tools are a decided
 * default the lab documents as deliberate: every read on, every write off. Turning a write
 * on is the act the editor exists for, and the card below says so.
 */
export function NewAgentConfigurationPage() {
  const { listings } = useLabWorkspace();
  const formId = useId();
  const [resources, setResources] = useState<AgentConfigurationResourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [frameworkId, setFrameworkId] = useState("");
  const [modelId, setModelId] = useState("");
  const [identityId, setIdentityId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    readAgentConfigurationResources(controller.signal)
      .then((answer) => {
        setResources(answer);
        // Opened on what the lab proves first and on the identity it lists first, which is
        // what the create request would have chosen anyway. Written only while the field is
        // still empty, so an answer arriving late never overwrites one already typed.
        setFrameworkId((current) => current || (answer.frameworks[0]?.framework_id ?? ""));
        setModelId((current) => current || (answer.frameworks[0]?.models[0] ?? ""));
        setIdentityId((current) => current || (answer.support_identities[0]?.identity_id ?? ""));
        setResourcesError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setResourcesError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  const frameworks = resources?.frameworks ?? [];
  const identities = resources?.support_identities ?? [];
  const framework: ProvenFrameworkSchema | undefined = frameworks.find(
    (entry) => entry.framework_id === frameworkId,
  );
  // A framework is proven on its own providers, and each of the three this lab holds is
  // proven on exactly one — so the row reports what the framework decided rather than
  // offering a list of one.
  const provider = framework?.providers[0] ?? "";

  const creating = useCreateThenComplete<AgentConfigurationPayloadSchema>(
    {
      create: async () => {
        const created = await createAgentConfiguration({
          name,
          support_identity_id: identityId,
        });
        return { id: created.configuration_id, draft: created.content };
      },
      compose: (made) => ({
        ...made,
        name,
        framework_id: frameworkId,
        model: {
          ...made.model,
          provider: provider === "" ? made.model.provider : provider,
          model_id: modelId,
        },
      }),
      replace: replaceAgentConfigurationDraft,
      refresh: listings.agentConfigurations.refresh,
      editorAt: (id) => `/lab/agent-configurations/${id}`,
      owes: `Agent configuration ${name} was created without the runtime chosen for it.`,
      standing: "created · its runtime is not saved yet",
      whenCreateFails: "The agent configuration could not be created.",
      whenCompleteFails: "The configuration was created, but its runtime could not be saved.",
    },
    () =>
      loading
        ? "Reading what this lab has proven it can run…"
        : resourcesError !== null
          ? "What a configuration may name could not be read, so nothing can be created here yet."
          : identities.length === 0
            ? "Author a support identity first: a configuration adopts exactly one."
            : name.trim() === ""
              ? "The configuration needs a name before it can be created."
              : modelId.trim() === ""
                ? "The configuration needs the model its arms will run on."
                : undefined,
  );

  function chooseFramework(next: string) {
    setFrameworkId(next);
    // A model means nothing outside the framework it was proven against, so it follows one
    // here exactly as it follows the provider in the editor.
    setModelId(frameworks.find((entry) => entry.framework_id === next)?.models[0] ?? "");
  }

  return (
    <CreatePage
      backTo="/lab/agent-configurations"
      backLabel="Agent configurations"
      breadcrumb="creating a configuration"
      title={name}
      untitled="New agent configuration"
      standing={creating.standing}
      formId={formId}
      createLabel="Create configuration"
      creating={creating.busy}
      creatingLabel="Creating…"
      blockedBy={creating.blockedBy}
      error={creating.error ?? resourcesError}
    >
      <form id={formId} className="grid gap-4" onSubmit={creating.submit}>
        <Card title="Runtime">
          <FieldRows>
            <Field
              label="Name"
              hint="How this configuration is listed on the bench and in history."
            >
              <input
                className={fieldControlClasses}
                value={name}
                required
                placeholder="Frontline single agent"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Framework"
              hint="What drives the agent loop. Only frameworks this build has proven end to end are offered, and the deterministic fake replays a fixed script — which is what makes it an honest control arm."
            >
              <select
                className={fieldControlClasses}
                value={frameworkId}
                onChange={(event) => chooseFramework(event.target.value)}
              >
                {frameworks.map((entry) => (
                  <option key={entry.framework_id} value={entry.framework_id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Provider"
              hint="Where the model is reached. The framework decides it: each one this lab has proven runs on a single provider, so there is nothing to choose."
            >
              {/* Not a control: a select with one option is a choice of one, and the
                  prototype draws this row as a read-only box wherever the provider is
                  fixed (`Workspace.dc.html`:3325). */}
              <output className={readOnlyValueClasses}>
                {provider === "" ? "—" : describeProvider(provider)}
              </output>
            </Field>
            <ProvenModelField
              value={modelId}
              models={framework?.models ?? []}
              proven={framework?.label ?? frameworkId}
              onChange={setModelId}
            />
          </FieldRows>
        </Card>

        <Card title="Identity">
          <FieldRows>
            <Field
              label="Adopted identity"
              hint={
                creating.created
                  ? `The configuration adopts this identity now: it is what the create request carried, and the write that follows cannot move one. ${SUPPORT_IDENTITY_PIN_RULE}`
                  : identities.length === 0
                    ? `No identity is adoptable yet, and a configuration adopts exactly one. ${SUPPORT_IDENTITY_PIN_RULE}`
                    : SUPPORT_IDENTITY_PIN_RULE
              }
            >
              <select
                className={fieldControlClasses}
                value={identityId}
                disabled={creating.created}
                onChange={(event) => setIdentityId(event.target.value)}
              >
                {identities.map((identity) => (
                  <option key={identity.identity_id} value={identity.identity_id}>
                    {identity.name} · {identity.title}
                  </option>
                ))}
              </select>
            </Field>
          </FieldRows>
        </Card>

        <Card title="Created as a draft">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            A new draft can read the arm through every read tool and move it through none. Writes
            are enabled deliberately, in the editor — where the prompt is written too, and an
            unpublished configuration cannot be an arm on the bench.
          </p>
        </Card>
      </form>
    </CreatePage>
  );
}
