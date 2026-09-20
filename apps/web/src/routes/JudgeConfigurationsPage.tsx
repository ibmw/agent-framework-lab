import type { JudgeConfigurationSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { createJudgeConfiguration, listJudgeConfigurations } from "../api/judgeConfigurations";
import { ButtonIcon } from "../components/ButtonIcon";
import { FieldHint } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips, filterList } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import { describeProvider } from "../lib/agents";
import {
  accentButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";

const UNAVAILABLE = "The judge service is unavailable.";

type Filter = "all" | "published";

/**
 * The prototype's judge chips (`tmp/design-frames/Workspace.dc.html`:6260–6262), less one.
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
];

export function JudgeConfigurationsPage() {
  const [judges, setJudges] = useState<JudgeConfigurationSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    setJudges((await listJudgeConfigurations(signal)).judges);
    setLoadError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      await createJudgeConfiguration({ name });
      setName("");
    } catch (cause: unknown) {
      setFormError(describeApiError(cause, "The judge could not be created."));
      setCreating(false);
      return;
    }
    try {
      await reload();
    } catch (cause: unknown) {
      setLoadError(describeApiError(cause, UNAVAILABLE));
    } finally {
      setCreating(false);
    }
  }

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
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
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
                <SearchField label="Search judges" onChange={setQuery} value={query} />
              </SearchRow>
              <FilterChips
                legend="Filter judges"
                chips={chips}
                selected={filter}
                onSelect={setFilter}
              />
            </>
          )}
          {loading ? (
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
                      {judge.latest_published_version === null
                        ? "Never published"
                        : `v${judge.latest_published_version} · ${judge.published_version_count} version(s)`}
                    </td>
                    <td className={tableCellClasses}>{formatTimestamp(judge.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <Card title="New judge">
          <form className="grid gap-3" onSubmit={submit}>
            <FieldHint
              label="Name"
              hint="How this judge is listed. The rubric is written in the editor."
            >
              <input
                className={fieldControlClasses}
                value={name}
                required
                placeholder="Resolution quality"
                onChange={(event) => setName(event.target.value)}
              />
            </FieldHint>
            {formError ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {formError}
              </p>
            ) : null}
            <button className={accentButtonClasses} type="submit" disabled={creating}>
              <ButtonIcon verb="save" />
              {creating ? "Creating…" : "Create judge"}
            </button>
            <p className="text-xs text-admin-muted">
              A new draft carries the model and evidence the lab has proven, and no rubric: the
              rubric is the whole of what a judge is, so it is written rather than defaulted.
            </p>
          </form>
        </Card>
      </div>
    </>
  );
}
