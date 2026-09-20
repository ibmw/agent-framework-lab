import type { SupportIdentitySummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { createSupportIdentity, listSupportIdentities } from "../api/supportIdentities";
import { ButtonIcon } from "../components/ButtonIcon";
import { FieldHint } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips, filterList } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
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

type Filter = "all" | "published" | "draft";

/**
 * The prototype's identity chips (`tmp/design-frames/Workspace.dc.html`:6386–6389), less one.
 *
 * *Cannot publish* is not here. In the prototype it counts identities whose permission set is
 * unsound; in this workspace publish-readiness is a preview of one draft, and
 * `SupportIdentitySummarySchema` carries no finding — the index would have to fetch a preview
 * per row to know, which is a payload this slice may not add.
 */
const FILTERS: FilterChipDefinition<Filter, SupportIdentitySummarySchema>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  {
    id: "published",
    label: "Adoptable",
    kind: "published",
    matches: (identity) => identity.latest_published_version !== null,
  },
  {
    id: "draft",
    label: "Never published",
    kind: "draft",
    matches: (identity) => identity.latest_published_version === null,
  },
];

export function SupportIdentitiesPage() {
  const [identities, setIdentities] = useState<SupportIdentitySummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

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

  // Name and title, the two the prototype's identities search reads (its `shownIdentities`
  // filter) and the two this table prints in its first column.
  const { chips, visible } = filterList(identities, FILTERS, filter, {
    query,
    fields: (identity) => [identity.name, identity.title],
  });

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
          {/* Only once there are rows to search and count. A chip is a filter, and a row of
              zeros over "Loading…" — or over a listing that failed — filters nothing and
              answers nothing; it is the stat band this slice exists to avoid, drawn at its
              least useful moment. The search box keeps the same company: a box that can only
              narrow nothing is a control that does nothing. Both arrive with the table they
              belong to. */}
          {loading || loadError ? null : (
            <>
              <SearchRow>
                <SearchField label="Search identities" onChange={setQuery} value={query} />
              </SearchRow>
              <FilterChips
                legend="Filter support identities"
                chips={chips}
                selected={filter}
                onSelect={setFilter}
              />
            </>
          )}
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading support identities…</p>
          ) : identities.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No support identity yet. Create one to define an agent's role and permissions.
            </p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">No identity matches this view.</p>
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
                {visible.map((identity) => (
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
