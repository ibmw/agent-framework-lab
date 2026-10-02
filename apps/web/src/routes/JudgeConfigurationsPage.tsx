import type {
  JudgeConfigurationPayloadSchema,
  JudgeConfigurationResourcesResponse,
  JudgeConfigurationSummarySchema,
} from "@agent-lab/contracts";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  createJudgeConfiguration,
  readJudgeConfigurationResources,
  replaceJudgeConfigurationDraft,
} from "../api/judgeConfigurations";
import { ButtonIcon } from "../components/ButtonIcon";
import { CreatePage } from "../components/CreatePage";
import { Field, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { ProvenModelField } from "../components/ProvenModelField";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader, PublicationPill } from "../components/WorkspaceChrome";
import { describeProvider } from "../lib/agents";
import { useCreateThenComplete } from "../lib/createDefinition";
import { LABEL_MAX_LENGTH, RUBRIC_MAX_LENGTH } from "../lib/fieldRules";
import { filterList } from "../lib/filters";
import { pythonStrip } from "../lib/pythonText";
import {
  accentButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
  textAreaClasses,
} from "../lib/ui";
import { useLabWorkspace } from "../shell/useLabWorkspace";

const UNAVAILABLE = "The judge service is unavailable.";

type Filter = "all" | "published" | "draft";

/**
 * The prototype's judge chips (`tmp/design-frames/Workspace.dc.html`:6260–6262), less one,
 * and *Never published* after *Usable*, which every index whose listing carries a published
 * version draws (PLAN-UX Milestone 9, the index template; `docs/design-direction.md`, *Names*).
 *
 * *No rubric* is not here. The rubric is the whole of what a judge is, so a judge without one
 * is exactly the row an author wants picked out — but `JudgeConfigurationSummarySchema`
 * carries the model, the provider and an evidence count and says nothing about the rubric.
 * The chip arrives with the field, not before it.
 */
const FILTERS: FilterChipDefinition<Filter, JudgeConfigurationSummarySchema>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  {
    id: "published",
    label: "Usable",
    kind: "published",
    matches: (judge) => judge.latest_published_version !== null,
  },
  {
    id: "draft",
    label: "Never published",
    kind: "draft",
    matches: (judge) => judge.latest_published_version === null,
  },
];

export function JudgeConfigurationsPage() {
  // The library this page renders is the one the lab's rail counts, read once by the lab's
  // shell and read again here whenever this page changes what it lists (ADR 0056).
  const { listings } = useLabWorkspace();
  const judges = listings.judges.rows;
  const loading = listings.judges.loading;
  const loadError = listings.judges.error;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // The name alone, which is what the prototype's judges search reads (its `shownJudges`
  // filter).
  const { chips, visible } = filterList(judges, FILTERS, filter, {
    query,
    fields: (judge) => [judge.name],
  });

  return (
    <>
      <PageHeader
        title="Judges"
        description="What scores the objectives no rule can decide: a rubric, a model, and the parts of an arm's record the judge is shown. Judges are cross-shop, and every verdict records the exact version that produced it — so a result stays explainable after the rubric moves on."
        actions={
          <Link className={accentButtonClasses} to="new">
            <ButtonIcon verb="create" />
            New judge
          </Link>
        }
      />

      <section className={`${surfaceClasses} overflow-hidden`}>
        {/* Only once there are rows to search and count. A chip is a filter, and a row of
              zeros over "Loading…" — or over a listing that failed — filters nothing and
              answers nothing; it is the stat band this slice exists to avoid, drawn at its
              least useful moment. The search box keeps the same company: a box that can only
              narrow nothing is a control that does nothing. Both arrive with the table they
              belong to; the title beside the box is the card's, drawn in every state. */}
        <SearchRow title="What a scenario leaves to a judge">
          {loading || loadError ? null : (
            <SearchField label="Search judges" onChange={setQuery} value={query} />
          )}
        </SearchRow>
        {loading || loadError ? null : (
          <FilterChips
            legend="Filter judges"
            chips={chips}
            selected={filter}
            onSelect={setFilter}
          />
        )}
        {loadError ? (
          // Its failure and nothing else: a listing that could not be read has not said the
          // lab holds no judge.
          <p role="alert" className="p-4 text-[13px] text-lab-error">
            {loadError}
          </p>
        ) : loading ? (
          <p className="p-4 text-[13px] text-admin-muted">Loading judges…</p>
        ) : judges.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">
            No judge yet. Create one to score the objectives a scenario leaves to a judge.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">No judge matches this view.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={tableHeadClasses}>Judge</th>
                <th className={tableHeadClasses}>Provider</th>
                <th className={tableHeadClasses}>Model</th>
                <th className={tableHeadClasses}>Shown</th>
                <th className={tableHeadClasses}>Published</th>
                <th className={tableHeadClasses}>Draft updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((judge) => (
                <tr key={judge.judge_id}>
                  <td className={tableCellClasses}>
                    <Link
                      className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                      to={judge.judge_id}
                    >
                      {judge.name}
                    </Link>
                  </td>
                  {/* One spelling for the workspace: the index and the editor must not disagree
                        about a provider, and `lib/agents.ts` is where that word is decided. */}
                  <td className={tableCellClasses}>{describeProvider(judge.provider)}</td>
                  <td className={tableCellClasses}>{judge.model_id}</td>
                  <td className={tableCellClasses}>{judge.evidence_count} kind(s) of evidence</td>
                  <td className={tableCellClasses}>
                    <PublicationPill record={judge} />
                  </td>
                  <td className={tableCellClasses}>{formatTimestamp(judge.updated_at)}</td>
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
 * `/lab/judges/new` — the judge, authored on a page (`Workspace.dc.html`:3468).
 *
 * **The rubric is asked for here, and Create is refused without it** (PLAN-UX Slice 13's own
 * evidence: an operator creating a judge is told the rubric is missing beside the button that
 * will not press). That is a **departure** from the prototype, which draws the same field
 * under a note saying it can be left empty for now — and it is the rule
 * `docs/design-direction.md` already states about a create form: it asks for what constrains
 * the work that follows. A judge with no rubric constrains nothing. It is also what the lab
 * itself says about the value, in `new_judge_configuration`: the rubric is the whole of what a
 * judge is, so it is written rather than defaulted. The model and the evidence *are*
 * defaulted, for the reason given in the same place — they have a right answer the lab has
 * proven — which is why the Evidence card the prototype draws here is the editor's.
 *
 * **Creating a judge is therefore always two writes.** `CreateJudgeConfigurationRequest`
 * carries a name and nothing else, so the page makes the judge and then puts the rubric on
 * it; `useCreateThenComplete` holds that shape, the retry that finishes the first press
 * rather than making a second judge, and the stand-down when the operator leaves.
 */
export function NewJudgePage() {
  const { listings } = useLabWorkspace();
  const formId = useId();
  const [resources, setResources] = useState<JudgeConfigurationResourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [rubric, setRubric] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    readJudgeConfigurationResources(controller.signal)
      .then((answer) => {
        setResources(answer);
        // Opened on what the lab proves first, which is what the create request defaults to
        // anyway. Written only while the field is still empty, so a late answer never
        // overwrites a choice already made.
        setProvider((current) => current || (answer.judges[0]?.provider ?? ""));
        setModelId((current) => current || (answer.judges[0]?.models[0] ?? ""));
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

  const proven = resources?.judges ?? [];
  const chosen = proven.find((entry) => entry.provider === provider);

  const creating = useCreateThenComplete<JudgeConfigurationPayloadSchema>(
    {
      create: async () => {
        const created = await createJudgeConfiguration({ name: pythonStrip(name) });
        return { id: created.judge_id, draft: created.content };
      },
      compose: (made) => ({
        ...made,
        name: pythonStrip(name),
        // Stripped as Python strips it: `require_text` refuses a rubric with surrounding
        // whitespace, and the one the operator typed often ends on a newline.
        rubric: pythonStrip(rubric),
        model: { ...made.model, provider, model_id: pythonStrip(modelId) },
      }),
      replace: replaceJudgeConfigurationDraft,
      refresh: listings.judges.refresh,
      editorAt: (id) => `/lab/judges/${id}`,
      owes: () => `Judge ${name} was created without the rubric written for it.`,
      standing: "created · its rubric is not saved yet",
      whenCreateFails: "The judge could not be created.",
      whenCompleteFails: "The judge was created, but its rubric could not be saved.",
    },
    () =>
      loading
        ? "Reading what this lab has proven it can judge with…"
        : resourcesError !== null
          ? "What a judge may name could not be read, so nothing can be created here yet."
          : pythonStrip(name) === ""
            ? "The judge needs a name before it can be created."
            : pythonStrip(rubric) === ""
              ? "The judge has no rubric yet, and the rubric is the whole of what a judge is: nothing can be scored until it is written."
              : pythonStrip(modelId) === ""
                ? "The judge needs the model that will score with it."
                : undefined,
  );

  return (
    <CreatePage
      backTo="/lab/judges"
      backLabel="Judges"
      breadcrumb="creating a judge"
      title={name}
      untitled="New judge"
      standing={creating.standing}
      formId={formId}
      createLabel="Create judge"
      creating={creating.busy}
      creatingLabel="Creating…"
      blockedBy={creating.blockedBy}
      error={creating.error ?? resourcesError}
    >
      <form id={formId} className="grid gap-4" onSubmit={creating.submit}>
        <Card title="Judge">
          <FieldRows>
            <Field
              label="Name"
              hint="How this judge is listed. An objective names the judge that scores it."
            >
              <input
                maxLength={LABEL_MAX_LENGTH}
                className={`${fieldControlClasses} w-full`}
                value={name}
                required
                placeholder="Resolution quality"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Provider"
              hint="The lab's own word for the provider, so no two screens spell it differently. Only providers the lab has proven it can judge with are offered."
            >
              <select
                className={`${fieldControlClasses} w-full`}
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value);
                  // A model belongs to its provider, so it follows one here exactly as it
                  // does in the judge editor.
                  setModelId(
                    proven.find((entry) => entry.provider === event.target.value)?.models[0] ?? "",
                  );
                }}
              >
                {proven.map((entry) => (
                  <option key={entry.provider} value={entry.provider}>
                    {describeProvider(entry.provider)}
                  </option>
                ))}
              </select>
            </Field>
            <ProvenModelField
              arrangement="row"
              value={modelId}
              models={chosen?.models ?? []}
              proven={chosen === undefined ? provider : describeProvider(chosen.provider)}
              onChange={setModelId}
            />
          </FieldRows>
        </Card>

        <Card title="Rubric">
          <FieldRows>
            <Field
              label="Criteria"
              hint="Write what a met objective looks like, not what a good agent looks like. The judge scores one arm's record at a time, and it is the whole of what this judge is — a judge with no rubric cannot be created here and could not be published either."
            >
              <textarea
                maxLength={RUBRIC_MAX_LENGTH}
                className={`${textAreaClasses} w-full`}
                value={rubric}
                rows={7}
                required
                placeholder="Score met when the agent reached the outcome the policy allows and said what happens next."
                onChange={(event) => setRubric(event.target.value)}
              />
            </Field>
          </FieldRows>
        </Card>

        <Card title="Created as a draft">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            The evidence this judge is shown starts at what the lab has proven, and is changed in
            the editor. A judge runs after the conversation has ended, on an anonymised record, and
            every verdict names the version that produced it — so publishing is what makes one
            usable.
          </p>
        </Card>
      </form>
    </CreatePage>
  );
}
