import type { JudgeConfigurationSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { createJudgeConfiguration, listJudgeConfigurations } from "../api/judgeConfigurations";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";

const UNAVAILABLE = "The judge service is unavailable.";

export function JudgeConfigurationsPage() {
  const [judges, setJudges] = useState<JudgeConfigurationSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    setJudges((await listJudgeConfigurations(signal)).judges);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
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
  }, [reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createJudgeConfiguration({ name });
      setName("");
      await reload();
    } catch (cause: unknown) {
      setError(describeApiError(cause, "The judge could not be created."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Judges"
        description="What scores the objectives no rule can decide: a rubric, a model, and the parts of an arm's record the judge is shown. Judges are cross-shop, and every verdict records the exact version that produced it — so a result stays explainable after the rubric moves on."
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading judges…</p>
          ) : judges.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No judge yet. Create one to score the objectives a scenario leaves to a judge.
            </p>
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
                {judges.map((judge) => (
                  <tr key={judge.judge_id}>
                    <td className={tableCellClasses}>
                      <Link
                        className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                        to={judge.judge_id}
                      >
                        {judge.name}
                      </Link>
                    </td>
                    <td className={tableCellClasses}>{judge.provider_label}</td>
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
            <label className={fieldLabelClasses}>
              Name
              <input
                className={fieldControlClasses}
                value={name}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button className={accentButtonClasses} type="submit" disabled={creating}>
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
