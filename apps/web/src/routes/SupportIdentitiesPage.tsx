import type { SupportIdentitySummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { createSupportIdentity, listSupportIdentities } from "../api/supportIdentities";
import { ButtonIcon } from "../components/ButtonIcon";
import { FieldHint } from "../components/FieldHint";
import { TourLaunch } from "../components/TourLaunch";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";

const UNAVAILABLE = "The support-identity service is unavailable.";

export function SupportIdentitiesPage() {
  const [identities, setIdentities] = useState<SupportIdentitySummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    setIdentities((await listSupportIdentities(signal)).identities);
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
      await createSupportIdentity({ role: { name, title, description: "" } });
      setName("");
      setTitle("");
    } catch (cause: unknown) {
      setFormError(describeApiError(cause, "The support identity could not be created."));
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

  return (
    <>
      <PageHeader
        title="Support identities"
        description="What the support agent is and what it may do. Identities are cross-shop; tone of voice comes from the shop, and an agent configuration adopts one published identity."
        actions={<TourLaunch id="support-identities" />}
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
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
            <FieldHint
              label="Name"
              hint="How the identity is listed. Agent configurations adopt a published identity."
            >
              <input
                className={fieldControlClasses}
                value={name}
                required
                placeholder="Northstar tier 1"
                onChange={(event) => setName(event.target.value)}
              />
            </FieldHint>
            <FieldHint label="Role title" hint="The role the support agent presents as.">
              <input
                className={fieldControlClasses}
                value={title}
                required
                placeholder="Customer support representative"
                onChange={(event) => setTitle(event.target.value)}
              />
            </FieldHint>
            {formError ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {formError}
              </p>
            ) : null}
            <button className={accentButtonClasses} type="submit" disabled={creating}>
              <ButtonIcon verb="save" />
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
