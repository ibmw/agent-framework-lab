import type { SupportIdentitySummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { describeApiError } from "../api/client";
import { createSupportIdentity } from "../api/supportIdentities";
import { ButtonIcon } from "../components/ButtonIcon";
import { CreatePage } from "../components/CreatePage";
import { Field, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader, PublicationPill } from "../components/WorkspaceChrome";
import { IDENTITY_TONE_RULE, LABEL_MAX_LENGTH, TEXT_MAX_LENGTH } from "../lib/fieldRules";
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
  // The library this page renders is the one the lab's rail counts, read once by the lab's
  // shell and read again here whenever this page changes what it lists (ADR 0056).
  const { listings } = useLabWorkspace();
  const identities = listings.supportIdentities.rows;
  const loading = listings.supportIdentities.loading;
  const loadError = listings.supportIdentities.error;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

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
        actions={
          <Link className={accentButtonClasses} to="new">
            <ButtonIcon verb="create" />
            New identity
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
        <SearchRow title="Shared by every shop">
          {loading || loadError ? null : (
            <SearchField label="Search identities" onChange={setQuery} value={query} />
          )}
        </SearchRow>
        {loading || loadError ? null : (
          <FilterChips
            legend="Filter support identities"
            chips={chips}
            selected={filter}
            onSelect={setFilter}
          />
        )}
        {loadError ? (
          // Its failure and nothing else: a listing that could not be read has not said the
          // lab holds no support identity.
          <p role="alert" className="p-4 text-[13px] text-lab-error">
            {loadError}
          </p>
        ) : loading ? (
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
                    <PublicationPill record={identity} />
                  </td>
                  <td className={tableCellClasses}>{formatTimestamp(identity.updated_at)}</td>
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
 * `/lab/support-identities/new` — the identity, authored on a page
 * (`Workspace.dc.html`:1643).
 *
 * The library left shop scope with ADR 0054 and is reached from both rails, so its create page
 * is the lab's too. Permissions and guidance — the two cards the prototype also draws here —
 * belong to the editor this lands in: a new identity grants nothing, and what it may do is the
 * whole subject of the screen it opens on.
 */
export function NewSupportIdentityPage() {
  const { listings } = useLabWorkspace();
  const navigate = useNavigate();
  const formId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [remit, setRemit] = useState("");

  const blockedBy =
    pythonStrip(name) === ""
      ? "The identity needs a name before it can be created."
      : pythonStrip(title) === ""
        ? "The identity needs the role title the agent presents as."
        : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedBy !== undefined) {
      return;
    }
    setCreating(true);
    setFormError(null);
    let identityId: string;
    try {
      const created = await createSupportIdentity({
        // Stripped as Python strips them: `require_label` and `require_text` refuse padding.
        role: {
          name: pythonStrip(name),
          title: pythonStrip(title),
          description: pythonStrip(remit),
        },
      });
      identityId = created.identity_id;
    } catch (cause: unknown) {
      setFormError(describeApiError(cause, "The support identity could not be created."));
      setCreating(false);
      return;
    }
    // The lab holds one identity more than it did, so the listing the rail counts and this
    // index renders is read again before the editor opens (ADR 0056).
    await listings.supportIdentities.refresh();
    navigate(`/lab/support-identities/${identityId}`);
  }

  return (
    <CreatePage
      backTo="/lab/support-identities"
      backLabel="Support identities"
      breadcrumb="creating an identity"
      title={name}
      untitled="New support identity"
      formId={formId}
      createLabel="Create identity"
      creating={creating}
      creatingLabel="Creating…"
      blockedBy={blockedBy}
      error={formError}
    >
      <form id={formId} className="grid gap-4" onSubmit={submit}>
        <Card title="Role">
          <FieldRows>
            <Field
              label="Name"
              hint="How the identity is listed. Agent configurations adopt a published identity by this name."
            >
              <input
                maxLength={LABEL_MAX_LENGTH}
                className={`${fieldControlClasses} w-full`}
                value={name}
                required
                placeholder="Northstar tier 1"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Role title"
              hint="The role the support agent presents as. A customer may see it, so it is part of the fiction."
            >
              <input
                maxLength={LABEL_MAX_LENGTH}
                className={`${fieldControlClasses} w-full`}
                value={title}
                required
                placeholder="Customer support representative"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field
              label="Remit"
              optional
              hint="What this identity is for, in its own words. Keep it to scope — anything factual belongs in a policy document a scenario can require."
              extra={IDENTITY_TONE_RULE}
            >
              <textarea
                maxLength={TEXT_MAX_LENGTH}
                className={`${textAreaClasses} w-full`}
                value={remit}
                placeholder="First contact for delivery, returns and payment questions."
                onChange={(event) => setRemit(event.target.value)}
              />
            </Field>
          </FieldRows>
        </Card>

        <Card title="Created as a draft">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            A new identity grants nothing, so no configuration can adopt it yet. Permissions and
            guidance are added in the editor, then published together.
          </p>
        </Card>
      </form>
    </CreatePage>
  );
}
