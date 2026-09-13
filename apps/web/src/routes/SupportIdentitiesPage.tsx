import type { SupportIdentitySummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { createSupportIdentity, listSupportIdentities } from "../api/supportIdentities";
import { TourLaunch } from "../components/TourLaunch";
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

const UNAVAILABLE = "The support-identity service is unavailable.";

export function SupportIdentitiesPage() {
  const [identities, setIdentities] = useState<SupportIdentitySummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    setIdentities((await listSupportIdentities(signal)).identities);
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
      await createSupportIdentity({ role: { name, title, description: "" } });
      setName("");
      setTitle("");
      await reload();
    } catch (cause: unknown) {
      setError(describeApiError(cause, "The support identity could not be created."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Support identities"
        description="What the support agent is and what it may do. Identities are cross-shop; tone of voice comes from the shop, and an agent configuration adopts one published identity."
        actions={<TourLaunch id="support-identities" />}
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading support identities…</p>
          ) : identities.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No support identity yet. Create one to define an agent's role and permissions.
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Identity</th>
                  <th className={tableHeadClasses}>Permissions</th>
                  <th className={tableHeadClasses}>Guidance</th>
                  <th className={tableHeadClasses}>Published</th>
                  <th className={tableHeadClasses}>Draft updated</th>
                </tr>
              </thead>
              <tbody>
                {identities.map((identity) => (
                  <tr key={identity.identity_id}>
                    <td className={tableCellClasses}>
                      <Link
                        className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                        to={identity.identity_id}
                      >
                        {identity.name}
                      </Link>
                      <div className="text-admin-muted">{identity.title}</div>
                    </td>
                    <td className={tableCellClasses}>{identity.permission_count}</td>
                    <td className={tableCellClasses}>{identity.guidance_count}</td>
                    <td className={tableCellClasses}>
                      {identity.latest_published_version === null
                        ? "Never published"
                        : `v${identity.latest_published_version} · ${identity.published_version_count} version(s)`}
                    </td>
                    <td className={tableCellClasses}>{formatTimestamp(identity.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <Card title="New support identity">
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
            <label className={fieldLabelClasses}>
              Role title
              <input
                className={fieldControlClasses}
                value={title}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <button className={accentButtonClasses} type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create identity"}
            </button>
            <p className="text-xs text-admin-muted">
              A new identity grants nothing. Permissions and guidance are added in the editor, then
              published together.
            </p>
          </form>
        </Card>
      </div>
    </>
  );
}
